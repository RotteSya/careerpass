/**
 * gmail.ts — Gmail メール監視サービス
 *
 * 機能:
 *   1. Gmail API で受信トレイを取得 (access_token 使用)
 *   2. 面接・説明会・選考に関するメールを自動識別
 *   3. 識別したイベントを Google Calendar に書き込む
 *   4. Telegram Bot 経由でユーザーに通知
 *
 * 注意: このサービスは保護された tRPC procedure から呼び出される。
 *       access_token の有効期限切れ時は refresh_token で自動更新。
 */

import {
  getGoogleAccountSyncState,
  getOauthToken,
  getJobApplications,
  createJobApplication,
  createJobStatusEvent,
  updateJobApplicationStatus,
  getUserCalendarColorPrefs,
  saveAgentMemory,
  updateGoogleAccountSyncState,
  updateGoogleLastHistoryIdIfNewer,
  upsertOauthToken,
  upsertOauthProviderAccount,
  trackCompanyForBilling,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { loadAgentAgents, loadAgentSoul } from "./_core/soul";
import {
  startCompanyWorkflow,
} from "./agents";
import { syncJobToNotionBoard } from "./notion";
import { createCompanyBatchDeduper, sortMailItemsByTsDesc } from "./gmail_dedup";
import { sendTelegramMessage } from "./telegramMessaging";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";
import { normalizeCompanyKey, resolveCanonicalCompanyName } from "./companyName";

const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailEvent {
  subject: string;
  from: string;
  date: string;
  body: string;
  eventType: "interview" | "briefing" | "test" | "deadline" | "entry" | "offer" | "rejection" | "other";
  companyName: string | null;
  eventDate: string | null; // ISO 8601 if detected
  eventTime: string | null;
  location: string | null;
  todoItems: string[];
  mailLink?: string;
}

export interface CalendarEvent {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

// ─── Gmail API ────────────────────────────────────────────────────────────────

export async function getValidAccessToken(userId: number): Promise<string | null> {
  const tokenRow = await getOauthToken(userId, "google");
  if (!tokenRow) return null;

  // Check if token is still valid (with 5-minute buffer)
  if (tokenRow.expiresAt && tokenRow.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return tokenRow.accessToken;
  }

  // Try to refresh
  if (tokenRow.refreshToken) {
    const newToken = await refreshGoogleToken(tokenRow.refreshToken);
    if (newToken) {
      // Update stored token
      await upsertOauthToken({
        userId,
        provider: "google",
        accessToken: newToken,
        refreshToken: tokenRow.refreshToken,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scope: tokenRow.scope ?? undefined,
      });
      return newToken;
    }
  }

  return null;
}

export async function registerGmailPushWatch(userId: number): Promise<boolean> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return false;

  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    console.warn("[Gmail] GMAIL_PUBSUB_TOPIC is not configured. Skipping Gmail push watch registration.");
    return false;
  }

  try {
    const mapped = await ensureGoogleProviderAccountMapping(userId, accessToken);
    if (!mapped) {
      console.warn("[Gmail] Cannot register watch because provider-account mapping is missing.", { userId });
      return false;
    }

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX"],
        labelFilterAction: "include",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[Gmail] Failed to register watch:", errText);
      return false;
    }

    const data = (await res.json()) as { expiration?: string | number; historyId?: string };
    const historyId = typeof data.historyId === "string" ? data.historyId : null;
    const expirationMs = typeof data.expiration === "string" || typeof data.expiration === "number" ? Number(data.expiration) : NaN;
    const expirationDate = Number.isFinite(expirationMs) ? new Date(expirationMs) : null;

    await updateGoogleAccountSyncState(userId, { watchExpiration: expirationDate });
    if (historyId) {
      await updateGoogleLastHistoryIdIfNewer(userId, historyId);
    }
    console.log("[Gmail] Push watch registered:", {
      userId,
      expiration: data?.expiration,
      historyId: data?.historyId,
    });
    return true;
  } catch (err) {
    console.error("[Gmail] Failed to register watch:", err);
    return false;
  }
}

async function fetchGoogleAccountEmailFromGmailProfile(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { emailAddress?: string };
    const email = data.emailAddress?.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export async function ensureGoogleProviderAccountMapping(
  userId: number,
  accessToken?: string
): Promise<boolean> {
  const token = accessToken ?? (await getValidAccessToken(userId));
  if (!token) return false;
  const accountEmail = await fetchGoogleAccountEmailFromGmailProfile(token);
  if (!accountEmail) return false;
  await upsertOauthProviderAccount({
    userId,
    provider: "google",
    accountEmail,
  });
  return true;
}

async function fetchInboxMessageIds(params: {
  accessToken: string;
  fullMailbox: boolean;
  maxResults: number | null;
}): Promise<string[]> {
  const { accessToken, fullMailbox, maxResults } = params;
  try {
    const messageIds: string[] = [];
    let pageToken: string | undefined;
    const recentCap = maxResults ?? 50;
    const pageSize = fullMailbox ? 500 : Math.min(Math.max(recentCap, 1), 100);

    // Broad pull (without hard keyword gate). Actual job-related decision is delegated to monitor agent.
    // First full scan removes time window so we can reconstruct the board from the entire inbox.
    const q = fullMailbox
      ? "-category:social -category:promotions"
      : "newer_than:5d -category:social -category:promotions";

    while (maxResults === null || messageIds.length < maxResults) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(pageSize));
      url.searchParams.set("q", q);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return messageIds;

      const data = (await res.json()) as {
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      };
      for (const m of data.messages ?? []) {
        if (!m.id) continue;
        messageIds.push(m.id);
        if (maxResults !== null && messageIds.length >= maxResults) break;
      }
      if (!data.nextPageToken || !fullMailbox) break;
      pageToken = data.nextPageToken;
    }

    return messageIds;
  } catch {
    return [];
  }
}

type GmailPayloadPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
};

function extractMeetingUrlFromText(text: string): string | null {
  const m = text.match(
    /(https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s　<>"]{10,200})/i
  );
  return m?.[1] ?? null;
}

export function __extractMeetingUrlFromTextForTests(text: string): string | null {
  return extractMeetingUrlFromText(text);
}

function decodeGmailBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function collectTextPlainBodies(part: GmailPayloadPart | undefined, out: string[]): void {
  if (!part) return;
  if (part.mimeType?.toLowerCase() === "text/plain" && part.body?.data) {
    out.push(decodeGmailBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) collectTextPlainBodies(child, out);
}

function collectTextHtmlBodies(part: GmailPayloadPart | undefined, out: string[]): void {
  if (!part) return;
  if (part.mimeType?.toLowerCase() === "text/html" && part.body?.data) {
    out.push(decodeGmailBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) collectTextHtmlBodies(child, out);
}

function decodeHtmlEntities(input: string): string {
  const named = input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  return named
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_m, d: string) => {
      const code = parseInt(d, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMailTextForAi(input: string): string {
  const text = input.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  const stopPatterns = [
    /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*転送メッセージ\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*元のメッセージ\s*-{2,}\s*$/i,
    /^\s*on .+ wrote:\s*$/i,
  ];
  const headerLike = [
    /^(from|to|cc|bcc|subject|date)\s*:/i,
    /^(差出人|送信者|宛先|件名|日時)\s*[:：]/,
  ];
  const dropLine = [
    /^\s*>/,
    /(配信停止|配信解除|unsubscribe|opt[\s-]?out)/i,
    /(このメールは送信専用|送信専用アドレス|返信できません)/i,
    /(privacy policy|プライバシー|個人情報|confidential)/i,
    /(all rights reserved|copyright)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (!line) continue;
    if (stopPatterns.some((re) => re.test(line))) break;
    if (dropLine.some((re) => re.test(line))) continue;
    if (headerLike.some((re) => re.test(line)) && i > 3) break;
    out.push(line);
    if (out.length >= 120) break;
  }

  const merged = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return merged.slice(0, 8000);
}

function decodeGmailHeaderValue(value: string): string {
  // Minimal RFC 2047 support for common UTF-8/B payloads from Gmail headers.
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, (_m, _charset: string, enc: string, payload: string) => {
    try {
      if (enc.toUpperCase() === "B") {
        return Buffer.from(payload, "base64").toString("utf-8");
      }
      // Q-encoding: "_" stands for space.
      const qp = payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_s: string, h: string) =>
        String.fromCharCode(parseInt(h, 16))
      );
      return Buffer.from(qp, "binary").toString("utf-8");
    } catch {
      return payload;
    }
  });
}

export function __extractGmailBodyFromPayloadForTests(payload: GmailPayloadPart, snippet = ""): string {
  let body = snippet;
  const plainBodies: string[] = [];
  collectTextPlainBodies(payload, plainBodies);
  if (plainBodies.length > 0) {
    body = plainBodies.join("\n");
  } else {
    const htmlBodies: string[] = [];
    collectTextHtmlBodies(payload, htmlBodies);
    if (htmlBodies.length > 0) {
      body = htmlToText(htmlBodies.join("\n"));
    } else if (payload?.body?.data) {
      body = decodeGmailBase64Url(payload.body.data);
    }
  }
  return body.slice(0, 8000);
}

export function __extractCleanMailTextFromGmailPayloadForTests(payload: GmailPayloadPart, snippet = ""): string {
  return cleanMailTextForAi(__extractGmailBodyFromPayloadForTests(payload, snippet));
}

async function fetchEmailDetail(
  accessToken: string,
  messageId: string
): Promise<{ subject: string; from: string; date: string; body: string; threadId: string | null } | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      payload?: GmailPayloadPart & { headers?: Array<{ name: string; value: string }> };
      snippet?: string;
      threadId?: string;
    };

    const headers = data.payload?.headers ?? [];
    const subjectRaw = headers.find((h) => h.name === "Subject")?.value ?? "(件名なし)";
    const fromRaw = headers.find((h) => h.name === "From")?.value ?? "";
    const dateRaw = headers.find((h) => h.name === "Date")?.value ?? "";
    const subject = decodeGmailHeaderValue(subjectRaw);
    const from = decodeGmailHeaderValue(fromRaw);
    const date = decodeGmailHeaderValue(dateRaw);

    // Extract body text
    const body = data.payload
      ? __extractCleanMailTextFromGmailPayloadForTests(data.payload, data.snippet ?? "")
      : cleanMailTextForAi(data.snippet ?? "");

    return { subject, from, date, body, threadId: data.threadId ?? null };
  } catch {
    return null;
  }
}

