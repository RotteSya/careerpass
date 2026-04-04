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

import { getOauthToken, getUserCalendarColorPrefs, saveAgentMemory, upsertOauthToken } from "./db";
import { invokeLLM } from "./_core/llm";
import {
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
} from "./agents";

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

    const data = await res.json();
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

async function fetchRecentEmails(
  accessToken: string,
  maxResults = 20
): Promise<Array<{ id: string; snippet: string }>> {
  try {
    // Broad pull (without hard keyword gate). Actual job-related decision is delegated to monitor agent.
    const query = encodeURIComponent("newer_than:30d -category:social -category:promotions");
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

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
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
    return res.ok;
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

async function orchestrateSubAgents(userId: number, event: EmailEvent): Promise<string[]> {
  const actions: string[] = [];
  const companyName = event.companyName?.trim();
  if (!companyName) return actions;

  try {
    // 1) Always keep company intelligence fresh for actionable events.
    if (["interview", "briefing", "test", "deadline", "offer", "rejection"].includes(event.eventType)) {
      await runAgentRecon(userId, companyName);
      actions.push(`recon:${companyName}`);
    }

    // 2) Interview-related mail should prepare interview mode immediately.
    if (event.eventType === "interview" || event.eventType === "test") {
      await runAgentInterview(userId, companyName, "総合職");
      actions.push(`interview:${companyName}`);
    }

    // 3) Briefing/intern related mail can prebuild ES draft for faster turnaround.
    if (event.eventType === "briefing") {
      const sid = `gmail-${Date.now()}`;
      await runAgentES(userId, companyName, "総合職", sid);
      actions.push(`es:${companyName}`);
    }
  } catch (err) {
    console.error("[Gmail] Sub-agent orchestration failed:", err);
  }

  return actions;
}

export async function monitorGmailAndSync(
  userId: number,
  telegramChatId?: string
): Promise<MonitorResult> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { scanned: 0, detected: 0, calendarEvents: 0, events: [] };
  }

  const calendarColorPrefs = await getUserCalendarColorPrefs(userId);
  const messages = await fetchRecentEmails(accessToken, 20);
  const detectedEvents: EmailEvent[] = [];
  let calendarCount = 0;

  for (const msg of messages.slice(0, 10)) {
    const detail = await fetchEmailDetail(accessToken, msg.id);
    if (!detail) continue;

    // Dedicated careerpassmail agent: semantic decision + localized time parsing + domain signal.
    const decision = await runCareerpassmailAgent({
      subject: detail.subject,
      body: detail.body,
      from: detail.from,
    });
    if (!decision.isJobRelated) continue;

    const eventType = decision.eventType ?? "other";
    const date = decision.eventDate ?? null;
    const time = decision.eventTime ?? null;
    const companyName = decision.companyName ?? extractCompanyName(detail.from, detail.subject);

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

    // Notify Telegram as soon as a valid event is detected (no longer blocked by calendar write success).
    let orchestrationActions: string[] = [];
    if (telegramChatId) {
      orchestrationActions = await orchestrateSubAgents(userId, emailEvent);
      const todoText =
        emailEvent.todoItems.length > 0
          ? `\n📝 *やるべきこと:*\n${emailEvent.todoItems.map(t => `- ${t}`).join("\n")}`
          : "";
      const scheduleText = date
        ? `📆 ${date}${time ? ` ${time}` : ""}`
        : "📆 日時抽出: 失敗（メール本文に日時が明示されていない可能性があります）";
      const actionsText =
        orchestrationActions.length > 0
          ? `\n🤖 Agent調度: ${orchestrationActions.join(", ")}`
          : "";
      const notifText =
        `📨 *就活関連メール検出*\n\n` +
        `${typeLabels[eventType]} ${companyName ?? "企業"}\n` +
        `${scheduleText}\n` +
        `📍 場所/リンク: ${emailEvent.location ?? "未記入"}\n` +
        `📧 件名: ${detail.subject.slice(0, 80)}` +
        todoText +
        actionsText;
      await sendTelegramMessage(telegramChatId, notifText);
    }

    // Write to Google Calendar only for schedulable event types.
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
    scanned: messages.length,
    detected: detectedEvents.length,
    calendarEvents: calendarCount,
    events: detectedEvents,
  };
}
