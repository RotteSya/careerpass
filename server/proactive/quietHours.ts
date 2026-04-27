/**
 * Notification time-window logic.
 *
 * Naming note: the user-facing concept is "quiet hours" (when NOT to
 * disturb), but the stored `notificationSchedule` string actually encodes
 * the *active window* — the hours during which notifications ARE allowed.
 * `isNotificationAllowed` returns true when the current JST time falls
 * inside that window. Don't invert the comparison without also flipping
 * the schema semantics.
 *
 * Format: "HH:MM-HH:MM" (24-hour). Overnight ranges like "22:00-06:00"
 * are supported by treating the window as wrapping past midnight.
 */

const JST_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function parseSchedule(schedule: string): { startHour: number; startMin: number; endHour: number; endMin: number } | null {
  const match = schedule.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const startHour = parseInt(match[1]);
  const startMin = parseInt(match[2]);
  const endHour = parseInt(match[3]);
  const endMin = parseInt(match[4]);

  if (
    startHour < 0 || startHour > 23 ||
    endHour < 0 || endHour > 23 ||
    startMin < 0 || startMin > 59 ||
    endMin < 0 || endMin > 59
  ) {
    return null;
  }

  return { startHour, startMin, endHour, endMin };
}

function getJstMinutes(now: Date): number {
  const parts = JST_TIME_FORMAT.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

export function isNotificationAllowed(schedule: string | null | undefined, now: Date = new Date()): boolean {
  if (!schedule) return true; // No schedule = always allowed
  const parsed = parseSchedule(schedule);
  if (!parsed) return true; // Invalid schedule = always allowed

  const currentMinutes = getJstMinutes(now);
  const startMinutes = parsed.startHour * 60 + parsed.startMin;
  const endMinutes = parsed.endHour * 60 + parsed.endMin;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight window, e.g., 22:00-06:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