async function fetchThreadMeetingUrl(accessToken: string, threadId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      messages?: Array<{ payload?: GmailPayloadPart; snippet?: string }>;
    };
    for (const msg of data.messages ?? []) {
      const body = msg.payload
        ? __extractCleanMailTextFromGmailPayloadForTests(msg.payload, msg.snippet ?? "")
        : cleanMailTextForAi(msg.snippet ?? "");
      const url = extractMeetingUrlFromText(body);
      if (url) return url;
    }
    return null;
  } catch {
    return null;
  }
}

function buildMeetingUrlSearchQuery(params: {
  fromDomain: string | null;
  companyName: string | null;
  eventDate: string | null;
}): string {
  const parts: string[] = [];
  parts.push("-category:social -category:promotions");
  parts.push("(teams.microsoft.com OR meet.google.com OR zoom.us OR webex.com)");
  if (params.fromDomain) parts.push(`from:${params.fromDomain}`);
  if (params.companyName) parts.push(`(${params.companyName})`);
  if (params.eventDate) {
    const ymd = params.eventDate;
    const ymdSlash = ymd.replace(/-/g, "/");
    const md = ymd.slice(5).replace("-", "/");
    parts.push(`(${ymd} OR ${ymdSlash} OR ${md})`);
  }
  parts.push("newer_than:180d");
  return parts.join(" ");
}

export function __buildMeetingUrlSearchQueryForTests(params: {
  fromDomain: string | null;
  companyName: string | null;
  eventDate: string | null;
}): string {
  return buildMeetingUrlSearchQuery(params);
}

async function searchGmailMessageIds(params: {
  accessToken: string;
  q: string;
  maxResults: number;
}): Promise<string[]> {
  const { accessToken, q, maxResults } = params;
  try {
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < maxResults) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(Math.min(50, maxResults - ids.length)));
      url.searchParams.set("q", q);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return ids;
      const data = (await res.json()) as { messages?: Array<{ id: string }>; nextPageToken?: string };
      for (const m of data.messages ?? []) {
        if (m.id) ids.push(m.id);
        if (ids.length >= maxResults) break;
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  } catch {
    return [];
  }
}

async function fetchMeetingUrlBySearch(params: {
  accessToken: string;
  fromDomain: string | null;
  companyName: string | null;
  eventDate: string | null;
  excludeMessageId: string;
}): Promise<string | null> {
  const q = buildMeetingUrlSearchQuery({
    fromDomain: params.fromDomain,
    companyName: params.companyName,
    eventDate: params.eventDate,
  });
  const ids = await searchGmailMessageIds({ accessToken: params.accessToken, q, maxResults: 12 });
  for (const id of ids) {
    if (!id || id === params.excludeMessageId) continue;
    const detail = await fetchEmailDetail(params.accessToken, id);
    if (!detail) continue;
    const url = extractMeetingUrlFromText(detail.body);
    if (url) return url;
  }
  return null;
}

async function fetchGmailProfileHistoryId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { historyId?: string };
    return data.historyId ?? null;
  } catch {
    return null;
  }
}

