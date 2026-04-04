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
  handleAgentChat,
  generateResume,
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
} from "./agents";
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
          // Issue session cookie
          const cookieOptions = getSessionCookieOptions(ctx.req);
          const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: 7 * 24 * 60 * 60 * 1000 });
          ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
          return { success: true, profileCompleted: user.profileCompleted };
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
          // Fetch user and issue session cookie
          const user = await getUserById(userId);
          if (!user) throw new Error("USER_NOT_FOUND");
          const cookieOptions = getSessionCookieOptions(ctx.req);
          const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: 7 * 24 * 60 * 60 * 1000 });
          ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
          return { success: true, profileCompleted: user.profileCompleted };
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
        return handleAgentChat(ctx.user.id, input.message, input.sessionId, input.history);
      }),

    generateResume: protectedProcedure
      .input(
        z.object({
          experiences: z.string().min(10),
          sessionId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const resume = await generateResume(ctx.user.id, input.experiences, input.sessionId);
        return { resume, sessionId: input.sessionId };
      }),

    reconCompany: protectedProcedure
      .input(
        z.object({
          companyName: z.string().min(1),
          jobApplicationId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const report = await runAgentRecon(ctx.user.id, input.companyName, input.jobApplicationId);
        return {
          report,
          companyName: input.companyName,
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
        const es = await runAgentES(ctx.user.id, input.companyName, input.position, input.sessionId);
        return { es };
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
        const question = await runAgentInterview(ctx.user.id, input.companyName, input.position, input.history, input.userAnswer);
        return { question, isFirstMessage: !input.history || input.history.length === 0 };
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
