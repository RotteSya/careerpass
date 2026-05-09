import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { calendarWatchStates } from "../drizzle/schema";
import type { CalendarWatchState } from "../drizzle/schema";
import { getDb } from "./db";
import { getValidAccessToken } from "./gmail";

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

function appDomain(): string {
  const raw = process.env.APP_DOMAIN ?? "";
  return raw.replace(/\/+$/, "");
}

function calendarWebhookUrl(): string | null {
  const domain = appDomain();
  if (!domain) return null;
  const path = process.env.CALENDAR_WEBHOOK_PATH ?? "/api/calendar/push";
  return `${domain}${path.startsWith("/") ? path : `/${path}`}`;
}

function defaultCalendarId(): string {
  return (process.env.GOOGLE_CALENDAR_ID ?? "primary").trim() || "primary";
}

function bootstrapLookaheadDays(): number {
  const raw = Number.parseInt(
    process.env.CALENDAR_BOOTSTRAP_LOOKAHEAD_DAYS ?? "",
    10
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

interface WatchResponse {
  id?: string;
  resourceId?: string;
  resourceUri?: string;
  expiration?: string | number;
}

interface EventsListResponse {
  nextSyncToken?: string;
  nextPageToken?: string;
  items?: Array<{ id?: string }>;
}

async function bootstrapSyncToken(params: {
  accessToken: string;
  calendarId: string;
}): Promise<string | null> {
  const { accessToken, calendarId } = params;
  const days = bootstrapLookaheadDays();
  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();

  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(
        "[CalendarWatch] events.list bootstrap failed:",
        res.status,
        await res.text().catch(() => "<no body>")
      );
      return null;
    }
    const data = (await res.json()) as EventsListResponse;
    if (data.nextSyncToken) return data.nextSyncToken;
    if (!data.nextPageToken) return null;
    pageToken = data.nextPageToken;
  }
  return null;
}

export async function getCalendarWatchState(
  userId: number,
  calendarId: string = defaultCalendarId()
): Promise<CalendarWatchState | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(calendarWatchStates)
    .where(
      and(
        eq(calendarWatchStates.userId, userId),
        eq(calendarWatchStates.provider, "google"),
        eq(calendarWatchStates.calendarId, calendarId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findCalendarWatchByChannel(params: {
  channelId: string;
  resourceId: string;
}): Promise<CalendarWatchState | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(calendarWatchStates)
    .where(
      and(
        eq(calendarWatchStates.channelId, params.channelId),
        eq(calendarWatchStates.resourceId, params.resourceId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function saveCalendarSyncToken(params: {
  userId: number;
  calendarId?: string;
  syncToken: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const calendarId = params.calendarId ?? defaultCalendarId();
  await db
    .update(calendarWatchStates)
    .set({ syncToken: params.syncToken })
    .where(
      and(
        eq(calendarWatchStates.userId, params.userId),
        eq(calendarWatchStates.provider, "google"),
        eq(calendarWatchStates.calendarId, calendarId)
      )
    );
}

export async function markCalendarWatchStatus(params: {
  userId: number;
  calendarId?: string;
  status: "active" | "expired" | "stopped" | "error";
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const calendarId = params.calendarId ?? defaultCalendarId();
  await db
    .update(calendarWatchStates)
    .set({ status: params.status })
    .where(
      and(
        eq(calendarWatchStates.userId, params.userId),
        eq(calendarWatchStates.provider, "google"),
        eq(calendarWatchStates.calendarId, calendarId)
      )
    );
}

async function upsertCalendarWatchState(row: {
  userId: number;
  calendarId: string;
  channelId: string;
  resourceId: string;
  resourceUri: string | null;
  expiration: Date | null;
  syncToken: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await getCalendarWatchState(row.userId, row.calendarId);
  if (existing) {
    await db
      .update(calendarWatchStates)
      .set({
        channelId: row.channelId,
        resourceId: row.resourceId,
        resourceUri: row.resourceUri,
        expiration: row.expiration,
        syncToken: row.syncToken,
        status: "active",
      })
      .where(eq(calendarWatchStates.id, existing.id));
    return;
  }

  await db.insert(calendarWatchStates).values({
    userId: row.userId,
    provider: "google",
    calendarId: row.calendarId,
    channelId: row.channelId,
    resourceId: row.resourceId,
    resourceUri: row.resourceUri,
    expiration: row.expiration,
    syncToken: row.syncToken,
    status: "active",
  });
}

/**
 * Register (or refresh) a Google Calendar `events.watch` channel for the user
 * and persist the resulting channel/resource IDs and a fresh `syncToken`
 * bootstrap. Returns true on success.
 */
export async function registerCalendarPushWatch(
  userId: number,
  calendarId: string = defaultCalendarId()
): Promise<boolean> {
  if ((process.env.CALENDAR_PUSH_ENABLED ?? "true").toLowerCase() === "false") {
    return false;
  }

  const webhookUrl = calendarWebhookUrl();
  if (!webhookUrl) {
    console.warn(
      "[CalendarWatch] APP_DOMAIN not configured; skip watch registration."
    );
    return false;
  }

  const channelToken = (process.env.CALENDAR_CHANNEL_TOKEN ?? "").trim();
  if (!channelToken) {
    console.warn(
      "[CalendarWatch] CALENDAR_CHANNEL_TOKEN not set; refusing to register an unauthenticated channel."
    );
    return false;
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    console.warn("[CalendarWatch] No Google access token for user.", {
      userId,
    });
    return false;
  }

  const channelId = `cp-cal-${randomUUID()}`;

  try {
    const res = await fetch(
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          token: channelToken,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.error("[CalendarWatch] events.watch failed:", res.status, text);
      return false;
    }

    const data = (await res.json()) as WatchResponse;
    const expirationMs =
      typeof data.expiration === "string" || typeof data.expiration === "number"
        ? Number(data.expiration)
        : NaN;
    const expirationDate = Number.isFinite(expirationMs)
      ? new Date(expirationMs)
      : null;

    if (!data.resourceId) {
      console.error(
        "[CalendarWatch] events.watch response missing resourceId.",
        data
      );
      return false;
    }

    const syncToken = await bootstrapSyncToken({ accessToken, calendarId });

    await upsertCalendarWatchState({
      userId,
      calendarId,
      channelId,
      resourceId: data.resourceId,
      resourceUri: data.resourceUri ?? null,
      expiration: expirationDate,
      syncToken,
    });

    console.log("[CalendarWatch] Registered:", {
      userId,
      calendarId,
      channelId,
      resourceId: data.resourceId,
      expiration: data.expiration ?? null,
      syncTokenAcquired: Boolean(syncToken),
    });
    return true;
  } catch (err) {
    console.error("[CalendarWatch] Registration error:", { userId, err });
    return false;
  }
}

/**
 * Stop an existing watch channel via the Google API and mark our row stopped.
 * Best-effort: ignores Google 404/410 ("already gone").
 */
export async function stopCalendarPushWatch(
  userId: number,
  calendarId: string = defaultCalendarId()
): Promise<boolean> {
  const state = await getCalendarWatchState(userId, calendarId);
  if (!state) return false;

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return false;

  try {
    const res = await fetch(`${GOOGLE_CALENDAR_BASE}/channels/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: state.channelId,
        resourceId: state.resourceId,
      }),
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.warn("[CalendarWatch] channels.stop returned", res.status);
    }
  } catch (err) {
    console.warn("[CalendarWatch] channels.stop error:", err);
  }

  await markCalendarWatchStatus({ userId, calendarId, status: "stopped" });
  return true;
}
