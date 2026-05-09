import { and, eq } from "drizzle-orm";
import { calendarEventIngestions } from "../drizzle/schema";
import { getDb } from "./db";
import { getValidAccessToken } from "./gmail";
import {
  getCalendarWatchState,
  markCalendarWatchStatus,
  registerCalendarPushWatch,
  saveCalendarSyncToken,
} from "./calendarWatch";
import { classifyCalendarEvent } from "./calendarEventNlp";

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
}

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export type CalendarSyncMode =
  | "incremental"
  | "bootstrap"
  | "skipped_no_token"
  | "skipped_no_state"
  | "skipped_token_expired"
  | "error";

export interface CalendarSyncResult {
  scanned: number;
  detected: number;
  cancelled: number;
  mode: CalendarSyncMode;
  syncTokenAcquired: boolean;
}

function defaultCalendarId(): string {
  return (process.env.GOOGLE_CALENDAR_ID ?? "primary").trim() || "primary";
}

function parseEventTime(slot: GoogleEventDateTime | undefined): Date | null {
  if (!slot) return null;
  if (typeof slot.dateTime === "string") {
    const ms = Date.parse(slot.dateTime);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof slot.date === "string") {
    // All-day event: pin to 00:00 UTC of the given date.
    const ms = Date.parse(`${slot.date}T00:00:00Z`);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}

async function findExistingIngestion(params: {
  userId: number;
  calendarId: string;
  googleEventId: string;
}): Promise<{ id: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: calendarEventIngestions.id })
    .from(calendarEventIngestions)
    .where(
      and(
        eq(calendarEventIngestions.userId, params.userId),
        eq(calendarEventIngestions.provider, "google"),
        eq(calendarEventIngestions.calendarId, params.calendarId),
        eq(calendarEventIngestions.googleEventId, params.googleEventId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function upsertIngestion(row: {
  userId: number;
  calendarId: string;
  googleEventId: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  startAt: Date | null;
  endAt: Date | null;
  parsedJson: Record<string, unknown>;
  isRelevant: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await findExistingIngestion({
    userId: row.userId,
    calendarId: row.calendarId,
    googleEventId: row.googleEventId,
  });

  if (existing) {
    await db
      .update(calendarEventIngestions)
      .set({
        status: row.status,
        summary: row.summary,
        description: row.description,
        location: row.location,
        startAt: row.startAt,
        endAt: row.endAt,
        parsedJson: row.parsedJson,
        isRelevant: row.isRelevant,
      })
      .where(eq(calendarEventIngestions.id, existing.id));
    return;
  }

  await db.insert(calendarEventIngestions).values({
    userId: row.userId,
    provider: "google",
    calendarId: row.calendarId,
    googleEventId: row.googleEventId,
    status: row.status,
    summary: row.summary,
    description: row.description,
    location: row.location,
    startAt: row.startAt,
    endAt: row.endAt,
    parsedJson: row.parsedJson,
    isRelevant: row.isRelevant,
  });
}

async function fetchEventsPage(params: {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
}): Promise<{ status: number; data?: EventsListResponse; errorBody?: string }> {
  const url = new URL(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`
  );
  url.searchParams.set("maxResults", "250");
  if (params.syncToken) url.searchParams.set("syncToken", params.syncToken);
  if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    return { status: res.status, errorBody: body };
  }
  const data = (await res.json()) as EventsListResponse;
  return { status: res.status, data };
}

/**
 * Pull and persist incremental Google Calendar changes for the user.
 *
 * Flow:
 *  1. Read syncToken from `calendar_watch_states`.
 *  2. Loop `events.list({ syncToken, pageToken })` until no more pages.
 *  3. For each event: classify via `classifyCalendarEvent`, idempotent-upsert
 *     into `calendar_event_ingestions`. Cancellations update `status`.
 *  4. Save `nextSyncToken` to the watch row.
 *  5. On Google 410 GONE (syncToken expired): mark watch `expired`. If
 *     `CALENDAR_SYNC_TOKEN_EXPIRED_BOOTSTRAP_ENABLED` is on (default true),
 *     re-bootstrap by re-registering the watch (which fetches a fresh
 *     syncToken). Otherwise leave it for `/rewatch_calendar`.
 */
export async function syncCalendarIncremental(
  userId: number,
  calendarId: string = defaultCalendarId()
): Promise<CalendarSyncResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return {
      scanned: 0,
      detected: 0,
      cancelled: 0,
      mode: "skipped_no_token",
      syncTokenAcquired: false,
    };
  }

  const state = await getCalendarWatchState(userId, calendarId);
  if (!state || !state.syncToken) {
    return {
      scanned: 0,
      detected: 0,
      cancelled: 0,
      mode: "skipped_no_state",
      syncTokenAcquired: false,
    };
  }

  let scanned = 0;
  let detected = 0;
  let cancelled = 0;
  let pageToken: string | undefined;
  const syncToken: string = state.syncToken;
  let nextSyncToken: string | undefined;

  for (let i = 0; i < 50; i++) {
    const page = await fetchEventsPage({
      accessToken,
      calendarId,
      syncToken: pageToken ? undefined : syncToken,
      pageToken,
    });

    if (page.status === 410) {
      // syncToken expired/invalid.
      await markCalendarWatchStatus({ userId, calendarId, status: "expired" });
      const allowBootstrap =
        (
          process.env.CALENDAR_SYNC_TOKEN_EXPIRED_BOOTSTRAP_ENABLED ?? "true"
        ).toLowerCase() !== "false";
      if (allowBootstrap) {
        const ok = await registerCalendarPushWatch(userId, calendarId);
        return {
          scanned,
          detected,
          cancelled,
          mode: "bootstrap",
          syncTokenAcquired: ok,
        };
      }
      return {
        scanned,
        detected,
        cancelled,
        mode: "skipped_token_expired",
        syncTokenAcquired: false,
      };
    }

    if (!page.data) {
      console.error(
        "[CalendarIncremental] events.list failed:",
        page.status,
        page.errorBody
      );
      await markCalendarWatchStatus({ userId, calendarId, status: "error" });
      return {
        scanned,
        detected,
        cancelled,
        mode: "error",
        syncTokenAcquired: false,
      };
    }

    for (const ev of page.data.items ?? []) {
      if (!ev.id) continue;
      scanned++;

      if (ev.status === "cancelled") {
        cancelled++;
        await upsertIngestion({
          userId,
          calendarId,
          googleEventId: ev.id,
          status: "cancelled",
          summary: ev.summary ?? null,
          description: ev.description ?? null,
          location: ev.location ?? null,
          startAt: parseEventTime(ev.start),
          endAt: parseEventTime(ev.end),
          parsedJson: { cancelled: true },
          isRelevant: false,
        });
        continue;
      }

      const classification = classifyCalendarEvent({
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
      });
      if (classification.isRelevant) detected++;

      await upsertIngestion({
        userId,
        calendarId,
        googleEventId: ev.id,
        status: ev.status ?? null,
        summary: ev.summary ?? null,
        description: ev.description ?? null,
        location: ev.location ?? null,
        startAt: parseEventTime(ev.start),
        endAt: parseEventTime(ev.end),
        parsedJson: classification as unknown as Record<string, unknown>,
        isRelevant: classification.isRelevant,
      });
    }

    if (page.data.nextPageToken) {
      pageToken = page.data.nextPageToken;
      continue;
    }
    if (page.data.nextSyncToken) {
      nextSyncToken = page.data.nextSyncToken;
    }
    break;
  }

  if (nextSyncToken) {
    await saveCalendarSyncToken({
      userId,
      calendarId,
      syncToken: nextSyncToken,
    });
  }

  return {
    scanned,
    detected,
    cancelled,
    mode: "incremental",
    syncTokenAcquired: Boolean(nextSyncToken),
  };
}
