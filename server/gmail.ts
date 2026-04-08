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
} from "./db";
import { invokeLLM } from "./_core/llm";
import { loadAgentAgents, loadAgentSoul } from "./_core/soul";
import {
  reconCompany as runAgentRecon,
  startCompanyWorkflow,
} from "./agents";
import { syncJobToNotionBoard } from "./notion";

const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailEvent {
  subject: string;
  from: string;
  date: string;
  body: string;
  eventType: "interview" | "briefing" | "test" | "deadline" | "offer" | "rejection" | "other";
  companyName: string | null;
  eventDate: string | null; // ISO 8601 if detected
  eventTime: string | null;
  location: string | null;
  todoItems: string[];
}

export interface CalendarEvent {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
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

async function fetchRecentEmails(
  accessToken: string,
  maxResults = 20
): Promise<Array<{ id: string; snippet: string }>> {
  try {
    // Broad pull (without hard keyword gate). Actual job-related decision is delegated to monitor agent.
    const query = encodeURIComponent("newer_than:5d -category:social -category:promotions");
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: Array<{ id: string; snippet: string }> };
    return data.messages ?? [];
  } catch {
    return [];
  }
}

async function fetchEmailDetail(
  accessToken: string,
  messageId: string
): Promise<{ subject: string; from: string; date: string; body: string } | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      payload?: {
        headers?: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{ mimeType: string; body?: { data?: string } }>;
      };
      snippet?: string;
    };

    const headers = data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "(件名なし)";
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const date = headers.find((h) => h.name === "Date")?.value ?? "";

    // Extract body text
    let body = data.snippet ?? "";
    const parts = data.payload?.parts ?? [];
    const textPart = parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8").slice(0, 2000);
    } else if (data.payload?.body?.data) {
      body = Buffer.from(data.payload.body.data, "base64").toString("utf-8").slice(0, 2000);
    }

    return { subject, from, date, body };
  } catch {
    return null;
  }
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
  offer: "【内定】",
  rejection: "【結果通知】",
  other: "【就活】",
};

type JobStatus =
  | "researching"
  | "es_preparing"
  | "es_submitted"
  | "interview_1"
  | "interview_2"
  | "interview_final"
  | "offer"
  | "rejected"
  | "withdrawn";

function jobStatusRank(status: JobStatus): number {
  const ranks: Record<JobStatus, number> = {
    researching: 10,
    es_preparing: 20,
    es_submitted: 30,
    interview_1: 40,
    interview_2: 50,
    interview_final: 60,
    offer: 70,
    rejected: 70,
    withdrawn: 70,
  };
  return ranks[status] ?? 0;
}

function jobStatusFromEmailEventType(eventType: EmailEvent["eventType"]): JobStatus | null {
  if (eventType === "interview") return "interview_1";
  if (eventType === "test") return "interview_1";
  if (eventType === "deadline") return "es_preparing";
  if (eventType === "briefing") return "researching";
  return null;
}

