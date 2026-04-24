import express from "express";
import { createRemoteJWKSet } from "jose";
import { getTelegramBinding, getUserByEmail, getUserIdByOauthProviderAccount } from "./db";
import { monitorGmailAndSync, syncGmailIncremental } from "./gmail";
import { isRealtimeTelegramSuppressed } from "./mailMonitoring";
import { authorizeGmailPushRequest } from "./_core/gmailPushAuth";
import { createRateLimiter } from "./_core/rateLimit";
import { createRateLimitMiddleware } from "./_core/rateLimitMiddleware";

export const gmailPushRouter = express.Router();

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);
const GOOGLE_ISSUER = "https://accounts.google.com";

const pushLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });
gmailPushRouter.use(
  createRateLimitMiddleware({
    limiter: pushLimiter,
    key: (req) => `ip:${req.ip}`,
  })
);

interface GmailPubSubEnvelope {
  message?: {
    data?: string;
    messageId?: string;
  };
  subscription?: string;
}

interface GmailPushPayload {
  emailAddress?: string;
  historyId?: string;
}

function decodePubSubPayload(data?: string): GmailPushPayload | null {
  if (!data) return null;
  try {
    const json = Buffer.from(data, "base64").toString("utf8");
    return JSON.parse(json) as GmailPushPayload;
  } catch (err) {
    console.error("[GmailPush] Failed to decode payload:", err);
    return null;
  }
}

const perUserQueue = new Map<number, Promise<void>>();

function enqueuePerUser(userId: number, fn: () => Promise<void>): Promise<void> {
  const prev = perUserQueue.get(userId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(fn)
    .finally(() => {
      if (perUserQueue.get(userId) === next) perUserQueue.delete(userId);
    });
  perUserQueue.set(userId, next);
  return next;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

gmailPushRouter.post("/push", async (req, res) => {
  try {
    const audience = process.env.GMAIL_PUBSUB_AUDIENCE ?? "";
    if (!audience) {
      res.status(503).end();
      return;
    }

    const result = await authorizeGmailPushRequest(
      {
        authorization: getHeader(req.headers as any, "authorization"),
      },
      {
        audience,
        issuer: GOOGLE_ISSUER,
        jwks: GOOGLE_JWKS,
      }
    );

    const expectedServiceAccount = (process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT ?? "")
      .trim()
      .toLowerCase();
    if (expectedServiceAccount) {
      const email =
        typeof (result.payload as any).email === "string"
          ? String((result.payload as any).email).trim().toLowerCase()
          : "";
      if (!email || email !== expectedServiceAccount) {
        res.status(401).end();
        return;
      }
    }
  } catch {
    res.status(401).end();
    return;
  }

  res.status(204).end();

  void (async () => {
    try {
      const envelope = req.body as GmailPubSubEnvelope;
      const payload = decodePubSubPayload(envelope?.message?.data);
      const emailAddress = payload?.emailAddress?.trim().toLowerCase();
      if (!emailAddress) {
        console.warn("[GmailPush] Missing emailAddress in push payload.");
        return;
      }

      const mappedUserId = await getUserIdByOauthProviderAccount("google", emailAddress);
      const user = mappedUserId ? { id: mappedUserId } : await getUserByEmail(emailAddress);
      if (!user?.id) {
        console.warn("[GmailPush] No user bound to push payload email.");
        return;
      }

      const binding = await getTelegramBinding(user.id);
      const chatId = binding?.telegramId ?? undefined;
      const endHistoryId = payload?.historyId;
      const suppressTelegramItemNotifications = isRealtimeTelegramSuppressed(user.id);

      await enqueuePerUser(user.id, async () => {
        const result = endHistoryId
          ? await syncGmailIncremental(user.id, chatId, endHistoryId, {
              suppressTelegramItemNotifications,
            })
          : await monitorGmailAndSync(user.id, chatId, {
              suppressTelegramItemNotifications,
            });
        console.log("[GmailPush] Processed:", {
          userId: user.id,
          historyId: endHistoryId ?? null,
          mode: endHistoryId ? "incremental" : "fallback-scan",
          suppressTelegramItemNotifications,
          scanned: result.scanned,
          detected: result.detected,
          calendarEvents: result.calendarEvents,
        });
      });
    } catch (err) {
      console.error("[GmailPush] Processing failed:", err);
    }
  })();
});

gmailPushRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gmail-push" });
});
