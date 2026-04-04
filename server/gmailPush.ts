import express from "express";
import { getTelegramBinding, getUserByEmail } from "./db";
import { monitorGmailAndSync } from "./gmail";

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

      const user = await getUserByEmail(emailAddress);
      if (!user) {
        console.warn("[GmailPush] No user bound to email:", emailAddress);
        return;
      }

      const binding = await getTelegramBinding(user.id);
      const chatId = binding?.telegramId ?? undefined;
      const result = await monitorGmailAndSync(user.id, chatId);
      console.log("[GmailPush] Processed:", {
        userId: user.id,
        emailAddress,
        scanned: result.scanned,
        detected: result.detected,
        calendarEvents: result.calendarEvents,
      });
    } catch (err) {
      console.error("[GmailPush] Processing failed:", err);
    }
  })();
});

gmailPushRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gmail-push" });
});