function inferHardOutcomeStatusFromText(text: string): JobStatus | null {
  const t = text.toLowerCase();
  if (
    /(不採用|見送り|お見送り|選考結果.*残念|残念ながら|ご縁がなく|ご期待に添え|不合格|不通過)/.test(t) ||
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

function inferInterviewStatusFromText(text: string): JobStatus | null {
  const t = text.toLowerCase();
  if (/最終|最終面接|final\s*interview|final\b|last\s*interview/.test(t)) return "interview_final";
  if (/二次|2次|２次|second\s*interview|2nd\s*interview|second\b|2nd\b/.test(t)) return "interview_2";
  if (/三次|3次|３次|third\s*interview|3rd\s*interview|third\b|3rd\b/.test(t)) return "interview_final";
  if (/一次|1次|１次|first\s*interview|1st\s*interview|first\b|1st\b/.test(t)) return "interview_1";
  return null;
}

function jobStatusLabelZh(status: JobStatus): string {
  if (status === "researching") return "调研/准备";
  if (status === "es_preparing") return "ES 准备";
  if (status === "es_submitted") return "已提交 ES";
  if (status === "interview_1") return "一面";
  if (status === "interview_2") return "二面";
  if (status === "interview_final") return "终面";
  if (status === "offer") return "已拿到 offer";
  if (status === "rejected") return "未通过";
  if (status === "withdrawn") return "已撤回";
  return status;
}

function normalizeCompanyName(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const blocked = new Set(["info", "noreply", "no-reply", "support", "recruit", "saiyo", "hr", "jobs"]);
  if (blocked.has(lower)) return null;
  if (raw.length < 2) return null;
  return raw;
}

function nextStepsZh(status: JobStatus): string[] {
  if (status === "researching") return ["确认投递岗位与截止时间", "准备 ES 的两段核心素材（志望动机/自己PR）"];
  if (status === "es_preparing") return ["把志望动机写成 5 句（公司痛点→你的能力→为什么现在）", "整理 1 个可量化 STAR 案例用于自己PR"];
  if (status === "es_submitted") return ["准备面试用的 30 秒自我介绍", "准备 3 个高价值逆質問"];
  if (status === "interview_1") return ["整理面试题库：动机/强项/失败经历", "把 ES 的每一句都准备可追问的证据"];
  if (status === "interview_2") return ["补齐职业规划与岗位匹配的逻辑链", "准备 1 个“你如何推进项目”的深挖案例"];
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
  const jobs = await getJobApplications(userId);
  const existing = jobs.find((j) => j.companyNameJa === companyName || j.companyNameEn === companyName);
  if (!existing) {
    await createJobApplication({ userId, companyNameJa: companyName });
    const fresh = await getJobApplications(userId);
    const created = fresh.find((j) => j.companyNameJa === companyName) ?? null;
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
}): Promise<CareerpassmailDecision> {
  const domain = getSenderDomain(input.from);
  const domainSignal = senderDomainScore(input.from);
  const localized = extractJapaneseTimeRange(`${input.subject}\n${input.body}`);
  const basic = extractDate(`${input.subject}\n${input.body}`);

  const systemPrompt = `你是 CareerPass 的“邮件监控 Agent”。
任务：判断这封邮件是否与用户求职行为相关（面试邀请、说明会、测试、结果通知、offer、流程更新等），并抽取结构化字段。
判断要求：
- 以语义理解为主，不依赖固定关键词匹配。
- 结合发件人域名可信度、邮件语气、流程信息、行动要求来判断。
- 对日本求职邮件格式做本地化：例如“2026年4月10日(金) 14:00〜15:00”“【日時】”“■日時”。
输出必须是 JSON：{
  "isJobRelated": boolean,
  "confidence": number,
  "reason": string,
  "eventType": "interview" | "briefing" | "test" | "deadline" | "offer" | "rejection" | "other",
  "companyName": string | null,
  "eventDate": "YYYY-MM-DD" | null,
  "eventTime": "HH:MM" | null,
  "location": string | null,
  "todoItems": string[]
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
            `送信者ドメイン: ${domain ?? "unknown"}\n` +
            `送信者ドメイン信号: ${domainSignal}\n` +
            `本地化时间提示: ${localized.date ?? basic.date ?? "none"} ${localized.time ?? basic.time ?? "none"}\n\n` +
            `正文:\n${input.body.slice(0, 2500)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      const parsed = JSON.parse(content) as CareerpassmailDecision;
      const eventDate = parsed.eventDate ?? localized.date ?? basic.date ?? null;
      const eventTime = parsed.eventTime ?? localized.time ?? basic.time ?? null;
      return {
        isJobRelated: !!parsed.isJobRelated,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        reason: parsed.reason ?? "LLM semantic decision",
        eventType: parsed.eventType ?? "other",
        companyName: parsed.companyName ?? null,
        eventDate,
        eventTime,
        location: parsed.location ?? null,
        todoItems: Array.isArray(parsed.todoItems) ? parsed.todoItems : [],
      };
    }
  } catch (err) {
    console.error("[careerpassmail] semantic monitor failed:", err);
  }

  // Fallback: conservative domain/time heuristic.
  return {
    isJobRelated: domainSignal >= 0.8 && !!(localized.date ?? basic.date),
    confidence: domainSignal,
    reason: "fallback domain-localized-time heuristic",
    eventType: "other",
    companyName: extractCompanyName(input.from, input.subject),
    eventDate: localized.date ?? basic.date ?? null,
    eventTime: localized.time ?? basic.time ?? null,
    location: null,
    todoItems: [],
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

// ─── Telegram Notification ────────────────────────────────────────────────────

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (res.ok) return true;
    const fallbackRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return fallbackRes.ok;
  } catch {
    return false;
  }
}

// ─── Main Monitor Function ────────────────────────────────────────────────────

export interface MonitorResult {
  scanned: number;
  detected: number;
  calendarEvents: number;
  events: EmailEvent[];
}

function buildDashboardUrl(params?: { companyName?: string | null }): string {
  const base = `${APP_DOMAIN.replace(/\/+$/, "")}/dashboard`;
  const company = params?.companyName?.trim();
  if (!company) return base;
  return `${base}?company=${encodeURIComponent(company)}`;
}

async function orchestrateSubAgents(userId: number, event: EmailEvent): Promise<string[]> {
  const actions: string[] = [];
  const companyName = event.companyName?.trim();
  if (!companyName) return actions;

  try {
    // Mail-driven workflow trigger:
    // careerpassmail identifies target company -> handoff to careerpass -> auto run recon -> ES -> interview.
    if (["interview", "briefing", "test", "deadline", "offer"].includes(event.eventType)) {
      const sid = `mail-${Date.now()}`;
      await startCompanyWorkflow(userId, companyName, "総合職", sid);
      actions.push(`careerpass:workflow-started:${companyName}`);
    } else if (event.eventType === "rejection") {
      // Rejection mails still update company intelligence, but do not start interview workflow.
      await runAgentRecon(userId, companyName);
      actions.push(`recon:${companyName}`);
    }
  } catch (err) {
    console.error("[Gmail] Sub-agent orchestration failed:", err);
  }

  return actions;
}

async function processGmailMessageIds(params: {
  userId: number;
  telegramChatId?: string;
  accessToken: string;
  messageIds: string[];
}): Promise<MonitorResult> {
  const { userId, telegramChatId, accessToken, messageIds } = params;
  const calendarColorPrefs = await getUserCalendarColorPrefs(userId);
  const detectedEvents: EmailEvent[] = [];
  let calendarCount = 0;

  for (const messageId of messageIds) {
    const detail = await fetchEmailDetail(accessToken, messageId);
    if (!detail) continue;

    const decision = await runCareerpassmailAgent({
      subject: detail.subject,
      body: detail.body,
      from: detail.from,
    });
    if (!decision.isJobRelated) continue;

    const mailText = `${detail.subject}\n${detail.body}`;
    const hardOutcome = inferHardOutcomeStatusFromText(mailText);
    const rawEventType = decision.eventType ?? "other";
    const eventType =
      rawEventType === "offer"
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

    const emailEvent: EmailEvent = {
      subject: detail.subject,
      from: detail.from,
      date: detail.date,
      body: detail.body.slice(0, 500),
      eventType,
      companyName,
      eventDate: date,
      eventTime: time,
      location: decision.location ?? null,
      todoItems: decision.todoItems ?? [],
    };

    detectedEvents.push(emailEvent);
    await reportToCareerpassAgent(userId, emailEvent, decision.reason);

    const stageStatus =
      rawEventType === "interview" || rawEventType === "test" || /面接|interview/.test(mailText.toLowerCase())
        ? inferInterviewStatusFromText(mailText)
        : null;
    const desiredStatus = hardOutcome ?? stageStatus ?? jobStatusFromEmailEventType(rawEventType);
    const inferredStatus = companyName ? desiredStatus : null;
    const progressUpdate =
      inferredStatus && companyName
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
      try {
        await syncJobToNotionBoard({
          userId,
          companyName,
          status: inferredStatus ?? null,
          eventType,
          eventDate: date,
          eventTime: time,
          location: decision.location ?? null,
          mailSubject: detail.subject,
          source: "gmail",
        });
      } catch (e) {
        console.warn("[Notion] Gmail sync failed:", (e as Error).message);
      }
    }

    let orchestrationActions: string[] = [];
    if (telegramChatId) {
      orchestrationActions = await orchestrateSubAgents(userId, emailEvent);
      const workflowTriggered = orchestrationActions.length > 0;
      const todoText =
        emailEvent.todoItems.length > 0
          ? `\n我建议你先做这几件事：\n${emailEvent.todoItems.map(t => `- ${t}`).join("\n")}`
          : "";
      const scheduleText = date
        ? `时间大概是 ${date}${time ? ` ${time}` : ""} JST`
        : "这封邮件里没有明确时间，我先不强行写死日程。";
      const progressText =
        progressUpdate && progressUpdate.jobId
          ? `\n我已帮你把进度看板${progressUpdate.changed ? "更新" : "核对"}到「${jobStatusLabelZh(progressUpdate.nextStatus)}」。`
          : desiredStatus && !companyName
          ? `\n这封邮件像是「${jobStatusLabelZh(desiredStatus)}」阶段，但我没识别出公司名，所以还没自动改看板。`
          : "";
      const boardLinkText =
        progressUpdate && progressUpdate.jobId && progressUpdate.changed
          ? `\n你可以在这里看详情：[打开求职看板](${buildDashboardUrl({ companyName })})`
          : "";
      const nextStepsText =
        progressUpdate && progressUpdate.jobId
          ? `\n接下来建议：\n${nextStepsZh(progressUpdate.nextStatus).map(s => `- ${s}`).join("\n")}`
          : "";
      const outcomeWarningText =
        (rawEventType === "offer" || rawEventType === "rejection") && !hardOutcome
          ? `\n这封邮件可能和结果有关，但语义不够确定，我先没有自动标记为 offer/未通过。你方便时在 Dashboard 看一眼确认就行。`
          : "";
      const workflowText =
        workflowTriggered
          ? `\n另外我已经把这家公司的后续流程往前推进了。`
          : "";
      const notifText =
        `我刚看完一封和求职相关的邮件：\n\n` +
        `${companyName ?? "这家公司"}（${typeLabels[eventType]}）\n` +
        `${scheduleText}\n` +
        `地点/链接：${emailEvent.location ?? "邮件里没写"}\n` +
        `邮件主题：${detail.subject.slice(0, 80)}` +
        todoText +
        progressText +
        boardLinkText +
        nextStepsText +
        outcomeWarningText +
        workflowText;
      await sendTelegramMessage(telegramChatId, notifText);
    }

    if (date && CALENDAR_WRITABLE_TYPES.includes(eventType)) {
      const startDateTime = time ? `${date}T${time}:00` : `${date}T09:00:00`;
      const endDateTime = time
        ? `${date}T${String(parseInt(time.split(":")[0]) + 1).padStart(2, "0")}:${time.split(":")[1]}:00`
        : `${date}T10:00:00`;

      const colorId = calendarColorForEventType(eventType, calendarColorPrefs);
      const calEvent: CalendarEvent & { colorId?: string } = {
        summary: `${typeLabels[eventType]}${companyName ?? ""} - ${detail.subject.slice(0, 40)}`,
        description: `CareerPass自動登録\n\n場所/リンク: ${emailEvent.location ?? "未記入"}\n\nやるべきこと:\n${emailEvent.todoItems.map(t => `- ${t}`).join("\n")}\n\n送信元: ${detail.from}\n\n${detail.body.slice(0, 300)}`,
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
  telegramChatId?: string
): Promise<MonitorResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { scanned: 0, detected: 0, calendarEvents: 0, events: [] };
  }

  const messages = await fetchRecentEmails(accessToken, 20);
  const ids = messages.slice(0, 10).map((m) => m.id);
  return processGmailMessageIds({
    userId,
    telegramChatId,
    accessToken,
    messageIds: ids,
  });
}

export async function syncGmailIncremental(
  userId: number,
  telegramChatId: string | undefined,
  endHistoryId: string
): Promise<MonitorResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { scanned: 0, detected: 0, calendarEvents: 0, events: [] };
  }

  const state = await getGoogleAccountSyncState(userId);
  const startHistoryId = state?.lastHistoryId ?? null;

  if (!startHistoryId) {
    const fallback = await monitorGmailAndSync(userId, telegramChatId);
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
    const fallback = await monitorGmailAndSync(userId, telegramChatId);
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
  });

  if (changes.latestHistoryId) {
    await updateGoogleLastHistoryIdIfNewer(userId, changes.latestHistoryId);
  } else {
    await updateGoogleLastHistoryIdIfNewer(userId, endHistoryId);
  }

  return result;
}
