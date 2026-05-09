import { timingSafeEqual } from "node:crypto";
import express from "express";
import { findCalendarWatchByChannel } from "./calendarWatch";
import { syncCalendarIncremental } from "./calendarIncremental";
import { createRateLimiter } from "./_core/rateLimit";
import { createRateLimitMiddleware } from "./_core/rateLimitMiddleware";
import { isPrivateAllowedUserId } from "./_core/privateMode";

export const calendarPushRouter = express.Router();

const pushLimiter = createRateLimiter({ windowMs: 60_000, max: 240 });
calendarPushRouter.use(
  createRateLimitMiddleware({
    limiter: pushLimiter,
    key: req => `ip:${req.ip}`,
  })
);

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

function constantTimeStringEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const perChannelQueue = new Map<string, Promise<void>>();

function enqueuePerChannel(
  key: string,
  fn: () => Promise<void>
): Promise<void> {
  const prev = perChannelQueue.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(fn)
    .finally(() => {
      if (perChannelQueue.get(key) === next) perChannelQueue.delete(key);
    });
  perChannelQueue.set(key, next);
  return next;
}

calendarPushRouter.post("/push", async (req, res) => {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const channelId = getHeader(headers, "x-goog-channel-id");
  const channelToken = getHeader(headers, "x-goog-channel-token");
  const resourceId = getHeader(headers, "x-goog-resource-id");
  const resourceState = getHeader(headers, "x-goog-resource-state");
  const messageNumber = getHeader(headers, "x-goog-message-number");

  const expectedToken = (process.env.CALENDAR_CHANNEL_TOKEN ?? "").trim();
  if (!expectedToken) {
    // Refuse to process unauthenticated channels.
    res.status(503).end();
    return;
  }

  if (!channelId || !resourceId || !channelToken) {
    res.status(400).end();
    return;
  }

  if (!constantTimeStringEquals(channelToken, expectedToken)) {
    res.status(401).end();
    return;
  }

  // Acknowledge promptly so Google does not retry while we work.
  res.status(204).end();

  // The initial `sync` notification only confirms the channel — nothing to fetch.
  if (resourceState === "sync") {
    return;
  }

  void (async () => {
    try {
      const state = await findCalendarWatchByChannel({ channelId, resourceId });
      if (!state) {
        console.warn("[CalendarPush] No watch state for channel.", {
          channelId,
          resourceId,
        });
        return;
      }

      if (!isPrivateAllowedUserId(state.userId)) {
        console.warn(
          "[CalendarPush] User not in private-mode allow-list; skipping.",
          { userId: state.userId, channelId }
        );
        return;
      }

      await enqueuePerChannel(`${channelId}:${resourceId}`, async () => {
        const result = await syncCalendarIncremental(
          state.userId,
          state.calendarId
        );
        console.log("[CalendarPush] Processed:", {
          userId: state.userId,
          calendarId: state.calendarId,
          channelId,
          resourceState: resourceState ?? null,
          messageNumber: messageNumber ?? null,
          mode: result.mode,
          scanned: result.scanned,
          detected: result.detected,
          cancelled: result.cancelled,
          syncTokenAcquired: result.syncTokenAcquired,
        });
      });
    } catch (err) {
      console.error("[CalendarPush] Processing failed:", err);
    }
  })();
});

calendarPushRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "calendar-push" });
});
