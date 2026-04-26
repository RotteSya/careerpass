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
  createJobStatusEvent,
  updateJobApplicationStatus,
  listJobStatusEvents,
  deleteUserAccountData,
} from "./db";
import { getValidAccessToken } from "./gmail";
import { ENV } from "./_core/env";
import {
  registerWithEmail,
  loginWithEmail,
  verifyEmail as verifyEmailToken,
  resendVerificationEmail,
  changePassword,
} from "./emailAuth";
import { sdk } from "./_core/sdk";
import { runProactiveCheckForUser } from "./proactive/scheduler";
import { buildOauthSignedState, verifyOauthSignedState } from "./_core/oauthSignedState";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildGoogleOAuthUrl(userId: number, _origin: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  // Always use the canonical production domain to avoid redirect_uri_mismatch
  // when users access via alternate URLs (e.g. Cloud Run preview domains)
  const appDomain = "https://careerpax.com";
  const redirectUri = `${appDomain}/api/calendar/callback`;
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly"
  );
  const state = buildOauthSignedState(
    { userId, provider: "google", exp: Date.now() + 30 * 60 * 1000 },
    ENV.cookieSecret
  );
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
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
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.currentPassword === input.newPassword) {
          throw new Error("新しいパスワードは現在のパスワードと異なる必要があります。");
        }
        try {
          await changePassword(ctx.user.id, input.currentPassword, input.newPassword);
          return { success: true } as const;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "EMAIL_AUTH_NOT_FOUND") {
            throw new Error("このアカウントはパスワード変更に対応していません。");
          }
          if (msg === "INVALID_CURRENT_PASSWORD") {
            throw new Error("現在のパスワードが正しくありません。");
          }
          throw new Error("パスワードの変更に失敗しました。");
        }
      }),
    deleteAccount: protectedProcedure
      .input(z.object({ password: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const current = await getUserById(ctx.user.id);
          const email = current?.email;
          if (!email) throw new Error("EMAIL_AUTH_NOT_FOUND");
          await loginWithEmail(email, input.password);
          await deleteUserAccountData(ctx.user.id);
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
          return { success: true } as const;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "UNKNOWN";
          if (msg === "INVALID_CREDENTIALS") {
            throw new Error("密码错误，无法删除账号。");
          }
          if (msg === "EMAIL_AUTH_NOT_FOUND") {
            throw new Error("该账号暂不支持网页端删除，请联系管理员。");
          }
          throw new Error("删除账号失败，请稍后重试。");
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
          notificationSchedule: z.string().regex(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/).optional(),
          nudgeCategoriesEnabled: z.record(z.string(), z.boolean()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const current = await getUserById(ctx.user.id);
        const nextProfile = {
          name: input.name ?? current?.name,
          birthDate: input.birthDate ?? current?.birthDate,
          education: input.education ?? current?.education,
          universityName: input.universityName ?? current?.universityName,
        };
        await updateUserProfile(ctx.user.id, {
          ...input,
          profileCompleted: !!(
            nextProfile.name &&
            nextProfile.birthDate &&
            nextProfile.education &&
            nextProfile.universityName
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
      .input(z.void())
      .query(({ ctx }) => {
        const url = buildGoogleOAuthUrl(ctx.user.id, "");
        return { url };
      }),

    getStatus: protectedProcedure.query(async ({ ctx }) => {
      const google = await getOauthToken(ctx.user.id, "google");
      return {
        google: !!google,
        googleExpiresAt: google?.expiresAt ?? null,
      };
    }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      await deleteOauthToken(ctx.user.id, "google");
      return { success: true };
    }),

    listRecentAutoEvents: protectedProcedure
      .input(z.object({ max: z.number().min(1).max(50).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const accessToken = await getValidAccessToken(ctx.user.id);
        if (!accessToken) return { events: [] as any[] };

        const max = input?.max ?? 20;
        const timeMin = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        url.searchParams.set("timeMin", timeMin);
        url.searchParams.set("maxResults", String(max));
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("q", "CareerPass 自動登録");

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Google Calendar API error: ${t.slice(0, 200)}`);
        }
        const data = (await res.json()) as {
          items?: Array<{
            id?: string;
            summary?: string;
            description?: string;
            htmlLink?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            updated?: string;
          }>;
        };
        const events = (data.items ?? [])
          .filter((e) => (e.description ?? "").includes("CareerPass"))
          .map((e) => ({
            id: e.id ?? "",
            summary: e.summary ?? "",
            description: e.description ?? "",
            htmlLink: e.htmlLink ?? "",
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? "",
            updated: e.updated ?? "",
          }));
        return { events };
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
            "applied",
            "briefing",
            "es_preparing",
            "es_submitted",
            "document_screening",
            "written_test",
            "interview_1",
            "interview_2",
            "interview_3",
            "interview_4",
            "interview_final",
            "offer",
            "rejected",
            "withdrawn",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const jobs = await getJobApplications(ctx.user.id);
        const target = jobs.find(j => j.id === input.id);
        const prev = target?.status ?? null;
        await updateJobApplicationStatus(input.id, ctx.user.id, input.status);
        await createJobStatusEvent({
          userId: ctx.user.id,
          jobApplicationId: input.id,
          source: "manual",
          prevStatus: prev,
          nextStatus: input.status,
        });
        if (target?.companyNameJa) {
          // Notion sync removed — job board is maintained internally
        }
        return { success: true };
      }),

    listStatusEvents: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return listJobStatusEvents(ctx.user.id, input.id, 20);
      }),
  }),

  proactive: router({
    triggerCheck: protectedProcedure
      .mutation(async ({ ctx }) => {
        const nudges = await runProactiveCheckForUser(ctx.user.id);
        return { count: nudges.length, nudges };
      }),
  }),
});

export type AppRouter = typeof appRouter;