type GmailHistoryResponse = {
  history?: Array<{
    messages?: Array<{ id: string; threadId?: string }>;
    messagesAdded?: Array<{ message?: { id: string; threadId?: string } }>;
    labelsAdded?: Array<{ message?: { id: string; threadId?: string } }>;
    labelsRemoved?: Array<{ message?: { id: string; threadId?: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

async function listGmailHistoryChanges(params: {
  accessToken: string;
  startHistoryId: string;
}): Promise<{ messageIds: string[]; latestHistoryId: string | null } | null> {
  const { accessToken, startHistoryId } = params;
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;

  while (true) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("labelId", "INBOX");
    url.searchParams.append("historyTypes", "messageAdded");
    url.searchParams.append("historyTypes", "labelAdded");
    url.searchParams.append("historyTypes", "labelRemoved");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;

    const data = (await res.json()) as GmailHistoryResponse;
    latestHistoryId = data.historyId ?? latestHistoryId;
    for (const h of data.history ?? []) {
      for (const m of h.messages ?? []) {
        if (m.id) messageIds.push(m.id);
      }
      for (const a of h.messagesAdded ?? []) {
        const id = a.message?.id;
        if (id) messageIds.push(id);
      }
      for (const a of h.labelsAdded ?? []) {
        const id = a.message?.id;
        if (id) messageIds.push(id);
      }
      for (const a of h.labelsRemoved ?? []) {
        const id = a.message?.id;
        if (id) messageIds.push(id);
      }
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  const seen = new Set<string>();
  const deduped = messageIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return { messageIds: deduped, latestHistoryId };
}

// ─── Mail Monitor Agent ────────────────────────────────────────────────────────

const DATE_PATTERNS = [
  /(\d{4})年(\d{1,2})月(\d{1,2})日/,
  /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  /(\d{4})-(\d{2})-(\d{2})/,
];

const TIME_PATTERNS = [
  /(\d{1,2})時(\d{2})?分?/,
  /(\d{1,2}):(\d{2})/,
];

const typeLabels: Record<EmailEvent["eventType"], string> = {
  interview: "【面接】",
  briefing: "【説明会】",
  test: "【試験】",
  deadline: "【締切】",
  entry: "【エントリー】",
  offer: "【内定】",
  rejection: "【結果通知】",
  other: "【就活】",
};

type JobStatus =
  | "researching"
  | "applied"
  | "briefing"
  | "es_preparing"
  | "es_submitted"
  | "document_screening"
  | "written_test"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "interview_4"
  | "interview_final"
  | "offer"
  | "rejected"
  | "withdrawn";

function jobStatusRank(status: JobStatus): number {
  const ranks: Record<JobStatus, number> = {
    researching: 10,
    applied: 20,
    briefing: 30,
    es_preparing: 40,
    es_submitted: 45,
    document_screening: 50,
    written_test: 55,
    interview_1: 60,
    interview_2: 70,
    interview_3: 75,
    interview_4: 80,
    interview_final: 85,
    offer: 90,
    rejected: 90,
    withdrawn: 90,
  };
  return ranks[status] ?? 0;
}

function jobStatusFromEmailEventType(eventType: EmailEvent["eventType"]): JobStatus | null {
  if (eventType === "interview") return "interview_1";
  if (eventType === "test") return "written_test";
  if (eventType === "deadline") return "es_preparing";
  if (eventType === "briefing") return "briefing";
  if (eventType === "entry") return "applied";
  return null;
}

function inferHardOutcomeStatusFromText(text: string): JobStatus | null {
  const t = text.toLowerCase();
  if (
    /(不採用|見送り|お見送り|選考結果.*残念|残念ながら|ご縁がなく|ご期待に添え|希望に沿いかね|ご希望に沿いかね|沿いかねる結果|意に沿え|不合格|不通過)/.test(t) ||
    /(rejected|unfortunately|we regret|not selected)/.test(t)
  ) {
    return "rejected";
  }
  if (
    /(内定通知|内定のご連絡|内定のお知らせ|内定.*決定|採用内定|合格通知|合格のお知らせ|採用決定)/.test(t) ||
    /(offer\s*letter|job\s*offer|we are pleased to offer)/.test(t)
  ) {
    return "offer";
  }
  return null;
}

// Subjects that unambiguously mark a post-hoc result/notification email.
// These should never be treated as schedulable events, even if the body
// contains a date reference (e.g., the date of the already-completed interview
// or a reply deadline) or the LLM misclassifies them.
function isResultNotificationSubject(subject: string): boolean {
  return /(結果通知|選考結果|合否通知|合否のご連絡|お祈り|お見送り|不採用通知|不合格通知)/.test(subject);
}

function inferInterviewStatusFromText(text: string): JobStatus | null {
  const t = text.toLowerCase();
  if (/最終面接|最終選考|final\s*interview|last\s*interview/.test(t)) return "interview_final";
  if (/四次面[接談]|4次面[接談]|４次面[接談]|fourth\s*interview|4th\s*interview/.test(t)) return "interview_4";
  if (/三次面[接談]|3次面[接談]|３次面[接談]|third\s*interview|3rd\s*interview/.test(t)) return "interview_3";
  if (/二次面[接談]|2次面[接談]|２次面[接談]|second\s*interview|2nd\s*interview/.test(t)) return "interview_2";
  if (/一次面[接談]|1次面[接談]|１次面[接談]|first\s*interview|1st\s*interview/.test(t)) return "interview_1";
  if (
    /(最終選考|final\s*selection)/.test(t) &&
    /(面[接談]|interview|選考|selection|web面接|online)/.test(t)
  ) {
    return "interview_final";
  }
  if (
    /(四次選考|4次選考|４次選考)/.test(t) &&
    /(面[接談]|interview|選考|selection|web面接|online)/.test(t)
  ) {
    return "interview_4";
  }
  if (
    /(三次選考|3次選考|３次選考)/.test(t) &&
    /(面[接談]|interview|選考|selection|web面接|online)/.test(t)
  ) {
    return "interview_3";
  }
  if (
    /(二次選考|2次選考|２次選考)/.test(t) &&
    /(面[接談]|interview|選考|selection|web面接|online)/.test(t)
  ) {
    return "interview_2";
  }
  if (
    /(一次選考|1次選考|１次選考)/.test(t) &&
    /(面[接談]|interview|選考|selection|web面接|online)/.test(t)
  ) {
    return "interview_1";
  }
  // Standalone round markers only when adjacent to 面接/選考 context
  if (/最終/.test(t) && /面[接談]|選考/.test(t)) return "interview_final";
  return null;
}

export function __inferInterviewStatusFromTextForTests(text: string): JobStatus | null {
  return inferInterviewStatusFromText(text);
}

function jobStatusLabelZh(status: JobStatus): string {
  if (status === "researching") return "调研/准备";
  if (status === "applied") return "エントリー済み";
  if (status === "briefing") return "说明会";
  if (status === "es_preparing") return "ES 准备";
  if (status === "es_submitted") return "已提交 ES";
  if (status === "document_screening") return "書類選考中";
  if (status === "written_test") return "筆記試験";
  if (status === "interview_1") return "一面";
  if (status === "interview_2") return "二面";
  if (status === "interview_3") return "三次面接";
  if (status === "interview_4") return "四次面接";
  if (status === "interview_final") return "终面";
  if (status === "offer") return "已拿到 offer";
  if (status === "rejected") return "未通过";
  if (status === "withdrawn") return "已撤回";
  return status;
}

function normalizeCompanyName(name: string | null | undefined): string | null {
  return resolveCanonicalCompanyName(name);
}

function nextStepsZh(status: JobStatus): string[] {
  if (status === "researching") return ["确认投递岗位与截止时间", "准备 ES 的两段核心素材（志望动机/自己PR）"];
  if (status === "applied") return ["确认网申是否完成并保存凭证", "补齐后续材料清单与截止日期"];
  if (status === "briefing") return ["确认说明会时间与参加方式", "准备 2 个聚焦岗位的问题"];
  if (status === "es_preparing") return ["把志望动机写成 5 句（公司痛点→你的能力→为什么现在）", "整理 1 个可量化 STAR 案例用于自己PR"];
  if (status === "es_submitted") return ["准备面试用的 30 秒自我介绍", "准备 3 个高价值逆質問"];
  if (status === "document_screening") return ["确认筛选周期与反馈时间", "先准备常见面试题与案例证据"];
  if (status === "written_test") return ["确认笔试范围与平台", "做一套时限模拟题并复盘错题"];
  if (status === "interview_1") return ["整理面试题库：动机/强项/失败经历", "把 ES 的每一句都准备可追问的证据"];
  if (status === "interview_2") return ["补齐职业规划与岗位匹配的逻辑链", "准备 1 个'你如何推进项目'的深挖案例"];
  if (status === "interview_3") return ["补充跨团队协作与抗压案例", "准备对业务理解和价值贡献的回答"];
  if (status === "interview_4") return ["准备高层关注点：入社动机与长期发展", "确认最后一轮的提问清单和条件确认项"];
  if (status === "interview_final") return ["准备入社动机与价值观对齐", "准备薪资/条件/入社时间的确认问题"];
  if (status === "offer") return ["确认条件（入社时间/勤務地/待遇）", "准备对比与决策标准"];
  if (status === "rejected") return ["复盘 1 个关键失分点并改写答案", "把经验迁移到下一家公司投递"];
  if (status === "withdrawn") return ["记录撤回原因与学到的筛选标准", "更新投递优先级列表"];
  return [];
}

async function upsertJobProgressFromMail(params: {
  userId: number;
  companyName: string;
  nextStatus: JobStatus;
  mail?: {
    messageId: string;
    from: string;
    subject: string;
    snippet?: string;
    reason?: string;
  };
}): Promise<{ changed: boolean; jobId: number | null; prevStatus: JobStatus | null; nextStatus: JobStatus }> {
  const { userId, companyName, nextStatus } = params;
  const canonicalCompanyName = resolveCanonicalCompanyName(companyName) ?? companyName;
  const targetKey = normalizeCompanyKey(canonicalCompanyName);
  const jobs = await getJobApplications(userId);
  const existing = jobs.find((j) => {
    const jaKey = normalizeCompanyKey(j.companyNameJa);
    const enKey = normalizeCompanyKey(j.companyNameEn);
    if (targetKey) return jaKey === targetKey || enKey === targetKey;
    return j.companyNameJa === canonicalCompanyName || j.companyNameEn === canonicalCompanyName;
  });
  if (!existing) {
    await createJobApplication({ userId, companyNameJa: canonicalCompanyName });
    const fresh = await getJobApplications(userId);
    const created = fresh.find((j) => {
      const jaKey = normalizeCompanyKey(j.companyNameJa);
      if (targetKey && jaKey) return jaKey === targetKey;
      return j.companyNameJa === canonicalCompanyName;
    }) ?? null;
    if (created) {
      await updateJobApplicationStatus(created.id, userId, nextStatus);
      await createJobStatusEvent({
        userId,
        jobApplicationId: created.id,
        source: "gmail",
        prevStatus: null,
        nextStatus,
        mailMessageId: params.mail?.messageId ?? null,
        mailFrom: params.mail?.from ?? null,
        mailSubject: params.mail?.subject ?? null,
        mailSnippet: params.mail?.snippet ?? null,
        reason: params.mail?.reason ?? null,
      });
      return { changed: true, jobId: created.id, prevStatus: null, nextStatus };
    }
    return { changed: false, jobId: null, prevStatus: null, nextStatus };
  }

  const prevStatus = existing.status as JobStatus;
  const shouldAdvance = jobStatusRank(nextStatus) > jobStatusRank(prevStatus);
  if (shouldAdvance) {
    await updateJobApplicationStatus(existing.id, userId, nextStatus);
    await createJobStatusEvent({
      userId,
      jobApplicationId: existing.id,
      source: "gmail",
      prevStatus,
      nextStatus,
      mailMessageId: params.mail?.messageId ?? null,
      mailFrom: params.mail?.from ?? null,
      mailSubject: params.mail?.subject ?? null,
      mailSnippet: params.mail?.snippet ?? null,
      reason: params.mail?.reason ?? null,
    });
    return { changed: true, jobId: existing.id, prevStatus, nextStatus };
  }
  await createJobStatusEvent({
    userId,
    jobApplicationId: existing.id,
    source: "gmail",
    prevStatus,
    nextStatus: prevStatus,
    mailMessageId: params.mail?.messageId ?? null,
    mailFrom: params.mail?.from ?? null,
    mailSubject: params.mail?.subject ?? null,
    mailSnippet: params.mail?.snippet ?? null,
    reason: params.mail?.reason ?? null,
  });
  return { changed: false, jobId: existing.id, prevStatus, nextStatus: prevStatus };
}

// Only events that represent a real appointment should be written to calendar.
const CALENDAR_WRITABLE_TYPES: EmailEvent["eventType"][] = ["interview", "briefing", "test", "deadline"];

interface CareerpassmailDecision extends Partial<EmailEvent> {
  isJobRelated: boolean;
  confidence: number;
  reason: string;
}

function calendarColorForEventType(
  eventType: EmailEvent["eventType"],
  prefs: { briefing: string; interview: string; deadline: string }
): string | undefined {
  if (eventType === "briefing") return prefs.briefing;
  if (eventType === "interview") return prefs.interview;
  if (eventType === "deadline" || eventType === "test") return prefs.deadline;
  return undefined;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.co.jp",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "qq.com",
  "163.com",
]);

const JOB_RELATED_DOMAIN_HINTS = [
  "recruit",
  "career",
  "saiyo",
  "hr",
  "job",
  "talent",
  "mypage",
  "rikunabi",
  "mynavi",
  "wantedly",
];

function getSenderDomain(from: string): string | null {
  const m = from.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return m?.[1]?.toLowerCase() ?? null;
}

function senderDomainScore(from: string): number {
  const domain = getSenderDomain(from);
  if (!domain) return 0;
  if (FREE_MAIL_DOMAINS.has(domain)) return 0.1;
  if (JOB_RELATED_DOMAIN_HINTS.some(hint => domain.includes(hint))) return 0.95;
  return 0.6;
}

function extractCompanyName(from: string, subject: string): string | null {
  // Extract from email domain
  const domainMatch = from.match(/@([^.>]+)\./);
  if (domainMatch) {
    const domain = domainMatch[1];
    // Skip common email providers
    if (!["gmail", "yahoo", "hotmail", "outlook", "icloud"].includes(domain)) {
      return domain;
    }
  }
  return null;
}

function extractDate(text: string): { date: string | null; time: string | null } {
  let date: string | null = null;
  let time: string | null = null;

  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const year = m[1];
      const month = String(m[2]).padStart(2, "0");
      const day = String(m[3]).padStart(2, "0");
      date = `${year}-${month}-${day}`;
      break;
    }
  }

  for (const pattern of TIME_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const hour = String(m[1]).padStart(2, "0");
      const min = m[2] ? String(m[2]).padStart(2, "0") : "00";
      time = `${hour}:${min}`;
      break;
    }
  }

  return { date, time };
}

function extractJapaneseTimeRange(text: string): { date: string | null; time: string | null } {
  // Examples:
  // 2026年4月10日(金) 14:00〜15:00
  // 2026/04/10 14:00-15:00
  const m = text.match(
    /(\d{4})[\/年.-](\d{1,2})[\/月.-](\d{1,2})日?(?:\([^)]+\))?\s*(\d{1,2})[:：時](\d{2})?\s*[~〜\-－]\s*(\d{1,2})[:：時]?(\d{2})?/
  );
  if (!m) return { date: null, time: null };
  const date = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  const time = `${String(m[4]).padStart(2, "0")}:${String(m[5] ?? "00").padStart(2, "0")}`;
  return { date, time };
}

