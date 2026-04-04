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

import { getOauthToken, upsertOauthToken } from "./db";
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
  eventType: "interview" | "briefing" | "test" | "offer" | "rejection" | "other";
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
    const query = encodeURIComponent(
      "is:unread (面接 OR インタビュー OR 説明会 OR 選考 OR 内定 OR interview OR 採用)"
    );
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

// ─── Email Classification ─────────────────────────────────────────────────────

const EVENT_PATTERNS: Record<EmailEvent["eventType"], RegExp[]> = {
  interview: [/面接/, /インタビュー/, /interview/i, /面談/],
  briefing: [/説明会/, /セミナー/, /インターン/, /intern/i, /briefing/i],
  test: [/筆記試験/, /適性検査/, /SPI/, /webテスト/, /テスト/],
  offer: [/内定/, /採用通知/, /offer/i, /合格/],
  rejection: [/不採用/, /選考結果/, /残念/, /お見送り/],
  other: [],
};

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
  offer: "【内定】",
  rejection: "【結果通知】",
  other: "【就活】",
};

function classifyEmail(email: { subject: string; body: string; from: string }): EmailEvent["eventType"] {
  const text = `${email.subject} ${email.body}`;
  for (const [type, patterns] of Object.entries(EVENT_PATTERNS) as [EmailEvent["eventType"], RegExp[]][]) {
    if (type === "other") continue;
    if (patterns.some((p) => p.test(text))) return type;
  }
  return "other";
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

async function extractEmailInfo(subject: string, body: string): Promise<Partial<EmailEvent>> {
  const systemPrompt = `あなたは就活アシスタントです。メールの内容から、就活に関する情報を抽出してください。
出力形式（JSONのみ）:
{
  "eventType": "interview" | "briefing" | "test" | "offer" | "rejection" | "other",
  "companyName": "企業名",
  "eventDate": "YYYY-MM-DD",
  "eventTime": "HH:MM",
  "location": "場所またはリンク",
  "todoItems": ["やるべきこと1", "やるべきこと2"]
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `件名: ${subject}\n\n本文: ${body.slice(0, 2000)}` },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[Gmail] LLM extraction failed:", err);
  }
  return {};
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
    if (["interview", "briefing", "test", "offer", "rejection"].includes(event.eventType)) {
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

  const messages = await fetchRecentEmails(accessToken, 20);
  const detectedEvents: EmailEvent[] = [];
  let calendarCount = 0;

  for (const msg of messages.slice(0, 10)) {
    const detail = await fetchEmailDetail(accessToken, msg.id);
    if (!detail) continue;

    // Use LLM for extraction
    const extracted = await extractEmailInfo(detail.subject, detail.body);
    const eventType = extracted.eventType ?? "other";
    if (eventType === "other") continue;

    const date = extracted.eventDate ?? null;
    const time = extracted.eventTime ?? null;
    const companyName = extracted.companyName ?? extractCompanyName(detail.from, detail.subject);

    const emailEvent: EmailEvent = {
      subject: detail.subject,
      from: detail.from,
      date: detail.date,
      body: detail.body.slice(0, 500),
      eventType,
      companyName,
      eventDate: date,
      eventTime: time,
      location: extracted.location ?? null,
      todoItems: extracted.todoItems ?? [],
    };

    detectedEvents.push(emailEvent);

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

    // Write to Google Calendar if date is detected.
    if (date) {
      const startDateTime = time ? `${date}T${time}:00` : `${date}T09:00:00`;
      const endDateTime = time
        ? `${date}T${String(parseInt(time.split(":")[0]) + 1).padStart(2, "0")}:${time.split(":")[1]}:00`
        : `${date}T10:00:00`;

      const calEvent: CalendarEvent = {
        summary: `${typeLabels[eventType]}${companyName ?? ""} - ${detail.subject.slice(0, 40)}`,
        description: `CareerPass自動登録\n\n場所/リンク: ${emailEvent.location ?? "未記入"}\n\nやるべきこと:\n${emailEvent.todoItems.map(t => `- ${t}`).join("\n")}\n\n送信元: ${detail.from}\n\n${detail.body.slice(0, 300)}`,
        start: { dateTime: `${startDateTime}+09:00`, timeZone: "Asia/Tokyo" },
        end: { dateTime: `${endDateTime}+09:00`, timeZone: "Asia/Tokyo" },
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
