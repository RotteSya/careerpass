/**
 * Private-mode allow-list.
 *
 * Two-person self-use deployment: when `PRIVATE_MODE=true`, only listed DB
 * user IDs and Telegram numeric IDs are allowed to drive push/Telegram
 * features. When false (or unset), the SaaS path runs unchanged — these
 * helpers all return `true` so existing billing/gate logic is unaffected.
 *
 * Env:
 *   PRIVATE_MODE=true|false           (default false)
 *   PRIVATE_ALLOWED_USER_IDS=42,7     (comma-separated DB user IDs)
 *   PRIVATE_ALLOWED_TELEGRAM_IDS=...  (comma-separated Telegram numeric IDs)
 */

function parseCsv(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0)
  );
}

export function isPrivateMode(): boolean {
  const v = (process.env.PRIVATE_MODE ?? "false").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isPrivateAllowedUserId(userId: number): boolean {
  if (!isPrivateMode()) return true;
  const allowed = parseCsv(process.env.PRIVATE_ALLOWED_USER_IDS);
  if (allowed.size === 0) return false; // Private mode with no allow-list = deny by default.
  return allowed.has(String(userId));
}

export function isPrivateAllowedTelegramId(
  telegramId: string | number
): boolean {
  if (!isPrivateMode()) return true;
  const allowed = parseCsv(process.env.PRIVATE_ALLOWED_TELEGRAM_IDS);
  if (allowed.size === 0) return false;
  return allowed.has(String(telegramId));
}

/** For diagnostics / `/watch_status`. */
export function privateModeSnapshot(): {
  enabled: boolean;
  allowedUserIds: string[];
  allowedTelegramIds: string[];
} {
  return {
    enabled: isPrivateMode(),
    allowedUserIds: Array.from(parseCsv(process.env.PRIVATE_ALLOWED_USER_IDS)),
    allowedTelegramIds: Array.from(
      parseCsv(process.env.PRIVATE_ALLOWED_TELEGRAM_IDS)
    ),
  };
}
