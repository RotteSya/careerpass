import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  upsertUser,
  getUserById,
  updateUserProfile,
  upsertOauthToken,
  getOauthToken,
  deleteOauthToken,
  getTelegramBinding,
  getJobApplications,
  createJobApplication,
  updateJobApplicationStatus,
  saveAgentMemory,
  getAgentMemory,
} from "./db";
import { invokeLLM } from "./_core/llm";
import crypto from "crypto";
import { reconCompany as runRecon, searchMemories } from "./recon";
import { monitorGmailAndSync, sendTelegramMessage } from "./gmail";
import {
  registerWithEmail,
  loginWithEmail,
  verifyEmail as verifyEmailToken,
  resendVerificationEmail,
} from "./emailAuth";
import { sdk } from "./_core/sdk";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ── HMAC-signed state helpers ─────────────────────────────────────────────────
function getStateSecret(): string {
  return process.env.JWT_SECRET ?? "careerpass-oauth-state-secret";
}
function buildSignedState(payload: { userId: number; provider: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getStateSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verifySignedState(state: string): { userId: number; provider: string } {
  const [data, sig] = state.split(".");
  if (!data || !sig) throw new Error("Malformed state");
  const expected = crypto.createHmac("sha256", getStateSecret()).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("State signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as {
    userId: number;
    provider: string;
    exp: number;
  };
  if (Date.now() > payload.exp) throw new Error("State expired");
  return { userId: payload.userId, provider: payload.provider };
}

function buildGoogleOAuthUrl(userId: number, _origin: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  // Always use the canonical production domain to avoid redirect_uri_mismatch
  // when users access via alternate URLs (e.g. Cloud Run preview domains)
  const appDomain = process.env.APP_DOMAIN ?? "https://careerpax.com";
  const redirectUri = `${appDomain}/api/calendar/callback`;
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly"
  );
  const state = buildSignedState({ userId, provider: "google", exp: Date.now() + 10 * 60 * 1000 });
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
}
function buildOutlookOAuthUrl(userId: number, origin: string): string {
  const clientId = process.env.OUTLOOK_CLIENT_ID ?? "";
  const redirectUri = `${origin}/dashboard/calendar/callback`;
  const scope = encodeURIComponent(
    "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Read offline_access"
  );
  const state = buildSignedState({ userId, provider: "outlook", exp: Date.now() + 10 * 60 * 1000 });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
}

async function exchangeGoogleCode(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>;
}

async function exchangeOutlookCode(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.OUTLOOK_CLIENT_ID ?? "",
    client_secret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Read offline_access",
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>;
}

// ─── Routers ──────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // ── Email Registration ────────────────────────────────────────────────────────────────────────
    register: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const result = await registerWithEmail(input.email, input.password);
          return { success: true, email: result.email };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "EMAIL_ALREADY_EXISTS") {
            throw new Error("このメールアドレスは既に登録済みです。");
          }
          throw new Error("登録に失敗しました。もう一度お試しください。");
        }
      }),
    // ── Email Login ─────────────────────────────────────────────────────────────────────────────
    emailLogin: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const user = await loginWithEmail(input.email, input.password);
          if (!user) throw new Error("INVALID_CREDENTIALS");
          // Issue session token — also set cookie as fallback
          const cookieOptions = getSessionCookieOptions(ctx.req);
          const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: 7 * 24 * 60 * 60 * 1000 });
          ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
          // Return token so frontend can store it in localStorage (primary auth method)
          return { success: true, profileCompleted: user.profileCompleted, sessionToken };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "EMAIL_NOT_VERIFIED") {
            throw new Error("メールアドレスの確認が完了していません。メールをご確認ください。");
          }
          throw new Error("メールアドレスまたはパスワードが正しくありません。");
        }
      }),
    // ── Verify Email Token ─────────────────────────────────────────────────────────────────────
    verifyEmail: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const { userId } = await verifyEmailToken(input.token);
          // Fetch user and issue session token — also set cookie as fallback
          const user = await getUserById(userId);
          if (!user) throw new Error("USER_NOT_FOUND");
          const cookieOptions = getSessionCookieOptions(ctx.req);
          const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: 7 * 24 * 60 * 60 * 1000 });
          ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
          // Return token so frontend can store it in localStorage (primary auth method)
          return { success: true, profileCompleted: user.profileCompleted, sessionToken };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "TOKEN_EXPIRED") throw new Error("リンクの有効期限が切れました。再送信してください。");
          if (msg === "INVALID_TOKEN") throw new Error("無効な確認リンクです。");
          throw new Error("確認に失敗しました。");
        }
      }),
    // ── Resend Verification Email ─────────────────────────────────────────────────────────────
    resendVerification: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        try {
          await resendVerificationEmail(input.email);
          return { success: true };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "ALREADY_VERIFIED") throw new Error("既に確認済みです。ログインしてください。");
          throw new Error("再送信に失敗しました。もう一度お試しください。");
        }
      }),
  }),

  // ── User Profile ─────────────────────────────────────────────────────────────
  user: router({
    getProfile: protectedProcedure.query(async ({ ctx }) => {
      return getUserById(ctx.user.id);
    }),

    updateProfile: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100).optional(),
          birthDate: z.string().optional(),
          education: z
            .enum(["high_school", "associate", "bachelor", "master", "doctor", "other"])
            .optional(),
          universityName: z.string().max(255).optional(),
          preferredLanguage: z.enum(["zh", "ja", "en"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateUserProfile(ctx.user.id, {
          ...input,
          profileCompleted: !!(
            input.name &&
            input.birthDate &&
            input.education &&
            input.universityName
          ),
        });
        return { success: true };
      }),

    completeRegistration: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          education: z.enum(["high_school", "associate", "bachelor", "master", "doctor", "other"]),
          universityName: z.string().min(1).max(255),
          preferredLanguage: z.enum(["zh", "ja", "en"]).default("ja"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateUserProfile(ctx.user.id, {
          ...input,
          profileCompleted: true,
        });
        return { success: true };
      }),
  }),

  // ── Calendar OAuth ────────────────────────────────────────────────────────────
  calendar: router({
    getAuthUrl: protectedProcedure
      .input(z.object({ provider: z.enum(["google", "outlook"]), origin: z.string() }))
      .query(({ ctx, input }) => {
        const url =
          input.provider === "google"
            ? buildGoogleOAuthUrl(ctx.user.id, input.origin)
            : buildOutlookOAuthUrl(ctx.user.id, input.origin);
        return { url };
      }),

     handleCallback: publicProcedure
      .input(
        z.object({
          code: z.string(),
          state: z.string(),
          redirectUri: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        // Verify HMAC-signed state — prevents forged callbacks since handleCallback is public
        let stateData: { userId: number; provider: string };
        try {
          stateData = verifySignedState(input.state);
        } catch (e) {
          throw new Error(`Invalid OAuth state: ${(e as Error).message}`);
        }
        if (!stateData.userId || !stateData.provider) throw new Error("Invalid state payload");
        const provider = stateData.provider as "google" | "outlook";
        const tokenData =
          provider === "google"
            ? await exchangeGoogleCode(input.code, input.redirectUri)
            : await exchangeOutlookCode(input.code, input.redirectUri);
        const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);
        await upsertOauthToken({
          userId: stateData.userId,
          provider,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token ?? null,
          expiresAt,
          scope: tokenData.scope ?? null,
        });
        return { success: true, provider };
      }),

    getStatus: protectedProcedure.query(async ({ ctx }) => {
      const [google, outlook] = await Promise.all([
        getOauthToken(ctx.user.id, "google"),
        getOauthToken(ctx.user.id, "outlook"),
      ]);
      return {
        google: !!google,
        outlook: !!outlook,
        googleExpiresAt: google?.expiresAt ?? null,
        outlookExpiresAt: outlook?.expiresAt ?? null,
      };
    }),

    disconnect: protectedProcedure
      .input(z.object({ provider: z.enum(["google", "outlook"]) }))
      .mutation(async ({ ctx, input }) => {
        await deleteOauthToken(ctx.user.id, input.provider);
        return { success: true };
      }),
  }),

  // ── Telegram ──────────────────────────────────────────────────────────────────
  telegram: router({
    getDeepLink: protectedProcedure.query(({ ctx }) => {
      const deepLink = `https://t.me/CareerpassBot?start=user_${ctx.user.id}`;
      return { deepLink };
    }),

    getBindingStatus: protectedProcedure.query(async ({ ctx }) => {
      const binding = await getTelegramBinding(ctx.user.id);
      return {
        bound: !!binding,
        telegramId: binding?.telegramId ?? null,
        telegramUsername: binding?.telegramUsername ?? null,
        boundAt: binding?.boundAt ?? null,
      };
    }),
  }),

  // ── Job Applications ──────────────────────────────────────────────────────────
  jobs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getJobApplications(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          companyNameJa: z.string().min(1).max(255),
          companyNameEn: z.string().max(255).optional(),
          position: z.string().max(255).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createJobApplication({ userId: ctx.user.id, ...input });
        return { success: true };
      }),

    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum([
            "researching",
            "es_preparing",
            "es_submitted",
            "interview_1",
            "interview_2",
            "interview_final",
            "offer",
            "rejected",
            "withdrawn",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateJobApplicationStatus(input.id, ctx.user.id, input.status);
        return { success: true };
      }),
  }),

  // ── Agent Memory ──────────────────────────────────────────────────────────────
  memory: router({
    list: protectedProcedure
      .input(
        z.object({
          type: z
            .enum(["resume", "company_report", "conversation", "es_draft", "interview_log"])
            .optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        return getAgentMemory(ctx.user.id, input.type);
      }),
  }),

  // ── AI Agent Chat (careerpass central) ────────────────────────────────────────
  agent: router({
    chat: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1).max(4000),
          sessionId: z.string().optional(),
          history: z
            .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        const lang = user?.preferredLanguage ?? "ja";

        // Build user profile context — injected into system prompt so Agent never re-asks known info
        const educationMapJa: Record<string, string> = {
          high_school: "高校卒", associate: "短大・専門卒", bachelor: "大学卒（学士）",
          master: "大学院修士課程", doctor: "大学院博士課程", other: "その他",
        };
        const educationMapZh: Record<string, string> = {
          high_school: "高中毕业", associate: "专科/短大", bachelor: "本科",
          master: "硕士研究生", doctor: "博士研究生", other: "其他",
        };
        const birthYear = user?.birthDate ? parseInt(user.birthDate.split("-")[0]) : null;
        const age = birthYear ? new Date().getFullYear() - birthYear : null;
        const eduJa = user?.education ? (educationMapJa[user.education] ?? user.education) : "未記入";
        const eduZh = user?.education ? (educationMapZh[user.education] ?? user.education) : "未填写";

        const profileContextZh = `
【用户已知信息 — 禁止重复询问以下任何内容】
- 姓名: ${user?.name ?? "未填写"}
- 年龄: ${age ? `${age}岁` : "未填写"}
- 最终学历: ${eduZh}
- 学校名称: ${user?.universityName ?? "未填写"}
- 沟通语言偏好: 中文
以上信息已从用户注册档案中获取，对话中无需再次询问这些基本信息。`;

        const profileContextEn = `
[User's Known Profile — DO NOT ask about any of the following]
- Name: ${user?.name ?? "not provided"}
- Age: ${age ? `${age} years old` : "not provided"}
- Education: ${user?.education ? (user.education === "master" ? "Master's degree" : user.education === "bachelor" ? "Bachelor's degree" : user.education) : "not provided"}
- University: ${user?.universityName ?? "not provided"}
- Language preference: English
This information is already known from the user's registration profile. Do NOT ask about these basic details during conversation.`;

        const profileContextJa = `
【ユーザーの既知情報 — 以下の情報は絶対に再度質問しないこと】
- 氏名: ${user?.name ?? "未記入"}
- 年齢: ${age ? `${age}歳` : "未記入"}
- 最終学歴: ${eduJa}
- 大学・学校名: ${user?.universityName ?? "未記入"}
- 希望言語: 日本語
これらの情報はユーザーの登録プロフィールから取得済みです。対話中にこれらの基本情報を再度尋ねてはいけません。`;

        const systemPrompt =
          lang === "zh"
            ? `你是"就活パス"的专属AI求职顾问，专注于日本就职活动辅导。你的名字叫CareerPass。
你的核心职责：
1. 用STAR法则（Situation, Task, Action, Result）深挖用户的实习、打工、项目、研究经历
2. 帮助用户准备日本企业的ES（Entry Sheet）和面试
3. 监控求职进度并提供专业建议
请用中文与用户交流。
${profileContextZh}`
            : lang === "en"
            ? `You are CareerPass, a dedicated AI career advisor specializing in Japanese job hunting (就職活動).
Your core responsibilities:
1. Use the STAR method (Situation, Task, Action, Result) to deeply explore the user's internship, part-time, project, and research experiences
2. Help users prepare ES (Entry Sheet) and interviews for Japanese companies
3. Track job hunting progress and provide professional advice
Please communicate in English.
${profileContextEn}`
            : `あなたは「就活パス」専属のAIキャリアアドバイザーです。日本の就職活動に特化したサポートを提供します。
あなたの主な役割：
1. STAR法（Situation, Task, Action, Result）を使って、ユーザーのインターン・アルバイト・プロジェクト・研究経験を深堀りする
2. 日本企業のES（エントリーシート）と面接の準備をサポートする
3. 就活の進捗を管理し、専門的なアドバイスを提供する
日本語でユーザーとコミュニケーションしてください。
${profileContextJa}`;

        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...(input.history ?? []).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content: input.message },
        ];

        const response = await invokeLLM({ messages });
        const rawReply = response.choices?.[0]?.message?.content;
        const reply = typeof rawReply === "string" ? rawReply : "申し訳ありません、エラーが発生しました。";

        // Save conversation to memory
        await saveAgentMemory({
          userId: ctx.user.id,
          memoryType: "conversation",
          title: `Conversation ${new Date().toISOString()}`,
          content: `User: ${input.message}\nAssistant: ${reply}`,
          metadata: { sessionId: input.sessionId ?? crypto.randomUUID() },
        });

        return { reply, sessionId: input.sessionId ?? crypto.randomUUID() };
      }),

    generateResume: protectedProcedure
      .input(
        z.object({
          experiences: z.string().min(10),
          sessionId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        const systemPrompt = `あなたはプロのキャリアアドバイザーです。ユーザーの経験を元に、日本の就活で使える構造化された履歴書（USER_${input.sessionId}.md形式）を作成してください。
STAR法則に基づいて各経験を整理し、以下の形式で出力してください：
# USER_${input.sessionId} - 個人履歴書
## 基本情報
## 学歴
## 職務・インターン経験（STAR形式）
## スキル・強み
## 自己分析`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.experiences },
          ],
        });

        const rawResume = response.choices?.[0]?.message?.content;
        const resumeContent = typeof rawResume === "string" ? rawResume : "履歴書の生成に失敗しました。";

        await saveAgentMemory({
          userId: ctx.user.id,
          memoryType: "resume",
          title: `USER_${input.sessionId}.md`,
          content: resumeContent,
          metadata: { sessionId: input.sessionId },
        });

        return { resume: resumeContent, sessionId: input.sessionId };
      }),

    reconCompany: protectedProcedure
      .input(
        z.object({
          companyName: z.string().min(1),
          jobApplicationId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Stage 1-3: Firecrawl → Tavily → LLM-only fallback
        const reconResult = await runRecon(input.companyName);

        const strategyLabel: Record<string, string> = {
          firecrawl: "Firecrawl深度スクレイピング",
          tavily: "Tavily AI検索",
          llm_only: "LLM内部知識のみ",
        };

        const systemPrompt = `あなたは日本の就活コンサルタントです。以下の情報源を分析し、就活生向けの《企業深度簡報》を作成してください。

情報収集戦略: ${strategyLabel[reconResult.strategy]}

${reconResult.rawText ? `収集した情報源:
${reconResult.rawText.slice(0, 8000)}` : `情報源なし。内部知識のみで分析してください。`}

レポート形式（${input.companyName}_Recon_Report.md）に必ず以下4セクションを含めてください：

## 【基本情報と中期戦略】
主要事業・技術スタック・市場地位・最近の戦略的重点

## 【内部の実態・黒料】
最近のニュースや経営計画から推測される課題（DX転換の遅れ、AI導入の困難、グローバル化の障壁、技術的負債など）

## 【求める人間像（核心推論）】
企業が渴求する人材特性と価値観

## 【高価値逆質問設計】
面接で使える効果的な逆質問3～5個`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `${input.companyName}の《企業深度簡報》を作成してください。`,
            },
          ],
        });

        const rawReport = response.choices?.[0]?.message?.content;
        const reportContent = typeof rawReport === "string" ? rawReport : "レポートの生成に失敗しました。";

        await saveAgentMemory({
          userId: ctx.user.id,
          memoryType: "company_report",
          title: `${input.companyName}_Recon_Report.md`,
          content: reportContent,
          metadata: {
            companyName: input.companyName,
            jobApplicationId: input.jobApplicationId,
            reconStrategy: reconResult.strategy,
            sourcesCount: reconResult.sources.length,
          },
        });

        return {
          report: reportContent,
          companyName: input.companyName,
          strategy: reconResult.strategy,
          sourcesCount: reconResult.sources.length,
        };
      }),

    generateES: protectedProcedure
      .input(
        z.object({
          companyName: z.string().min(1),
          position: z.string().min(1),
          sessionId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const memories = await getAgentMemory(ctx.user.id);
        const resume = memories.find((m) => m.memoryType === "resume");
        const report = memories.find(
          (m) => m.memoryType === "company_report" && m.title.includes(input.companyName)
        );

        const systemPrompt = `あなたはプロの就活アドバイザーです。以下の情報を元に、${input.companyName}の${input.position}ポジション向けの日本語ESを作成してください。

ESには必ず以下の2つのセクションを含めてください：
1. 志望動機 - 企業の実際の課題・痛点と自分の能力を結びつけ、なぜこの会社でなければならないかを説明
2. 自己PR - STAR法則に基づいた具体的な経験と強みのアピール

企業情報：
${report?.content ?? "（企業情報なし）"}

ユーザー履歴書：
${resume?.content ?? "（履歴書なし）"}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `${input.companyName}の${input.position}向けのESを作成してください。`,
            },
          ],
        });

        const rawES = response.choices?.[0]?.message?.content;
        let esContent = typeof rawES === "string" ? rawES : "";

        // Validate ES contains both required sections; retry once if missing
        const hasMotive = esContent.includes("志望動機");
        const hasSelfPR = esContent.includes("自己PR");
        if (!hasMotive || !hasSelfPR) {
          const retryResponse = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `${input.companyName}の${input.position}向けのESを作成してください。必ず「志望動機」と「自己PR」の両セクションを含めてください。` },
            ],
          });
          const retryRaw = retryResponse.choices?.[0]?.message?.content;
          esContent = typeof retryRaw === "string" ? retryRaw : esContent;
        }

        if (!esContent) esContent = "ESの生成に失敗しました。";

        await saveAgentMemory({
          userId: ctx.user.id,
          memoryType: "es_draft",
          title: `${input.companyName}_${input.position}_ES.md`,
          content: esContent,
          metadata: { companyName: input.companyName, position: input.position, sessionId: input.sessionId },
        });

        return { es: esContent };
      }),

    startInterview: protectedProcedure
      .input(
        z.object({
          companyName: z.string().min(1),
          position: z.string().min(1),
          history: z
            .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
            .optional(),
          userAnswer: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const memories = await getAgentMemory(ctx.user.id);
        const report = memories.find(
          (m) => m.memoryType === "company_report" && m.title.includes(input.companyName)
        );
        const esDraft = memories.find(
          (m) => m.memoryType === "es_draft" && m.title.includes(input.companyName)
        );

        const systemPrompt = `あなたは${input.companyName}の採用面接官です。非常に厳格で、曖昧な回答を絶対に許さない、本物の日本企業の面接官として振る舞ってください。
全て丁寧語・敬語を使用してください。
【重要ルール】毎回必ず1つの質問のみを行い、ユーザーの回答を待ってから次の質問をしてください。複数の質問を一度にしてはいけません。
候補者のESと企業情報を熟読し、ESの内容を深掘りする鋭い質問をしてください。

企業情報：
${report?.content ?? ""}

候補者のES：
${esDraft?.content ?? ""}`;

        const isFirstMessage = !input.history || input.history.length === 0;

        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...(input.history ?? []).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ];

        if (isFirstMessage) {
          messages.push({
            role: "user" as const,
            content: "面接を開始してください。",
          });
        } else if (input.userAnswer) {
          messages.push({ role: "user" as const, content: input.userAnswer });
        }

        const response = await invokeLLM({ messages });
        const rawQuestion = response.choices?.[0]?.message?.content;
        let question = typeof rawQuestion === "string" ? rawQuestion : "面接を開始できませんでした。";

        // Enforce single-question rule: if multiple question marks detected, trim to first question
        const questionMarks = (question.match(/[？?]/g) ?? []).length;
        if (questionMarks > 1) {
          // Split on Japanese/English question marks and keep only the first question sentence
          const parts = question.split(/(?<=[？?])/);
          // Find the first part that ends with a question mark
          const firstQuestion = parts.find(p => /[？?]/.test(p));
          if (firstQuestion) {
            // Keep any preamble (non-question text) before the first question
            const firstQIdx = question.indexOf(firstQuestion);
            const preamble = firstQIdx > 0 ? question.slice(0, firstQIdx) : "";
            question = (preamble + firstQuestion).trim();
          }
        }

        return { question, isFirstMessage };
      }),

    monitorEmails: protectedProcedure.mutation(async ({ ctx }) => {
      // Get user's Telegram chat ID for notifications
      const binding = await getTelegramBinding(ctx.user.id);
      const telegramChatId = binding?.telegramId ?? undefined;

      const result = await monitorGmailAndSync(ctx.user.id, telegramChatId);
      return result;
    }),

    searchMemory: protectedProcedure
      .input(z.object({ query: z.string().min(1), topK: z.number().min(1).max(20).optional() }))
      .query(async ({ ctx, input }) => {
        const memories = await getAgentMemory(ctx.user.id);
        const results = searchMemories(memories, input.query, input.topK ?? 5);
        return { results, total: memories.length };
      }),

    notifyTelegram: protectedProcedure
      .input(z.object({ chatId: z.string(), message: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const ok = await sendTelegramMessage(input.chatId, input.message);
        return { success: ok };
      }),
  }),
});

export type AppRouter = typeof appRouter;
