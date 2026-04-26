/**
 * Per-event consent flow for writing detected events to Google Calendar.
 *
 * The user-facing toggle (users.calendarWriteEnabled) defaults to OFF. When a
 * calendar-writable event is detected and the toggle is OFF, we:
 *   1. Stash the prepared event in memory keyed by a short token
 *   2. Send the user a Telegram message with Yes / No inline buttons
 *
 * On "Yes", the Telegram callback handler flips calendarWriteEnabled to true
 * (per the user's spec: consent once, permanently on) and writes this single
 * event to Google Calendar.
 *
 * Note: Pending events live in memory only — server restarts drop them. That
 * is acceptable because the same Gmail message will surface again on the next
 * scan, and once the toggle is on the prompt is no longer needed.
 */
import { randomBytes } from "crypto";
import type { CalendarEvent } from "./gmail";

export interface PendingCalendarWrite {
  userId: number;
  chatId: string;
  messageId: string;
  calEvent: CalendarEvent & { colorId?: string };
  subjectPreview: string;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const pending = new Map<string, PendingCalendarWrite>();

function gc(now: number): void {
  for (const [k, v] of pending.entries()) {
    if (v.expiresAt <= now) pending.delete(k);
  }
}

export function stashPendingCalendarWrite(
  data: Omit<PendingCalendarWrite, "expiresAt">
): string {
  const now = Date.now();
  gc(now);
  const token = randomBytes(6).toString("hex");
  pending.set(token, { ...data, expiresAt: now + TTL_MS });
  return token;
}

export function takePendingCalendarWrite(token: string): PendingCalendarWrite | null {
  const now = Date.now();
  gc(now);
  const v = pending.get(token);
  if (!v) return null;
  pending.delete(token);
  return v;
}

export function peekPendingCalendarWrite(token: string): PendingCalendarWrite | null {
  return pending.get(token) ?? null;
}

export function __resetPendingCalendarWritesForTests(): void {
  pending.clear();
}
