/**
 * Parse a quiet-hours schedule string like "09:00-21:00" and determine
 * whether the current JST time is within the allowed notification window.
 * Returns true if notifications are allowed (outside quiet hours).
 */

export function parseSchedule(schedule: string): { startHour: number; startMin: number; endHour: number; endMin: number } | null {
  const match = schedule.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return {
    startHour: parseInt(match[1]),
    startMin: parseInt(match[2]),
    endHour: parseInt(match[3]),
    endMin: parseInt(match[4]),
  };
}

export function isNotificationAllowed(schedule: string | null | undefined, nowUtc: Date = new Date()): boolean {
  if (!schedule) return true; // No schedule = always allowed

  const parsed = parseSchedule(schedule);
  if (!parsed) return true; // Invalid schedule = always allowed

  // Convert to JST (UTC+9)
  const jstMs = nowUtc.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const currentMinutes = jstDate.getUTCHours() * 60 + jstDate.getUTCMinutes();

  const startMinutes = parsed.startHour * 60 + parsed.startMin;
  const endMinutes = parsed.endHour * 60 + parsed.endMin;

  if (startMinutes <= endMinutes) {
    // Normal range: e.g., 09:00-21:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range: e.g., 22:00-06:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