async function runCareerpassmailAgent(input: {
  subject: string;
  body: string;
  from: string;
}): Promise<CareerpassmailDecision & { _meta?: { pipelineOnly?: boolean; pipelineShouldSkipLlm?: boolean } }> {
  const domain = getSenderDomain(input.from);
  const domainSignal = senderDomainScore(input.from);
  const localized = extractJapaneseTimeRange(`${input.subject}\n${input.body}`);
  const basic = extractDate(`${input.subject}\n${input.body}`);
  const preflight = runRecruitingNlpPipeline({
    subject: input.subject,
    body: input.body,
    from: input.from,
    domainSignal,
    fallbackDate: localized.date ?? basic.date ?? null,
    fallbackTime: localized.time ?? basic.time ?? null,
  });
  if (preflight.shouldSkipLlm) {
    console.info("[careerpassmail] preflight-skip-llm", {
      from: input.from.slice(0, 120),
      subject: input.subject.slice(0, 120),
      reason: preflight.reason,
      eventType: preflight.eventType,
      companyName: preflight.companyName,
      confidence: preflight.confidence,
    });
    return {
      isJobRelated: preflight.isJobRelated,
      confidence: preflight.confidence,
      reason: preflight.reason,
      eventType: preflight.eventType,
      companyName: preflight.companyName,
      eventDate: preflight.eventDate,
      eventTime: preflight.eventTime,
      location: preflight.location,
      todoItems: preflight.todoItems,
      _meta: {
        pipelineOnly: true,
        pipelineShouldSkipLlm: true,
      },
    };
  }

  // Build pre-flight NER hints to give the LLM a head-start
  const nerCompany = preflight.companyName;
  const nerDate = preflight.eventDate;
  const nerTime = preflight.eventTime;
  const nerLocation = preflight.location;
  const ruleHint = (preflight._meta?.ruleSignals ?? [])
    .map((s) => `${s.eventType}(${s.confidence.toFixed(2)})`)
    .join(", ") || "none";
  const domainTier = preflight._meta?.domainReputation?.tier ?? "unknown";

  const systemPrompt = `你是 CareerPass 的"邮件监控 Agent"——一个专业的日本求职邮件智能分析系统。
你的核心任务是深度语义理解邮件内容，判断是否与求职相关，并精准抽取结构化字段。

## 判断原则

1. **语义优先**：以 Transformer 级别的深度语义理解为主，不依赖关键词简单匹配。
   - 区分"面接のご案内"（面试邀请）与"面接結果のご連絡"（结果通知）——即使都含有"面接"。
   - 区分"説明会のご案内"（说明会）与"エントリー完了のお知らせ"（报名确认）。
   - 理解语气和意图：客气的拒绝表达（「ご期待に添えず」）仍是拒绝。
2. **多信号融合**：结合发件人域名类型(${domainTier})、邮件语气、是否包含行动要求（URL/日期/集合地点）来综合判断。
3. **公司名提取**：
   - companyName 必须是用户正在应聘的**实际企业名**。
   - 求职平台（就活会議/OpenWork/ONE CAREER/リクナビ/マイナビ/OfferBox 等）**绝不可**作为 companyName。
   - 优先提取「株式会社XX」等法人名称，其次从发件人/件名中推断。
4. **事件时间提取**：注意日本特有格式：2026年4月10日(金) 14:00〜15:00、■日時、【日時】等。
5. **Noise 过滤**：含"配信停止""メルマガ""おすすめ求人""口コミ"等的邮件大概率是噪音。

## eventType 判断细则

| eventType | 含义 | 典型特征 |
|-----------|------|----------|
| interview | 面接/面談の案内 | 有日時/場所/Zoom URL、要求准备（含カジュアル面談、書類選考通過） |
| briefing | 説明会/セミナー | 企業情報提供、无选考性质 |
| test | Webテスト/SPI/筆記 | 含测试 URL/期限（コーディングテスト等） |
| deadline | ES/書類提出締切 | 含明确截止日期 |
| entry | エントリー/応募受付 | 确认报名成功、書類選考のご案内 |
| offer | 内定/採用通知 | 正面结果 |
| rejection | 不採用/お見送り | 负面结果、含"お祈り" |
| other | 不属于上述 / 不确定 | 给低 confidence |

**关键区分**：entry 是"报名行为确认"，briefing 是"信息提供活动"。不可混淆。

## Few-shot 示例

**示例1** — 面试邀请（正例）
件名: 【株式会社ABC】一次面接のご案内
正文: ...2026年4月15日(火) 14:00〜14:45 オンライン（Zoom）...
→ {"isJobRelated":true,"confidence":0.95,"reason":"面接日程案内+日時あり","eventType":"interview","companyName":"株式会社ABC","eventDate":"2026-04-15","eventTime":"14:00","location":"オンライン（Zoom）","todoItems":["确认Zoom链接和面试形式","准备1分钟自我介绍和志望动机"]}

**示例2** — 拒信（容易误判为"結果通知"）
件名: 選考結果のご連絡
正文: ...誠に残念ではございますが、今回は貴意に沿えない結果となりました...
→ {"isJobRelated":true,"confidence":0.97,"reason":"お祈りメール:語気から不採用","eventType":"rejection","companyName":"...","eventDate":null,"eventTime":null,"location":null,"todoItems":["记录原因并更新投递策略"]}

**示例3** — 平台噪音（应排除）
件名: 【就活会議】新着企業口コミのお知らせ
正文: あなたにおすすめの企業口コミが届いています...配信停止はこちら
→ {"isJobRelated":false,"confidence":0.95,"reason":"求人プラットフォーム通知、求職行為に直接関連しない","eventType":"other","companyName":null,"eventDate":null,"eventTime":null,"location":null,"todoItems":[]}

**示例4** — 说明会 vs エントリー 区分
件名: 会社説明会のご予約確認
正文: ...下記日程で説明会のご予約を承りました。2026/04/20 10:00〜11:30...
→ {"isJobRelated":true,"confidence":0.90,"reason":"説明会予約確認","eventType":"briefing","companyName":"...","eventDate":"2026-04-20","eventTime":"10:00","location":null,"todoItems":["确认参加方式","准备2个问题"]}

## 规则引擎预判（参考信息，不强制覆盖你的语义判断）
- 规则引擎匹配: [${ruleHint}]
- NER 提取公司名: ${nerCompany ?? "未提取到"}
- NER 提取日期: ${nerDate ?? "未提取到"} ${nerTime ?? ""}
- NER 提取地点: ${nerLocation ?? "未提取到"}

你可以参考以上信息，但如果你的语义理解与规则冲突，以语义为准（除非是明确的 offer/rejection 硬判断）。

## 输出格式

严格输出一个 JSON object，不输出任何多余文本：
{
  "isJobRelated": boolean,
  "confidence": number (0-1),
  "reason": string (简短判断依据),
  "eventType": "interview" | "briefing" | "test" | "deadline" | "entry" | "offer" | "rejection" | "other",
  "companyName": string | null,
  "eventDate": "YYYY-MM-DD" | null,
  "eventTime": "HH:MM" | null,
  "location": string | null,
  "todoItems": string[] (最多3条)
}`;
  const soul = await loadAgentSoul("careerpassmail");
  const agents = await loadAgentAgents("careerpassmail");
  const systemWithSoul = soul.content ? `${systemPrompt}\n\n[SOUL]\n${soul.content}` : systemPrompt;
  const systemWithSoulAndAgents = agents.content ? `${systemWithSoul}\n\n[AGENTS]\n${agents.content}` : systemWithSoul;
  const effectiveSystemPrompt =
    `${systemWithSoulAndAgents}\n\n` +
    `【输出格式强约束】你必须严格输出一个 JSON object，且不得输出任何多余文本。若[SOUL]/[AGENTS]与输出格式冲突，以输出格式为准。`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        {
          role: "user",
          content:
            `件名: ${input.subject}\n\n` +
            `送信者: ${input.from}\n` +
            `送信者ドメイン: ${domain ?? "unknown"} (${domainTier})\n` +
            `送信者ドメイン信号: ${domainSignal}\n\n` +
            `正文:\n${input.body.slice(0, 2500)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      const parsed = JSON.parse(content) as CareerpassmailDecision;
      const merged = runRecruitingNlpPipeline(
        {
          subject: input.subject,
          body: input.body,
          from: input.from,
          domainSignal,
          fallbackDate: localized.date ?? basic.date ?? null,
          fallbackTime: localized.time ?? basic.time ?? null,
        },
        parsed
      );
      return {
        isJobRelated: merged.isJobRelated,
        confidence: merged.confidence,
        reason: merged.reason,
        eventType: merged.eventType,
        companyName: merged.companyName,
        eventDate: merged.eventDate,
        eventTime: merged.eventTime,
        location: merged.location,
        todoItems: merged.todoItems,
        _meta: {
          pipelineOnly: true,
          pipelineShouldSkipLlm: false,
        },
      };
    }
  } catch (err) {
    console.error("[careerpassmail] semantic monitor failed:", err);
  }

  // Fallback: conservative domain/time heuristic.
  const fallback = runRecruitingNlpPipeline({
    subject: input.subject,
    body: input.body,
    from: input.from,
    domainSignal,
    fallbackDate: localized.date ?? basic.date ?? null,
    fallbackTime: localized.time ?? basic.time ?? null,
  });
  return {
    isJobRelated: fallback.isJobRelated,
    confidence: fallback.confidence,
    reason: `fallback-pipeline:${fallback.reason}`,
    eventType: fallback.eventType,
    companyName: fallback.companyName ?? extractCompanyName(input.from, input.subject),
    eventDate: fallback.eventDate,
    eventTime: fallback.eventTime,
    location: fallback.location,
    todoItems: fallback.todoItems,
    _meta: {
      pipelineOnly: true,
      pipelineShouldSkipLlm: false,
    },
  };
}

async function reportToCareerpassAgent(userId: number, event: EmailEvent, reason: string) {
  try {
    const summary =
      `System: careerpassmail detected job-related mail.\n` +
      `Type: ${event.eventType}\n` +
      `Company: ${event.companyName ?? "unknown"}\n` +
      `DateTime: ${event.eventDate ?? "unknown"} ${event.eventTime ?? ""}\n` +
      `Subject: ${event.subject}\n` +
      `Reason: ${reason}`;
    await saveAgentMemory({
      userId,
      memoryType: "conversation",
      title: `careerpassmail ${new Date().toISOString()}`,
      content: summary,
      metadata: { source: "careerpassmail", eventType: event.eventType },
    });
  } catch (err) {
    console.error("[careerpassmail] Failed to report event to CareerPass memory:", err);
  }
}

// ─── Google Calendar Write ────────────────────────────────────────────────────

async function writeToGoogleCalendar(
  accessToken: string,
  event: CalendarEvent
): Promise<boolean> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export { sendTelegramMessage };

// ─── Main Monitor Function ────────────────────────────────────────────────────

export interface MonitorResult {
  scanned: number;
  detected: number;
  calendarEvents: number;
  events: EmailEvent[];
}

function buildLatestBoardScreenshotUrl(): string {
  return `${APP_DOMAIN.replace(/\/+$/, "")}/images/latest-dashboard-board.png`;
}

async function orchestrateSubAgents(userId: number, event: EmailEvent): Promise<string[]> {
  const actions: string[] = [];
  const companyName = event.companyName?.trim();
  if (!companyName) return actions;

  try {
    // Mail-driven workflow trigger:
    // careerpassmail identifies target company -> handoff to careerpass -> auto run recon -> ES -> interview.
    if (["interview", "briefing", "test", "deadline", "entry", "offer"].includes(event.eventType)) {
      const sid = `mail-${Date.now()}`;
      await startCompanyWorkflow(userId, companyName, "総合職", sid);
      actions.push(`careerpass:workflow-started:${companyName}`);
    }
  } catch (err) {
    console.error("[Gmail] Sub-agent orchestration failed:", err);
  }

  return actions;
}

interface ComposeNotificationInput {
  userId: number;
  companyName: string | null;
  eventType: EmailEvent["eventType"];
  rawEventType: EmailEvent["eventType"];
  date: string | null;
  time: string | null;
  location: string | null;
  todoItems: string[];
  mailLink: string;
  boardScreenshotLink: string | null;
  progressLabel: string | null;
  outcomeUncertain: boolean;
  workflowTriggered: boolean;
}

const TELEGRAM_MAIL_NOTICE_TTL_MS = 15 * 60 * 1000;
const telegramMailNoticeDedup = new Map<string, number>();

export function buildTelegramMailNoticeDedupKey(params: { userId: number; messageId: string }): string {
  return `${params.userId}:${params.messageId}`;
}

export function shouldSendTelegramMailNoticeOnce(params: {
  userId: number;
  messageId: string;
  nowMs?: number;
}): boolean {
  const now = params.nowMs ?? Date.now();
  for (const [k, expireAt] of telegramMailNoticeDedup.entries()) {
    if (expireAt <= now) telegramMailNoticeDedup.delete(k);
  }
  const key = buildTelegramMailNoticeDedupKey({ userId: params.userId, messageId: params.messageId });
  const existing = telegramMailNoticeDedup.get(key);
  if (existing && existing > now) return false;
  telegramMailNoticeDedup.set(key, now + TELEGRAM_MAIL_NOTICE_TTL_MS);
  return true;
}

export function __resetTelegramMailNoticeDedupForTests(): void {
  telegramMailNoticeDedup.clear();
}

function fallbackMailNotification(input: ComposeNotificationInput): string {
  const { companyName, eventType, date, time, todoItems, mailLink, boardScreenshotLink, progressLabel, outcomeUncertain, workflowTriggered } = input;
  const primaryAction =
    todoItems[0] ??
    (date
      ? `把 ${date}${time ? ` ${time}` : ""} JST 的${typeLabels[eventType]}加进日程并提前做准备`
      : `打开原邮件确认${typeLabels[eventType]}的具体安排`);
  const extra = todoItems.slice(1);
  const lines: string[] = [];
  lines.push(`下一步：${primaryAction}`);
  lines.push(
    `${companyName ?? "这家公司"}发来一封${typeLabels[eventType]}邮件${
      date ? `（${date}${time ? ` ${time}` : ""} JST）` : ""
    }。`
  );
  lines.push(`[查看原邮件](${mailLink})`);
  if (extra.length) {
    lines.push(`其他要做的：${extra.join("；")}`);
  }
  if (progressLabel) lines.push(`看板已更新到「${progressLabel}」。`);
  if (boardScreenshotLink) lines.push(`[查看最新看板截图](${boardScreenshotLink})`);
  if (outcomeUncertain) lines.push("这封邮件可能涉及结果，语义不够确定，我没有自动标记，方便时去看板确认。");
  if (workflowTriggered) lines.push("这家公司的后续流程我已经帮你往前推进了。");
  return lines.join("\n");
}

async function composeMailNotification(input: ComposeNotificationInput): Promise<string> {
  try {
    const soul = await loadAgentSoul("careerpass");
    const agents = await loadAgentAgents("careerpass");

    const facts = {
      公司: input.companyName ?? "未知",
      事件类型: typeLabels[input.eventType],
      日期: input.date ?? null,
      时间: input.time ? `${input.time} JST` : null,
      地点或链接: input.location ?? null,
      待办: input.todoItems,
      原邮件链接: input.mailLink,
      最新看板截图: input.boardScreenshotLink,
      看板已更新到: input.progressLabel,
      结果语义不确定: input.outcomeUncertain,
      已自动推进后续流程: input.workflowTriggered,
    };

    const systemPrompt =
      `你是 CareerPass，给用户在 Telegram 发一条短消息播报刚收到的求职邮件。` +
      `要求：\n` +
      `- 像朋友一样自然口吻，每次措辞都不一样，不要套固定模板。\n` +
      `- 开门见山点出「下一步要做什么」，但表达方式可以变化（不必每次都用「下一步：」开头）。\n` +
      `- 邮件内容只用一句话带过，不要复述邮件主题。\n` +
      `- 必须把「原邮件链接」用 markdown 链接的形式放进消息里，方便用户点开核对。\n` +
      `- 如果有「最新看板截图」，也用 markdown 链接放进去。\n` +
      `- **重要：整条通知必须只用 1 个气泡**，不要用空行分段，不要输出多段。\n` +
      `- 总长度控制在 6 行内，保证移动端易读。\n` +
      `- 只输出最终消息正文，不要加引号、不要解释。` +
      (soul.content ? `\n\n[SOUL]\n${soul.content}` : "") +
      (agents.content ? `\n\n[AGENTS]\n${agents.content}` : "");

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `这是刚识别到的求职邮件事实，请据此写一条 Telegram 通知：\n` +
            JSON.stringify(facts, null, 2),
        },
      ],
    });

    const raw = response?.choices?.[0]?.message?.content;
    const text = (typeof raw === "string" ? raw : "").trim();
    if (!text || !text.includes(input.mailLink)) {
      // LLM forgot the mail link — fall back to template to guarantee it.
      return fallbackMailNotification(input);
    }
    return text;
  } catch (err) {
    console.error("[careerpassmail] composeMailNotification failed:", err);
    return fallbackMailNotification(input);
  }
}

async function processGmailMessageIds(params: {
  userId: number;
  telegramChatId?: string;
  accessToken: string;
  messageIds: string[];
  notifyWindowDays?: number;
  suppressTelegramItemNotifications?: boolean;
  enableAutoBoardWrite?: boolean;
  enableAutoWorkflow?: boolean;
}): Promise<MonitorResult> {
  const {
    userId,
    telegramChatId,
    accessToken,
    messageIds,
    notifyWindowDays,
    suppressTelegramItemNotifications = false,
    enableAutoBoardWrite = true,
    enableAutoWorkflow = true,
  } = params;
  const calendarColorPrefs = await getUserCalendarColorPrefs(userId);
  const detectedEvents: EmailEvent[] = [];
  const isFirstForCompanyInBatch = createCompanyBatchDeduper();
  const threadMeetingUrlCache = new Map<string, string | null>();
  const searchMeetingUrlCache = new Map<string, string | null>();
  let calendarCount = 0;

  const notifyCutoffMs =
    notifyWindowDays && notifyWindowDays > 0
      ? Date.now() - notifyWindowDays * 24 * 60 * 60 * 1000
      : null;

  const fetched: Array<{
    messageId: string;
    detail: { subject: string; from: string; date: string; body: string; threadId: string | null };
    mailTs: number;
  }> = [];
  const fetchedResults = await mapWithConcurrency(messageIds, 12, async (messageId) => {
    try {
      const detail = await fetchEmailDetail(accessToken, messageId);
      if (!detail) return null;
      return { messageId, detail, mailTs: Date.parse(detail.date) };
    } catch (err) {
      console.error("[Gmail] Failed to fetch detail for message:", { userId, messageId, err });
      return null;
    }
  });
  for (const row of fetchedResults) {
    if (!row) continue;
    fetched.push(row);
  }

  const sorted = sortMailItemsByTsDesc(
    fetched.map((x) => ({ messageId: x.messageId, mailTs: x.mailTs, value: x.detail }))
  );

  const candidates: typeof sorted = [];
  for (const item of sorted) {
    const detail = item.value;
    // Hard exclude マイナビ/リクナビ-style "站内通知" mails — they carry no real content.
    const senderDomain = (getSenderDomain(detail.from) ?? "").toLowerCase();
    const isJobBoardSender =
      /mynavi|rikunabi|マイナビ|リクナビ/.test(detail.from) ||
      /mynavi|rikunabi/.test(senderDomain);
    const inboxNoticePattern =
      /(新着メッセージ|メッセージが届|マイページに新しい|新着のお知らせ|站内|站内信|新しいお知らせが届)/;
    if (isJobBoardSender && inboxNoticePattern.test(`${detail.subject}\n${detail.body}`)) {
      continue;
    }

    // Hard exclude 就活会議 / OpenWork / Vorkers / ONE CAREER — these are review/info
    // platforms, NOT companies the user is applying to. Emails from them should
    // never create a job application entry.
    const isReviewPlatformSender =
      /syukatsu-kaigi|syukatsukaigi|就活会議|openwork|vorkers|onecareer|one-career/.test(
        `${detail.from}\n${detail.subject}`.toLowerCase()
      ) ||
      /syukatsu-kaigi|syukatsukaigi|openwork|vorkers|onecareer|one-career/.test(senderDomain);
    if (isReviewPlatformSender) {
      continue;
    }
    candidates.push(item);
  }

  const analyzed = await mapWithConcurrency(candidates, 4, async (item) => {
    try {
      const decision = await runCareerpassmailAgent({
        subject: item.value.subject,
        body: item.value.body,
        from: item.value.from,
      });
      if (!decision.isJobRelated) return null;
      return { item, decision };
    } catch (err) {
      console.error("[Gmail] Failed to analyze message:", { userId, messageId: item.messageId, err });
      return null;
    }
  });

  for (const entry of analyzed) {
    if (!entry) continue;
    try {
      const item = entry.item;
      const decision = entry.decision;
      const messageId = item.messageId;
      const detail = item.value;
      const decisionMeta = decision._meta ?? {};

      const mailText = `${detail.subject}\n${detail.body}`;
      const hardOutcome = inferHardOutcomeStatusFromText(mailText);
      const rawEventType = decision.eventType ?? "other";
      // Result-notification subjects (結果通知 / 選考結果 / 合否通知 …) are never
      // schedulable events. Force them down to offer / rejection / other so they
      // bypass CALENDAR_WRITABLE_TYPES regardless of how the LLM classified them.
      const resultNotificationSubject = isResultNotificationSubject(detail.subject);
      const eventType = resultNotificationSubject
        ? hardOutcome === "offer"
          ? "offer"
          : hardOutcome === "rejected"
          ? "rejection"
          : "other"
        : rawEventType === "offer"
        ? hardOutcome === "offer"
          ? "offer"
          : "other"
        : rawEventType === "rejection"
        ? hardOutcome === "rejected"
          ? "rejection"
          : "other"
        : rawEventType;
      const date = decision.eventDate ?? null;
      const time = decision.eventTime ?? null;
      const companyName =
        normalizeCompanyName(decision.companyName) ??
        normalizeCompanyName(extractCompanyName(detail.from, detail.subject)) ??
        null;

      let location = decision.location ?? null;
      if (eventType === "interview" && detail.threadId) {
        const hasUrlInLocation = typeof location === "string" && /https?:\/\//i.test(location);
        const hasUrlInBody = /https?:\/\//i.test(mailText);
        const needsUrlHint = /(teams|zoom|webex|google\s*meet|会議に参加|参加ください|url|リンク)/i.test(mailText);
        if (!hasUrlInLocation && !hasUrlInBody && needsUrlHint) {
          const cached = threadMeetingUrlCache.get(detail.threadId);
          const url =
            cached !== undefined
              ? cached
              : await fetchThreadMeetingUrl(accessToken, detail.threadId).then((u) => {
                  threadMeetingUrlCache.set(detail.threadId as string, u);
                  return u;
                });
          let finalUrl = url ?? null;
          if (!finalUrl) {
            const senderDomain = getSenderDomain(detail.from);
            const cacheKey = `${senderDomain ?? "unknown"}|${companyName ?? "unknown"}|${date ?? "unknown"}`;
            const cachedSearch = searchMeetingUrlCache.get(cacheKey);
            finalUrl =
              cachedSearch !== undefined
                ? cachedSearch
                : await fetchMeetingUrlBySearch({
                    accessToken,
                    fromDomain: senderDomain,
                    companyName,
                    eventDate: date,
                    excludeMessageId: messageId,
                  }).then((u) => {
                    searchMeetingUrlCache.set(cacheKey, u);
                    return u;
                  });
          }
          if (finalUrl) {
            location = location ? `${location} ${finalUrl}` : finalUrl;
          }
        }
      }

      if (!decision.isJobRelated || !companyName) {
        console.info("[Gmail] analyze-drop", {
          userId,
          messageId,
          subject: detail.subject.slice(0, 120),
          from: detail.from.slice(0, 120),
          isJobRelated: decision.isJobRelated,
          companyName,
          reason: decision.reason,
          eventType: decision.eventType,
          pipelineShouldSkipLlm: decisionMeta.pipelineShouldSkipLlm ?? false,
        });
      }

      const emailEvent: EmailEvent = {
        subject: detail.subject,
        from: detail.from,
        date: detail.date,
        body: detail.body.slice(0, 500),
        eventType,
        companyName,
        eventDate: date,
        eventTime: time,
        location,
        todoItems: decision.todoItems ?? [],
        mailLink: `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
      };

      detectedEvents.push(emailEvent);
      await reportToCareerpassAgent(userId, emailEvent, decision.reason);

      const stageStatus =
        rawEventType === "interview" || rawEventType === "test" || /面接|interview/.test(mailText.toLowerCase())
          ? inferInterviewStatusFromText(mailText)
          : null;
      const desiredStatus = hardOutcome ?? stageStatus ?? jobStatusFromEmailEventType(eventType);
      const inferredStatus = companyName ? desiredStatus : null;
      if (decision.isJobRelated && (!companyName || !inferredStatus)) {
        console.info("[Gmail] board-write-skip", {
          userId,
          messageId,
          subject: detail.subject.slice(0, 120),
          from: detail.from.slice(0, 120),
          companyName,
          eventType,
          rawEventType,
          hardOutcome: hardOutcome ?? null,
          stageStatus: stageStatus ?? null,
          reason: decision.reason,
        });
      }
      const progressUpdate =
        enableAutoBoardWrite && inferredStatus && companyName
          ? await upsertJobProgressFromMail({
              userId,
              companyName,
              nextStatus: inferredStatus,
              mail: {
                messageId,
                from: detail.from,
                subject: detail.subject,
                snippet: detail.body.slice(0, 120),
                reason: `${decision.reason ?? ""} (eventType=${rawEventType}, hardOutcome=${hardOutcome ?? "none"})`,
              },
            })
          : null;

      if (companyName) {
        await trackCompanyForBilling({
          userId,
          companyName,
          firstStatus: inferredStatus,
          occurredAt: Number.isFinite(Date.parse(detail.date)) ? new Date(detail.date) : null,
        });
      }

      if (enableAutoBoardWrite && companyName) {
        try {
          await syncJobToNotionBoard({
            userId,
            companyName,
            status: inferredStatus ?? null,
            eventType,
            eventDate: date,
            eventTime: time,
            location,
            mailSubject: detail.subject,
            source: "gmail",
          });
        } catch (e) {
          console.warn("[Notion] Gmail sync failed:", (e as Error).message);
        }
      }

      // Decide whether to notify the user about this mail.
      // - First-scan window: skip notifications for mails older than notifyWindowDays
      //   (the dashboard/Notion sync above still runs, so the board stays complete).
      // - Same-company dedup: only notify for the newest mail per company in this batch.
      const mailTs = item.mailTs;
      const isWithinWindow =
        notifyCutoffMs === null || (Number.isFinite(mailTs) && mailTs >= notifyCutoffMs);

      const companyKey = companyName?.toLowerCase() ?? null;
      const isNewestForCompany = isFirstForCompanyInBatch(companyKey);

      const shouldNotify =
        !suppressTelegramItemNotifications && isWithinWindow && isNewestForCompany;

      let orchestrationActions: string[] = [];
      if (telegramChatId && shouldNotify) {
        if (!shouldSendTelegramMailNoticeOnce({ userId, messageId })) {
          console.info("[Gmail] telegram-notice-dedup-skip", { userId, messageId });
          continue;
        }
        orchestrationActions = enableAutoWorkflow
          ? await orchestrateSubAgents(userId, emailEvent)
          : [];
        const workflowTriggered = orchestrationActions.length > 0;

        const mailLink = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
        const boardScreenshotLink =
          progressUpdate && progressUpdate.jobId && progressUpdate.changed
            ? buildLatestBoardScreenshotUrl()
            : null;

        const notifText = await composeMailNotification({
          userId,
          companyName,
          eventType,
          rawEventType,
          date,
          time,
          location: emailEvent.location,
          todoItems: emailEvent.todoItems,
          mailLink,
          boardScreenshotLink,
          progressLabel:
            progressUpdate && progressUpdate.jobId && progressUpdate.changed
              ? jobStatusLabelZh(progressUpdate.nextStatus)
              : null,
          outcomeUncertain:
            (rawEventType === "offer" || rawEventType === "rejection") && !hardOutcome,
          workflowTriggered,
        });
        await sendTelegramMessage(telegramChatId, notifText);
      }

      if (date && CALENDAR_WRITABLE_TYPES.includes(eventType)) {
        const startDateTime = time ? `${date}T${time}:00` : `${date}T09:00:00`;
        const endDateTime = time
          ? `${date}T${String(parseInt(time.split(":")[0]) + 1).padStart(2, "0")}:${time.split(":")[1]}:00`
          : `${date}T10:00:00`;

        const colorId = calendarColorForEventType(eventType, calendarColorPrefs);
        const mailLink = `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
        const todoText = emailEvent.todoItems.length > 0
          ? emailEvent.todoItems.map(t => `- ${t}`).join("\n")
          : "- なし";
        const calEvent: CalendarEvent & { colorId?: string } = {
          summary: `${typeLabels[eventType]}${companyName ?? ""} - ${detail.subject.slice(0, 40)}`,
          description: [
            "CareerPass 自動登録",
            "",
            `種別: ${typeLabels[eventType]}`,
            `会社: ${companyName ?? "未特定"}`,
            `日時: ${date}${time ? ` ${time}` : ""} (JST)`,
            `場所/リンク: ${emailEvent.location ?? "未記入"}`,
            "",
            "やるべきこと:",
            todoText,
            "",
            `メール件名: ${detail.subject.slice(0, 160)}`,
            `送信元: ${detail.from.slice(0, 160)}`,
            `Gmail: ${mailLink}`,
            `MessageId: ${messageId}`,
            "",
            "本文はプライバシー保護のためカレンダーには記載しません。必要なら Gmail を開いて確認してください。",
          ].join("\n"),
          start: { dateTime: `${startDateTime}+09:00`, timeZone: "Asia/Tokyo" },
          end: { dateTime: `${endDateTime}+09:00`, timeZone: "Asia/Tokyo" },
          colorId,
        };

        const written = await writeToGoogleCalendar(accessToken, calEvent);
        if (written) {
          calendarCount++;
        } else if (telegramChatId) {
          await sendTelegramMessage(
            telegramChatId,
            `⚠️ 检测到邮件事件，但写入 Google Calendar 失败。\n📧 ${detail.subject.slice(0, 80)}`
          );
        }
      }
    } catch (err) {
      console.error("[Gmail] Failed to process analyzed message. Continue with next one.", {
        userId,
        messageId: entry.item.messageId,
        err,
      });
    }
  }

  return {
    scanned: messageIds.length,
    detected: detectedEvents.length,
    calendarEvents: calendarCount,
    events: detectedEvents,
  };
}

export async function monitorGmailAndSync(
  userId: number,
  telegramChatId?: string,
  options?: {
    notifyWindowDays?: number;
    suppressTelegramItemNotifications?: boolean;
    enableAutoBoardWrite?: boolean;
    enableAutoWorkflow?: boolean;
    fullMailboxScan?: boolean;
  }
): Promise<MonitorResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { scanned: 0, detected: 0, calendarEvents: 0, events: [] };
  }

  const state = await getGoogleAccountSyncState(userId);
  const fullMailboxScan = options?.fullMailboxScan ?? !state?.lastHistoryId;
  const ids = await fetchInboxMessageIds({
    accessToken,
    fullMailbox: fullMailboxScan,
    maxResults: fullMailboxScan ? null : 50,
  });

  const result = await processGmailMessageIds({
    userId,
    telegramChatId,
    accessToken,
    messageIds: ids,
    notifyWindowDays: options?.notifyWindowDays,
    suppressTelegramItemNotifications: options?.suppressTelegramItemNotifications ?? false,
    enableAutoBoardWrite: options?.enableAutoBoardWrite ?? true,
    enableAutoWorkflow: options?.enableAutoWorkflow ?? true,
  });

  // When first initialized via /checkmail or fallback scan, persist the current
  // history checkpoint so later push events can switch to incremental mode.
  if (fullMailboxScan && !state?.lastHistoryId) {
    const profileHistoryId = await fetchGmailProfileHistoryId(accessToken);
    if (profileHistoryId) {
      await updateGoogleLastHistoryIdIfNewer(userId, profileHistoryId);
    }
  }

  return result;
}

export async function syncGmailIncremental(
  userId: number,
  telegramChatId: string | undefined,
  endHistoryId: string,
  options?: {
    suppressTelegramItemNotifications?: boolean;
    enableAutoBoardWrite?: boolean;
    enableAutoWorkflow?: boolean;
  }
): Promise<MonitorResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { scanned: 0, detected: 0, calendarEvents: 0, events: [] };
  }

  const state = await getGoogleAccountSyncState(userId);
  const startHistoryId = state?.lastHistoryId ?? null;

  if (!startHistoryId) {
    // First scan (no prior historyId) — sync everything to the board, but only
    // notify the user about mails from the last 14 days to avoid an avalanche.
    const fallback = await monitorGmailAndSync(userId, telegramChatId, {
      notifyWindowDays: 14,
      suppressTelegramItemNotifications: options?.suppressTelegramItemNotifications ?? false,
      enableAutoBoardWrite: options?.enableAutoBoardWrite ?? true,
      enableAutoWorkflow: options?.enableAutoWorkflow ?? true,
      fullMailboxScan: true,
    });
    const profileHistoryId = await fetchGmailProfileHistoryId(accessToken);
    if (profileHistoryId) {
      await updateGoogleLastHistoryIdIfNewer(userId, profileHistoryId);
    } else {
      await updateGoogleLastHistoryIdIfNewer(userId, endHistoryId);
    }
    return fallback;
  }

  const changes = await listGmailHistoryChanges({ accessToken, startHistoryId });
  if (!changes) {
    // First scan (no prior historyId) — sync everything to the board, but only
    // notify the user about mails from the last 14 days to avoid an avalanche.
    const fallback = await monitorGmailAndSync(userId, telegramChatId, {
      notifyWindowDays: 14,
      suppressTelegramItemNotifications: options?.suppressTelegramItemNotifications ?? false,
      enableAutoBoardWrite: options?.enableAutoBoardWrite ?? true,
      enableAutoWorkflow: options?.enableAutoWorkflow ?? true,
      fullMailboxScan: true,
    });
    const profileHistoryId = await fetchGmailProfileHistoryId(accessToken);
    if (profileHistoryId) {
      await updateGoogleLastHistoryIdIfNewer(userId, profileHistoryId);
    } else {
      await updateGoogleLastHistoryIdIfNewer(userId, endHistoryId);
    }
    return fallback;
  }

  const result = await processGmailMessageIds({
    userId,
    telegramChatId,
    accessToken,
    messageIds: changes.messageIds,
    suppressTelegramItemNotifications: options?.suppressTelegramItemNotifications ?? false,
    enableAutoBoardWrite: options?.enableAutoBoardWrite ?? true,
    enableAutoWorkflow: options?.enableAutoWorkflow ?? true,
  });

  if (changes.latestHistoryId) {
    await updateGoogleLastHistoryIdIfNewer(userId, changes.latestHistoryId);
  } else {
    await updateGoogleLastHistoryIdIfNewer(userId, endHistoryId);
  }

  return result;
}
