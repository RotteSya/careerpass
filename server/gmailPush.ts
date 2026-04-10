import express from "express";
import {
  getBillingFeatureAccess,
  getTelegramBinding,
  getUserByEmail,
  getUserIdByOauthProviderAccount,
} from "./db";
import { monitorGmailAndSync, sendTelegramMessage, syncGmailIncremental } from "./gmail";
import { collectTrialNudges, markTrialNudgeDelivered } from "./billing";

export const gmailPushRouter = express.Router();

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

gmailPushRouter.post("/push", (req, res) => {
  // Acknowledge first; process asynchronously to avoid Pub/Sub retries caused by long processing.
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
        console.warn("[GmailPush] No user bound to email:", emailAddress);
        return;
      }

      const binding = await getTelegramBinding(user.id);
      const chatId = binding?.telegramId ?? undefined;
      const endHistoryId = payload?.historyId;

      await enqueuePerUser(user.id, async () => {
        const access = await getBillingFeatureAccess(user.id);
        if (chatId) {
          const nudges = await collectTrialNudges(user.id);
          for (const n of nudges) {
            const ok = await sendTelegramMessage(chatId, n.text);
            if (ok) await markTrialNudgeDelivered(user.id, n.kind);
          }
        }
        if (!access.autoMonitoringEnabled) {
          console.log("[GmailPush] Auto monitoring disabled by billing gate:", {
            userId: user.id,
            phase: access.phase,
          });
          return;
        }
        const result = endHistoryId
          ? await syncGmailIncremental(user.id, chatId, endHistoryId, {
              enableAutoBoardWrite: access.autoBoardWriteEnabled,
              enableAutoWorkflow: access.autoWorkflowEnabled,
            })
          : await monitorGmailAndSync(user.id, chatId, {
              enableAutoBoardWrite: access.autoBoardWriteEnabled,
              enableAutoWorkflow: access.autoWorkflowEnabled,
            });
        console.log("[GmailPush] Processed:", {
          userId: user.id,
          emailAddress,
          historyId: endHistoryId ?? null,
          mode: endHistoryId ? "incremental" : "fallback-scan",
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
