import express from "express";
import {
  createTelegramBinding,
  getUserById,
  getOrCreateAgentSession,
  saveAgentMemory,
  updateAgentSession,
  getTelegramBindingByTelegramId,
  getJobApplications,
  listJobStatusEvents,
  getBillingFeatureAccess,
} from "./db";
import { invokeLLM } from "./_core/llm";
import {
  startMailMonitoringAndCheckmail,
  consumeBackgroundScanResult,
} from "./mailMonitoring";
import { registerGmailPushWatch } from "./gmail";
import {
  sendTelegramMessage,
  sendTelegramBubbles,
  answerTelegramCallbackQuery,
  editTelegramMessageText,
} from "./telegramMessaging";
import { takePendingCalendarWrite } from "./calendarWriteConsent";
import { setCalendarWriteEnabled, upsertCalendarEventSync } from "./db";
import { getValidAccessToken, writeToGoogleCalendar } from "./gmail";
import { createRateLimiter } from "./_core/rateLimit";
import { createRateLimitMiddleware } from "./_core/rateLimitMiddleware";
import { assertTelegramWebhookSecret } from "./_core/telegramWebhookAuth";
import {
  collectTrialNudges,
  manualScanUpsellLine,
  markTrialNudgeDelivered,
} from "./billing";
import type { User } from "../drizzle/schema";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : "";

if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    "[Telegram] TELEGRAM_BOT_TOKEN is not set. Telegram features are disabled."
  );
}

const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";
const TELEGRAM_WEBHOOK_SECRET_TOKEN =
  process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN ?? "";

if (
  process.env.NODE_ENV === "production" &&
  TELEGRAM_BOT_TOKEN &&
  !TELEGRAM_WEBHOOK_SECRET_TOKEN
) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN is required");
}

export const telegramRouter = express.Router();
const processedUpdateIds = new Map<number, number>();
const TELEGRAM_UPDATE_TTL_MS = 10 * 60 * 1000;

const webhookLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
telegramRouter.use(
  createRateLimitMiddleware({
    limiter: webhookLimiter,
    key: req => `ip:${req.ip}`,
  })
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a basic USER.md from the user's registration profile.
 * This is the "seed" resume created automatically on Telegram binding.
 */
function languageOrDefault(user?: User | null): "ja" | "zh" | "en" {
  return (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
}

/**
 * Fixed kickoff line sent right after the user replies with what they want to
 * be called. Uses the nickname they just gave us.
 */
function buildMailMonitoringKickoffText(
  nickname: string,
  lang: "ja" | "zh" | "en"
): string {
  if (lang === "zh") {
    return `好的 ${nickname}，我开始工作了，正在帮你检查邮箱，待会儿要是看到说明会、笔试、面试、截止之类的，我会第一时间通知你。`;
  }
  if (lang === "en") {
    return `Got it, ${nickname}. I’m already on the clock — going through your inbox right now. The second I spot a briefing, test, interview, or deadline, I’ll ping you.`;
  }
  return `了解しました、${nickname}さん。もう仕事を始めていて、今あなたのメールを確認中です。説明会・Webテスト・面接・締切を見つけ次第、すぐお知らせしますね。`;
}

/**
 * Heuristic nickname extractor: users may reply with the bare name ("张三"),
 * or a sentence ("叫我小张就好"). Trim, strip common prefixes, cap length.
 */
function extractNicknameFromReply(text: string): string {
  let t = (text ?? "").trim();
  // Strip common Chinese / Japanese / English wrappers.
  t = t.replace(/^(请)?(叫我|喊我|管我叫|称呼我(?:为|叫)?|就叫我)\s*/, "");
  t = t.replace(/^(私のことは|私を)\s*/, "");
  t = t.replace(/(と呼んで(?:ください)?|でお願いします|でいい(?:です)?)$/, "");
  t = t.replace(/^(call me|i('?| a)?m|my name is|just call me)\s+/i, "");
  t = t.replace(/[。.!！?？\s]+$/, "");
  t = t.trim();
  // Final guardrails.
  if (!t) return "你";
  if (t.length > 24) t = t.slice(0, 24);
  return t;
}

const NICKNAME_PROMPT_ZH =
  "对了——为了让我能下班，先问一句：我应该怎么称呼你比较顺口？";

function buildKickoffOpening(user: User | null | undefined): string {
  const lang = languageOrDefault(user);
  const name =
    user?.name ??
    (lang === "zh" ? "同学" : lang === "en" ? "there" : "ユーザーさん");
  if (lang === "zh") {
    return (
      `${name}，我到岗了。我现在只负责两件事：\n` +
      `- 帮你盯邮箱，说明会 / 笔试 / 面试 / 截止一个不漏，第一时间通知\n` +
      `- 主动提醒你接下来的日程，比如「明天有面试」「这家公司 3 天没回复了」\n` +
      `面试和截止还会自动写进 Google 日历。\n${NICKNAME_PROMPT_ZH}`
    );
  }
  if (lang === "en") {
    return (
      `Hi ${name}, I'm on duty. I only do two things now:\n` +
      `- Watch your inbox and surface every briefing / test / interview / deadline\n` +
      `- Proactively remind you of upcoming items ("interview tomorrow", "no reply for 3 days")\n` +
      `Interviews and deadlines will also be written to your Google Calendar.\n` +
      `First — what should I call you?`
    );
  }
  return (
    `${name}さん、勤務開始です。今の私の仕事は2つだけです：\n` +
    `- メールを見守って、説明会・Webテスト・面接・締切を検知次第すぐ通知\n` +
    `- 「明日面接」「3日連絡なし」など、次の予定をこちらから先回りでお知らせ\n` +
    `面接や締切は Google カレンダーへも自動登録します。\n` +
    `まず最初に、あなたのことは何とお呼びすればよいですか？`
  );
}

async function replyScopedFreeText(
  message: string,
  lang: "ja" | "zh" | "en"
): Promise<string> {
  const fallback =
    lang === "zh"
      ? "我现在只负责帮你盯邮箱和提醒日程。需要看最近日程发 /checkmail，看求职进度发 /status。"
      : lang === "en"
        ? "I only watch your inbox and remind you about upcoming items. Send /checkmail for the latest events, /status for application progress."
        : "今の私はメール監視と予定リマインドだけを担当しています。最新の予定は /checkmail、応募状況は /status を送ってください。";

  const systemPrompt =
    lang === "zh"
      ? "你是一个 Telegram 助理，职责严格限定为两件事：(1) 回答用户关于邮箱监控和日程提醒的问题；(2) 当用户问其他话题（写 ES、模拟面试、企业调研、闲聊等）时，礼貌地告知这些功能已下线，并引导用户使用 /checkmail 或 /status。不要编造日程内容。回复 1-2 句，自然口语化中文。"
      : lang === "en"
        ? "You are a Telegram assistant strictly scoped to two duties: (1) answer questions about inbox monitoring and schedule reminders; (2) when users ask about anything else (ES writing, mock interviews, company research, small talk), politely say those features are offline and point them to /checkmail or /status. Never fabricate schedule content. Reply in 1-2 short sentences."
        : "あなたは Telegram アシスタントです。役割は厳密に2つだけ：(1) メール監視と予定リマインドに関する質問への回答、(2) それ以外（ES作成・模擬面接・企業調査・雑談など）を聞かれたら、その機能は終了したと丁寧に伝え /checkmail か /status を案内する。予定の内容を捏造しない。1〜2文の自然な日本語で返答。";

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      maxTokens: 240,
      timeoutMs: 15_000,
    });
    const choice = result.choices?.[0]?.message?.content;
    if (typeof choice === "string" && choice.trim()) return choice.trim();
    if (Array.isArray(choice)) {
      const text = choice
        .map(part =>
          part && (part as { type?: string }).type === "text"
            ? ((part as { text?: string }).text ?? "")
            : ""
        )
        .join("")
        .trim();
      if (text) return text;
    }
    return fallback;
  } catch (err) {
    console.warn("[Telegram] free-text LLM fallback failed:", err);
    return fallback;
  }
}

function splitOpeningForNicknamePrompt(
  opening: string,
  lang: "ja" | "zh" | "en"
): { intro: string; nicknamePrompt: string | null } {
  if (lang !== "zh") {
    return { intro: opening.trim(), nicknamePrompt: null };
  }

  let intro = opening.replace(NICKNAME_PROMPT_ZH, "").trim();
  if (intro === opening.trim()) {
    intro = intro
      .split("\n")
      .filter(line => !/怎么称呼你|称呼你比较顺口/.test(line))
      .join("\n")
      .trim();
  }
  if (!intro) intro = opening.trim();
  return { intro, nicknamePrompt: NICKNAME_PROMPT_ZH };
}

function formatEventTypeLabel(
  lang: "ja" | "zh" | "en",
  eventType: string
): string {
  const mapZh: Record<string, string> = {
    interview: "面试",
    briefing: "说明会",
    test: "笔试/网测",
    deadline: "截止",
    offer: "Offer",
    rejection: "拒信",
    other: "其他",
  };
  const mapJa: Record<string, string> = {
    interview: "面接",
    briefing: "説明会",
    test: "Webテスト",
    deadline: "締切",
    offer: "内定",
    rejection: "不合格",
    other: "その他",
  };
  const mapEn: Record<string, string> = {
    interview: "Interview",
    briefing: "Briefing",
    test: "Test",
    deadline: "Deadline",
    offer: "Offer",
    rejection: "Rejection",
    other: "Other",
  };
  const map = lang === "zh" ? mapZh : lang === "en" ? mapEn : mapJa;
  return map[eventType] ?? eventType;
}

function buildScheduleDigestText(
  lang: "ja" | "zh" | "en",
  events: Array<{
    eventType: string;
    companyName: string | null;
    eventDate: string | null;
    eventTime: string | null;
    location: string | null;
    todoItems: string[];
    date?: string | null;
    mailLink?: string;
  }>,
  options?: {
    onlyRecentDays?: number;
    maxItems?: number;
  }
): string | null {
  const now = Date.now();
  const upperBoundMs =
    options?.onlyRecentDays && options.onlyRecentDays > 0
      ? now + options.onlyRecentDays * 24 * 60 * 60 * 1000
      : null;
  const toJstMs = (
    dateText: string | null,
    timeText: string | null
  ): number => {
    if (!dateText) return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
    if (!m) return NaN;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const tm = /^(\d{1,2}):(\d{2})$/.exec((timeText ?? "09:00").trim());
    const hour = tm ? Number(tm[1]) : 9;
    const minute = tm ? Number(tm[2]) : 0;
    // Convert JST wall-clock to UTC timestamp.
    return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
  };
  const schedulable = events
    .filter(e => {
      if (!e.eventDate || e.eventType === "other") return false;
      const eventMs = toJstMs(e.eventDate, e.eventTime);
      if (!Number.isFinite(eventMs)) return false;
      if (eventMs < now) return false;
      if (upperBoundMs !== null && eventMs > upperBoundMs) return false;
      return true;
    })
    .slice()
    .sort(
      (a, b) =>
        toJstMs(a.eventDate, a.eventTime) - toJstMs(b.eventDate, b.eventTime)
    )
    .slice(0, options?.maxItems ?? 4);

  if (schedulable.length === 0) return null;
  if (lang === "zh") {
    const lines = schedulable.map((e, idx) => {
      const dt = `${e.eventDate}${e.eventTime ? ` ${e.eventTime}` : ""} JST`;
      const company = e.companyName ?? "公司未知";
      const type = formatEventTypeLabel(lang, e.eventType);
      const action =
        e.todoItems?.[0] ??
        `${dt} 前后把 ${company} 这条 ${type} 相关安排确认并落实`;
      return `${idx + 1}. ${dt}｜${company}｜${action}`;
    });
    return `我把你接下来 14 天要做的事按顺序列好了（JST）：\n${lines.join("\n")}`;
  }

  const header =
    lang === "en"
      ? "Here are your upcoming action items (JST):"
      : "直近の対応事項を整理しました（JST）：";
  const lines = schedulable.map((e, idx) => {
    const dt = `${e.eventDate}${e.eventTime ? ` ${e.eventTime}` : ""} JST`;
    const company =
      e.companyName ?? (lang === "en" ? "Unknown company" : "企業不明");
    const type = formatEventTypeLabel(lang, e.eventType);
    const action =
      e.todoItems?.[0] ??
      (lang === "en"
        ? `Confirm and prepare for this ${type.toLowerCase()} step`
        : `この${type}対応を確認して準備`);
    return `${idx + 1}. ${dt} | ${company} | ${action}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function buildNoUpcomingScheduleText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "我看过这一轮了，接下来 14 天暂时没有需要你立刻处理的硬日程。我继续盯着，一有新安排就马上叫你。";
  }
  if (lang === "en") {
    return "I checked this round and don’t see urgent hard deadlines in the next 14 days. I’ll keep watching and ping you right away if anything lands.";
  }
  return "このラウンドでは、直近14日で至急対応が必要な予定は見当たりませんでした。引き続き監視し、新着があればすぐ知らせます。";
}

function buildCheckmailStartedText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh")
    return "我现在过一遍邮箱，看到说明会、面试、截止这类硬信息就立刻同步。稍等我一下。";
  if (lang === "en")
    return "I’m going through your inbox now. If there’s a briefing, interview, or deadline hiding in there, I’ll pull it out.";
  return "今からメールを見ます。説明会・面接・締切があれば、見つけ次第すぐ整理します。少し待ってください。";
}

function buildBillingBlockedText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "免费期已结束：自动邮箱监控和自动写入看板已暂停。你仍可手动发送 /checkmail 触发一次扫描。";
  }
  if (lang === "en") {
    return "Your free trial has ended: auto inbox monitoring and auto board write are paused. You can still run /checkmail manually anytime.";
  }
  return "無料期間が終了したため、自動メール監視と自動ボード更新は停止中です。/checkmail で手動スキャンは引き続き実行できます。";
}

function buildOAuthWarningText(
  lang: "ja" | "zh" | "en",
  isManual: boolean
): string {
  if (lang === "zh") {
    return isManual
      ? `⚠️ 还没连接 Google 邮箱/日历。\n请先在网页 Dashboard 完成 Google 授权后再试。\n\n${APP_DOMAIN}`
      : `⚠️ 还没连接 Google 邮箱/日历。\n请先在网页 Dashboard 完成 Google 授权后，我才能自动监控新邮件。\n\n${APP_DOMAIN}`;
  }
  if (lang === "en") {
    return isManual
      ? `⚠️ Google Gmail/Calendar is not connected yet.\nPlease complete Google OAuth in the web Dashboard, then try again.\n\n${APP_DOMAIN}`
      : `⚠️ Google Gmail/Calendar is not connected yet.\nPlease complete Google OAuth in the web Dashboard so I can auto-monitor new emails.\n\n${APP_DOMAIN}`;
  }
  return isManual
    ? `⚠️ Google メール/カレンダーが未連携です。\n先に Web Dashboard で Google 認証を完了してから再実行してください。\n\n${APP_DOMAIN}`
    : `⚠️ Google メール/カレンダーが未連携です。\nWeb Dashboard で Google 認証を完了すると、新着メールの自動監視が有効になります。\n\n${APP_DOMAIN}`;
}

function buildScanSummaryText(
  lang: "ja" | "zh" | "en",
  result: { scanned: number; detected: number; calendarEvents: number }
): string {
  if (result.detected > 0) {
    if (lang === "zh") {
      return `我把邮箱过了一遍：看了 ${result.scanned} 封邮件，抓到 ${result.detected} 条求职相关信息，已写入 ${result.calendarEvents} 条日历。`;
    }
    if (lang === "en") {
      return `Inbox scan complete: checked ${result.scanned} emails, detected ${result.detected} job-related items, and wrote ${result.calendarEvents} calendar events.`;
    }
    return `メールを確認しました：${result.scanned}件を確認し、${result.detected}件の就活関連情報を検知、${result.calendarEvents}件をカレンダーへ登録しました。`;
  }

  if (lang === "zh") {
    return `我看了 ${result.scanned} 封邮件，这一轮没有发现需要你马上处理的求职事件。`;
  }
  if (lang === "en") {
    return `I checked ${result.scanned} emails and found no urgent job-related events in this pass.`;
  }
  return `${result.scanned}件のメールを確認しましたが、今回すぐ対応が必要な就活イベントは見つかりませんでした。`;
}

function buildCheckmailFailedText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh")
    return "⚠️ 这次邮箱没查成，可能是授权或网络出了问题。稍后再试一次，我继续盯着。";
  if (lang === "en")
    return "⚠️ I couldn’t finish this inbox check. It may be auth or network trouble; try again shortly and I’ll take another pass.";
  return "⚠️ 今回はメール確認が完了しませんでした。認証かネットワークの問題かもしれません。少し後でもう一度試してください。";
}

function formatDateYmd(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

import { normalizeCompanyKey as standardNormalizeCompanyKey } from "./companyName";

function normalizeCompanyKey(name: string): string {
  return standardNormalizeCompanyKey(name) ?? name.trim().toLowerCase();
}

function uniqueCompanyNamesFromEvents(
  events: Array<{ companyName: string | null; eventType?: string | null }>
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of events) {
    // Rejected/withdrawn companies should not trigger recon/ES auto workflow.
    if (e.eventType === "rejection") continue;
    const raw = e.companyName?.trim();
    if (!raw) continue;
    const key = normalizeCompanyKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(raw);
  }
  return names;
}

async function maybeSendTrialLifecycleNudges(
  userId: number,
  chatId: string | number
) {
  const nudges = await collectTrialNudges(userId);
  for (const n of nudges) {
    const ok = await sendTelegramMessage(chatId, n.text);
    if (ok) {
      await markTrialNudgeDelivered(userId, n.kind);
    }
  }
}

interface TelegramCallbackQuery {
  id: string;
  from?: { id?: number };
  data?: string;
  message?: { chat?: { id?: number | string }; message_id?: number };
}

async function handleCalendarConsentCallback(
  cb: TelegramCallbackQuery
): Promise<void> {
  const data = cb.data ?? "";
  const ackId = cb.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const telegramId = String(cb.from?.id ?? chatId ?? "");

  if (!data.startsWith("cal:")) {
    await answerTelegramCallbackQuery(ackId);
    return;
  }

  const [, action, token] = data.split(":");
  if (!token || (action !== "y" && action !== "n")) {
    await answerTelegramCallbackQuery(ackId);
    return;
  }

  const binding = telegramId
    ? await getTelegramBindingByTelegramId(telegramId)
    : null;
  const userId = binding?.userId;
  if (!userId) {
    await answerTelegramCallbackQuery(ackId, "未绑定账户");
    return;
  }

  const pending = takePendingCalendarWrite(token);
  if (!pending) {
    await answerTelegramCallbackQuery(ackId, "请求已过期");
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessageText(
        chatId,
        messageId,
        "（这条加日历的请求已过期。）"
      );
    }
    return;
  }
  if (pending.userId !== userId) {
    await answerTelegramCallbackQuery(ackId, "无效请求");
    return;
  }

  if (action === "n") {
    await answerTelegramCallbackQuery(ackId, "好的，不加");
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessageText(
        chatId,
        messageId,
        `好的，这条不加日历。\n📧 ${pending.subjectPreview}`
      );
    }
    return;
  }

  // action === "y": flip toggle on permanently and write this event.
  await setCalendarWriteEnabled(userId, true);
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    await answerTelegramCallbackQuery(ackId, "Google 未连接");
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessageText(
        chatId,
        messageId,
        "⚠️ 还没连接 Google 日历，请先在 Dashboard 完成授权。"
      );
    }
    return;
  }

  const calendarEventId = await writeToGoogleCalendar(
    accessToken,
    pending.calEvent
  );
  if (calendarEventId) {
    await upsertCalendarEventSync({
      userId,
      provider: "google",
      mailMessageId: pending.messageId,
      calendarEventId,
    });
    await answerTelegramCallbackQuery(ackId, "已加进日历");
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessageText(
        chatId,
        messageId,
        `✅ 已加进 Google 日历。「写入日历」开关已为你打开，之后类似事件不会再问你（可在 Dashboard 关闭）。\n📧 ${pending.subjectPreview}`
      );
    }
  } else {
    await answerTelegramCallbackQuery(ackId, "写入失败");
    if (chatId !== undefined && messageId !== undefined) {
      await editTelegramMessageText(
        chatId,
        messageId,
        `⚠️ 写入 Google 日历失败。可在 Dashboard 检查授权后重试。\n📧 ${pending.subjectPreview}`
      );
    }
  }
}

// Webhook endpoint: POST /api/telegram/webhook
telegramRouter.post("/webhook", async (req, res) => {
  let updateIdForDedupe: number | null = null;
  try {
    if (TELEGRAM_WEBHOOK_SECRET_TOKEN) {
      const header = req.headers["x-telegram-bot-api-secret-token"];
      const value = Array.isArray(header) ? header[0] : header;
      assertTelegramWebhookSecret(
        { "x-telegram-bot-api-secret-token": value },
        { requiredSecret: TELEGRAM_WEBHOOK_SECRET_TOKEN }
      );
    }

    const update = req.body;
    const updateId =
      typeof update?.update_id === "number" ? update.update_id : null;
    const now = Date.now();
    // Cleanup old dedupe entries
    processedUpdateIds.forEach((ts, id) => {
      if (now - ts > TELEGRAM_UPDATE_TTL_MS) processedUpdateIds.delete(id);
    });
    if (updateId !== null) {
      const existingTs = processedUpdateIds.get(updateId);
      if (existingTs) {
        // Telegram retries the same update when webhook processing is slow;
        // acknowledge duplicates immediately to prevent repeated side effects.
        res.json({ ok: true, deduped: true });
        return;
      }
      processedUpdateIds.set(updateId, now);
      updateIdForDedupe = updateId;
    }
    console.log("[Telegram] Received update:", { updateId });

    const callbackQuery = update?.callback_query;
    if (callbackQuery) {
      await handleCalendarConsentCallback(callbackQuery);
      res.json({ ok: true });
      return;
    }

    const message = update?.message;
    if (!message) {
      res.json({ ok: true });
      return;
    }

    const chatId = message.chat?.id;
    const telegramId = String(message.from?.id ?? chatId);
    const telegramUsername = message.from?.username ?? null;
    const text: string = message.text ?? "";

    // Find bound user
    const binding = await getTelegramBindingByTelegramId(telegramId);
    let userId = binding?.userId;

    // Handle /start command with deep link payload
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(text.trim())) {
      const parts = text.split(" ");
      const payload = parts[1]; // e.g. "user_12345"

      if (payload && payload.startsWith("user_")) {
        userId = parseInt(payload.replace("user_", ""), 10);

        if (!isNaN(userId)) {
          // Look up user in DB
          const user = await getUserById(userId);

          // Returning user: this telegram_id is already bound to this same userId.
          // Don't re-run the full welcome flow — just acknowledge and stop.
          if (user && binding?.userId === userId && binding?.isActive) {
            const lang = (user.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
            const access = await getBillingFeatureAccess(userId);
            const welcomeBack =
              lang === "zh"
                ? access.autoMonitoringEnabled
                  ? `欢迎回来，${user.name ?? "你"}。我还在岗，邮箱也一直帮你盯着。直接告诉我下一步要干什么就行。`
                  : `欢迎回来，${user.name ?? "你"}。历史数据都在；自动盯邮箱已暂停，你仍可随时手动发 /checkmail。`
                : lang === "en"
                  ? access.autoMonitoringEnabled
                    ? `Welcome back, ${user.name ?? "you"}. Still on the clock, still watching your inbox. Just tell me what you want to tackle next.`
                    : `Welcome back, ${user.name ?? "you"}. Your history is safe; auto inbox watch is paused, and you can still run /checkmail manually.`
                  : access.autoMonitoringEnabled
                    ? `おかえりなさい、${user.name ?? "あなた"}さん。まだ勤務中で、メールもずっと見ています。次にやりたいことを教えてください。`
                    : `おかえりなさい、${user.name ?? "あなた"}さん。履歴データはそのままです。自動メール監視は停止中ですが、/checkmail で手動確認できます。`;
            await sendTelegramBubbles(chatId, welcomeBack);
            await maybeSendTrialLifecycleNudges(userId, chatId);
            res.json({ ok: true });
            return;
          }

          if (user) {
            // Bind Telegram account
            await createTelegramBinding({
              userId,
              telegramId,
              telegramUsername,
              isActive: true,
            });

            // Create or update agent session
            const session = await getOrCreateAgentSession(
              userId,
              String(chatId)
            );
            const sessionId = String(session?.id ?? userId);

            const greeting = buildKickoffOpening(user);
            const lang = languageOrDefault(user);
            const initialSessionState =
              (session?.sessionState as Record<string, unknown> | null) ?? {};
            await updateAgentSession(userId!, {
              sessionState: {
                ...initialSessionState,
                // Wait for the user's reply so we can use whatever they ask to be
                // called as the nickname in the kickoff message. This flag is
                // independent of onboarding.stage so the background mail-scan
                // result can still advance onboarding without racing us.
                awaitingNickname: true,
                onboarding: {
                  stage: "awaiting_nickname",
                  updatedAt: new Date().toISOString(),
                },
              },
            });

            // Keep silent on scanning until user confirms how to be addressed.
            const opening = splitOpeningForNicknamePrompt(greeting, lang);
            await sendTelegramMessage(chatId, opening.intro);
            if (opening.nicknamePrompt) {
              await sendTelegramMessage(chatId, opening.nicknamePrompt);
            }
            await saveAgentMemory({
              userId,
              memoryType: "conversation",
              title: `Chat ${new Date().toISOString()}`,
              content: `User: /start user_${userId}\nAssistant: ${greeting}`,
              metadata: {
                sessionId,
                dialogue: [
                  { role: "user", content: `/start user_${userId}` },
                  { role: "assistant", content: greeting },
                ],
              },
            });
          } else {
            await sendTelegramMessage(
              chatId,
              `アカウントが見つかりませんでした。就活パスのウェブサイトで先に登録してください。\n\n${APP_DOMAIN}`
            );
          }
        } else {
          await sendTelegramMessage(
            chatId,
            "無効なリンクです。就活パスのウェブサイトからQRコードを再生成してください。"
          );
        }
      } else {
        // /start without payload
        await sendTelegramMessage(
          chatId,
          `就活パスへようこそ！\n\n就活パスのウェブサイトでアカウントを作成し、QRコードをスキャンしてください。\n\n${APP_DOMAIN}`
        );
      }
    } else if (userId) {
      // Agent Session Handling
      const session = await getOrCreateAgentSession(userId, String(chatId));
      const sessionId = String(session.id);
      const uid = userId;

      // First reply after the opening greeting: capture the nickname the user
      // wants to be called by, save it, then send the kickoff line.
      const sessionStateForNickname =
        (session.sessionState as Record<string, any> | null) ?? {};
      if (sessionStateForNickname.awaitingNickname) {
        const user = await getUserById(uid);
        const lang = (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
        const nickname = extractNicknameFromReply(text);
        await updateAgentSession(uid, {
          sessionState: {
            ...sessionStateForNickname,
            awaitingNickname: false,
            preferredNickname: nickname,
            onboarding: {
              stage: "schedule",
              updatedAt: new Date().toISOString(),
            },
          },
        });
        await sendTelegramBubbles(
          chatId,
          buildMailMonitoringKickoffText(nickname, lang)
        );

        // Try to use the background scan started at Gmail OAuth bind time.
        // If available, await it (likely already complete → near-instant).
        // Otherwise fall back to a fresh scan.
        void (async () => {
          try {
            let result = await consumeBackgroundScanResult(uid);
            let needsOAuth = false;
            let watchOk = false;
            let blockedByBilling = false;

            if (result !== null) {
              // Background scan result available — just ensure push watch is active.
              console.log(
                `[Telegram] Using background scan result for user ${uid}`
              );
              watchOk = await registerGmailPushWatch(uid);
            } else {
              // No cached result (expired / server restart / never started).
              // Fall back to a regular scan (incremental if background scan
              // already saved lastHistoryId, so still faster than before).
              console.log(
                `[Telegram] No background scan result for user ${uid}, running fresh scan`
              );
              const scanResult = await startMailMonitoringAndCheckmail({
                userId: uid,
                mode: "auto",
              });
              needsOAuth = scanResult.needsOAuth;
              watchOk = scanResult.watchOk;
              result = scanResult.result;
              blockedByBilling = scanResult.blockedByBilling;
            }

            const freshSession = await getOrCreateAgentSession(
              uid,
              String(chatId)
            );
            const freshState =
              (freshSession?.sessionState as Record<string, unknown> | null) ??
              {};
            await updateAgentSession(uid, {
              sessionState: {
                ...freshState,
                mailMonitoring: {
                  enabled: true,
                  watchOk,
                  lastCheckAt: new Date().toISOString(),
                  scanned: result?.scanned ?? 0,
                  detected: result?.detected ?? 0,
                  calendarEvents: result?.calendarEvents ?? 0,
                },
                onboarding: {
                  stage: needsOAuth ? "needs_oauth" : "experience_offer",
                  updatedAt: new Date().toISOString(),
                },
              },
            });

            if (blockedByBilling) {
              await sendTelegramMessage(chatId, buildBillingBlockedText(lang));
              return;
            }
            if (needsOAuth) {
              await sendTelegramMessage(
                chatId,
                buildOAuthWarningText(lang, false)
              );
              return;
            }
            if (!result) {
              await sendTelegramMessage(chatId, buildCheckmailFailedText(lang));
              return;
            }

            const digest = buildScheduleDigestText(lang, result.events, {
              onlyRecentDays: 14,
              maxItems: 4,
            });
            await sendTelegramMessage(
              chatId,
              digest ?? buildNoUpcomingScheduleText(lang)
            );
          } catch (err) {
            console.error(
              "[Telegram] nickname-confirmed initial mail scan failed:",
              err
            );
            await sendTelegramMessage(chatId, buildCheckmailFailedText(lang));
          }
        })();

        await saveAgentMemory({
          userId: uid,
          memoryType: "conversation",
          title: `Chat ${new Date().toISOString()}`,
          content: `User: ${text}\nAssistant: ${buildMailMonitoringKickoffText(nickname, lang)}`,
          metadata: {
            sessionId,
            source: "nickname_capture",
            dialogue: [
              { role: "user", content: text },
              {
                role: "assistant",
                content: buildMailMonitoringKickoffText(nickname, lang),
              },
            ],
          },
        });
        return res.json({ ok: true });
      }

      await maybeSendTrialLifecycleNudges(uid, chatId);

      // Simple routing based on session state or commands
      if (
        text.startsWith("/status") ||
        text.startsWith("/board") ||
        text.startsWith("/kanban") ||
        /看板|进度|求职.{0,40}板|board|kanban|status/i.test(text)
      ) {
        const user = await getUserById(uid);
        const lang = (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
        const apps = await getJobApplications(uid);
        if (apps.length === 0) {
          await sendTelegramMessage(
            chatId,
            lang === "zh"
              ? "📌 你还没有投递记录。等我从邮件里识别到公司事件后，会自动帮你建卡并更新状态。"
              : lang === "en"
                ? "📌 No applications yet. Once I spot company-related events in your email, I’ll create and update entries automatically."
                : "📌 まだ応募記録がありません。メールから企業イベントを検知すると自動で作成・更新します。"
          );
          return res.json({ ok: true });
        }

        // Simple text-based status summary
        const topApps = apps.slice(0, 15);
        const lines = topApps.map(a => {
          const statusMapZh: Record<string, string> = {
            researching: "调研中",
            applied: "已投递",
            briefing: "说明会",
            es_preparing: "ES准备中",
            es_submitted: "ES已提交",
            document_screening: "書類選考",
            written_test: "筆記試験",
            interview_1: "一面",
            interview_2: "二面",
            interview_3: "三次面接",
            interview_4: "四次面接",
            interview_final: "终面",
            offer: "内定",
            rejected: "未通过",
            withdrawn: "已辞退",
          };
          const statusMapEn: Record<string, string> = {
            researching: "Researching",
            applied: "Applied",
            briefing: "Briefing",
            es_preparing: "ES Prep",
            es_submitted: "ES Submitted",
            document_screening: "Screening",
            written_test: "Written Test",
            interview_1: "1st Interview",
            interview_2: "2nd Interview",
            interview_3: "3rd Interview",
            interview_4: "4th Interview",
            interview_final: "Final Interview",
            offer: "Offer",
            rejected: "Rejected",
            withdrawn: "Withdrawn",
          };
          const statusMapJa: Record<string, string> = {
            researching: "調査中",
            applied: "エントリー済み",
            briefing: "説明会",
            es_preparing: "ES作成中",
            es_submitted: "ES提出済み",
            document_screening: "書類選考中",
            written_test: "筆記試験",
            interview_1: "一次面接",
            interview_2: "二次面接",
            interview_3: "三次面接",
            interview_4: "四次面接",
            interview_final: "最終面接",
            offer: "内定",
            rejected: "不合格",
            withdrawn: "辞退",
          };
          const map =
            lang === "zh"
              ? statusMapZh
              : lang === "en"
                ? statusMapEn
                : statusMapJa;
          const status = map[a.status] ?? a.status;
          const company = a.companyNameJa || a.companyNameEn || "—";
          return `${company}：${status}`;
        });
        const header =
          lang === "zh"
            ? "📌 你的求职进度"
            : lang === "en"
              ? "📌 Your Job Progress"
              : "📌 就活の進捗";
        await sendTelegramMessage(chatId, `${header}\n\n${lines.join("\n")}`);
      } else if (text.startsWith("/recon")) {
        await sendTelegramMessage(
          chatId,
          "企业调研功能已下线。我现在只负责帮你盯邮箱和提醒日程。"
        );
      } else if (text.startsWith("/es")) {
        await sendTelegramMessage(
          chatId,
          "ES 自动生成功能已下线。你可以直接告诉我你想写哪家公司的志望动机，我帮你理思路。"
        );
      } else if (text.startsWith("/interview")) {
        await sendTelegramMessage(
          chatId,
          "模拟面试功能已下线。不过你可以告诉我面试的公司，我帮你整理面试要点。"
        );
      } else if (text === "/mute") {
        await updateAgentSession(uid, {
          sessionState: {
            ...((session.sessionState as Record<string, unknown> | null) ?? {}),
            nudgesMutedUntil: new Date(
              Date.now() + 24 * 60 * 60 * 1000
            ).toISOString(),
          },
        });
        await sendTelegramMessage(
          chatId,
          "🔕 主动提醒已静音 24 小时。紧急邮件事件仍会通知你。"
        );
      } else if (text === "/unmute") {
        await updateAgentSession(uid, {
          sessionState: {
            ...((session.sessionState as Record<string, unknown> | null) ?? {}),
            nudgesMutedUntil: null,
          },
        });
        await sendTelegramMessage(chatId, "🔔 主动提醒已恢复。");
      } else if (text === "/stop") {
        await updateAgentSession(uid, {
          interviewMode: false,
          currentAgent: "careerpass",
        });
        await sendTelegramMessage(
          chatId,
          "対話を終了し、メインメニューに戻ります。"
        );
      } else if (
        text.startsWith("/checkmail") ||
        /检查.{0,40}邮箱|查看.{0,40}邮箱|check.{0,40}mail|check.{0,40}inbox/i.test(
          text
        )
      ) {
        const user = await getUserById(uid);
        const lang = languageOrDefault(user);
        await sendTelegramMessage(chatId, buildCheckmailStartedText(lang));
        // Run asynchronously and return webhook response quickly.
        void (async () => {
          try {
            const { needsOAuth, result, access } =
              await startMailMonitoringAndCheckmail({
                userId: userId!,
                mode: "manual",
              });
            const upsell = access.autoMonitoringEnabled
              ? ""
              : `\n\n${manualScanUpsellLine()}`;
            if (needsOAuth) {
              await sendTelegramMessage(
                chatId,
                `${buildOAuthWarningText(lang, true)}${upsell}`
              );
              await updateAgentSession(userId!, {
                sessionState: {
                  ...((session.sessionState as Record<
                    string,
                    unknown
                  > | null) ?? {}),
                  onboarding: {
                    stage: "needs_oauth",
                    updatedAt: new Date().toISOString(),
                  },
                },
              });
              return;
            }
            if (!result) {
              await sendTelegramMessage(
                chatId,
                `${buildCheckmailFailedText(lang)}${upsell}`
              );
              return;
            }
            await updateAgentSession(userId!, {
              sessionState: {
                ...((session.sessionState as Record<string, unknown> | null) ??
                  {}),
                onboarding: {
                  stage: "active",
                  updatedAt: new Date().toISOString(),
                },
              },
            });
            const digest = buildScheduleDigestText(lang, result.events, {
              onlyRecentDays: 14,
              maxItems: 4,
            });
            await sendTelegramMessage(
              chatId,
              `${digest ?? buildNoUpcomingScheduleText(lang)}${upsell}`
            );
          } catch (err) {
            console.error("[Telegram] /checkmail async monitor failed:", err);
            await sendTelegramMessage(chatId, buildCheckmailFailedText(lang));
          }
        })();
      } else {
        const lang = languageOrDefault(await getUserById(uid));
        const reply = await replyScopedFreeText(text, lang);
        await sendTelegramBubbles(chatId, reply);
      }
    } else {
      // Not bound
      await sendTelegramMessage(
        chatId,
        `就活パスへようこそ！\n\n就活パスのウェブサイトでアカウントを作成し、QRコードをスキャンして連携してください。\n\n${APP_DOMAIN}`
      );
    }

    res.json({ ok: true });
  } catch (err) {
    if (updateIdForDedupe !== null) {
      processedUpdateIds.delete(updateIdForDedupe);
    }
    console.error("[Telegram] Webhook error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Health check
telegramRouter.get("/health", (_req, res) => {
  res.json({ ok: true, bot: "CareerpassBot" });
});

// Register webhook with Telegram (call once during setup)
export async function registerTelegramWebhook(webhookUrl: string) {
  if (!TELEGRAM_API) {
    console.error(
      "[Telegram] setWebhook skipped: TELEGRAM_BOT_TOKEN is not configured."
    );
    return;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        ...(TELEGRAM_WEBHOOK_SECRET_TOKEN
          ? { secret_token: TELEGRAM_WEBHOOK_SECRET_TOKEN }
          : {}),
      }),
    });
    const data = await res.json();
    console.log("[Telegram] Webhook registered:", data);
    return data;
  } catch (err) {
    console.error("[Telegram] Failed to register webhook:", err);
  }
}
