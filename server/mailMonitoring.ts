import { getBillingFeatureAccess, getOauthToken } from "./db";
import { monitorGmailAndSync, registerGmailPushWatch } from "./gmail";
import { enqueueGmailJob } from "./gmailJobQueue";
import type { MonitorResult } from "./gmail";

const POST_SCAN_SUPPRESS_MS = 2 * 60 * 1000;
const suppressRealtimeTelegramUntil = new Map<number, number>();

export function markRealtimeTelegramSuppressedAfterScan(userId: number, ttlMs = POST_SCAN_SUPPRESS_MS): void {
  suppressRealtimeTelegramUntil.set(userId, Date.now() + Math.max(0, ttlMs));
}

export function isRealtimeTelegramSuppressed(userId: number): boolean {
  const until = suppressRealtimeTelegramUntil.get(userId);
  if (!until) return false;
  if (Date.now() >= until) {
    suppressRealtimeTelegramUntil.delete(userId);
    return false;
  }
  return true;
}

export async function startMailMonitoringAndCheckmail(params: {
  userId: number;
  telegramChatId?: string;
  mode?: "auto" | "manual";
}) {
  const access = await getBillingFeatureAccess(params.userId);
  const mode = params.mode ?? "manual";
  if (mode === "auto" && !access.autoMonitoringEnabled) {
    return {
      needsOAuth: false as const,
      watchOk: false,
      result: null,
      access,
      blockedByBilling: true as const,
    };
  }

  const token = await getOauthToken(params.userId, "google");
  if (!token) {
    return {
      needsOAuth: true as const,
      watchOk: false,
      result: null,
      access,
      blockedByBilling: false as const,
    };
  }

  const watchOk =
    mode === "auto" && access.autoMonitoringEnabled
      ? await registerGmailPushWatch(params.userId)
      : false;
  // Scan completion should produce only a digest summary in Telegram flow,
  // not per-mail bubbles; additionally suppress immediate push-trigger bursts.
  markRealtimeTelegramSuppressedAfterScan(params.userId);
  const result = await monitorGmailAndSync(params.userId, params.telegramChatId, {
    suppressTelegramItemNotifications: true,
    enableAutoBoardWrite: access.autoBoardWriteEnabled,
  });
  return {
    needsOAuth: false as const,
    watchOk,
    result,
    access,
    blockedByBilling: false as const,
  };
}

// ─── Background Scan Cache ──────────────────────────────────────────────────
// Allows the OAuth callback to kick off a full mailbox scan immediately after
// binding, so that by the time the Telegram /start flow reaches the greeting
// the result is (likely) already available — dramatically reducing wait time.

interface BackgroundScanEntry {
  promise: Promise<MonitorResult | null>;
  startedAt: number;
}

const backgroundScans = new Map<number, BackgroundScanEntry>();
const BACKGROUND_SCAN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Start a background mailbox scan for the given user.  Fire-and-forget —
 * the result is cached in-memory and can be consumed later via
 * `consumeBackgroundScanResult()`.
 */
export function startBackgroundMailScan(
  userId: number,
  options?: { forceFullMailboxScan?: boolean }
): void {
  // Evict stale entries
  backgroundScans.forEach((entry, uid) => {
    if (Date.now() - entry.startedAt > BACKGROUND_SCAN_TTL_MS) {
      backgroundScans.delete(uid);
    }
  });

  // Don't start a duplicate scan
  if (backgroundScans.has(userId)) return;

  const promise = enqueueGmailJob(
    {
      name: "background-mail-scan",
      userId,
      dedupeKey: `background-mail-scan:${userId}`,
    },
    async (): Promise<MonitorResult | null> => {
      try {
        const access = await getBillingFeatureAccess(userId);
        if (!access.autoMonitoringEnabled) return null;

        const token = await getOauthToken(userId, "google");
        if (!token) return null;

        // Run without telegramChatId — we only want classification + board/calendar
        // writes.  Telegram notifications will be sent separately after the greeting.
        return await monitorGmailAndSync(userId, undefined, {
          enableAutoBoardWrite: access.autoBoardWriteEnabled,
          ...(options?.forceFullMailboxScan ? { fullMailboxScan: true } : {}),
        });
      } catch (err) {
        console.error("[BackgroundScan] Failed for user", userId, err);
        return null;
      }
    }
  );

  backgroundScans.set(userId, { promise, startedAt: Date.now() });
  console.log(`[BackgroundScan] Started for user ${userId}`);
}

/**
 * Retrieve (and remove) a previously started background scan result.
 * Returns `null` if no scan was started, the result expired, or the scan
 * itself returned null.  The caller should fall back to a fresh scan when
 * this returns null.
 */
export async function consumeBackgroundScanResult(
  userId: number,
): Promise<MonitorResult | null> {
  const entry = backgroundScans.get(userId);
  if (!entry) return null;

  backgroundScans.delete(userId);

  if (Date.now() - entry.startedAt > BACKGROUND_SCAN_TTL_MS) return null;

  return entry.promise;
}
