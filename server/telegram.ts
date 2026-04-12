import express from "express";
import {
  createTelegramBinding,
  getUserById,
  getOrCreateAgentSession,
  saveAgentMemory,
  getAgentMemory,
  updateAgentSession,
  getTelegramBindingByTelegramId,
  getJobApplications,
  listJobStatusEvents,
  getBillingFeatureAccess,
} from "./db";
import {
  handleAgentChat,
  buildFixedOpening,
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
  startCompanyWorkflow,
} from "./agents";
import { invokeLLM } from "./_core/llm";
import { startMailMonitoringAndCheckmail } from "./mailMonitoring";
import { sendTelegramMessage, sendTelegramBubbles } from "./telegramMessaging";
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
  console.warn("[Telegram] TELEGRAM_BOT_TOKEN is not set. Telegram features are disabled.");
}

const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";

export const telegramRouter = express.Router();
const processedUpdateIds = new Map<number, number>();
const TELEGRAM_UPDATE_TTL_MS = 10 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a basic USER.md from the user's registration profile.
 * This is the "seed" resume created automatically on Telegram binding.
 */
function generateProfileResume(user: User, sessionId: string): string {
  const educationMap: Record<string, string> = {
    high_school: "高校卒",
    associate: "短大・専門卒",
    bachelor: "大学卒（学士）",
    master: "大学院修士課程",
    doctor: "大学院博士課程",
    other: "その他",
  };
  const langMap: Record<string, string> = {
    ja: "日本語",
    zh: "中国語（普通話）",
    en: "英語",
  };
  const edu = user.education ? (educationMap[user.education] ?? user.education) : "未記入";
  const lang = user.preferredLanguage ? (langMap[user.preferredLanguage] ?? user.preferredLanguage) : "日本語";
  const birthYear = user.birthDate ? user.birthDate.split("-")[0] : null;
  const age = birthYear ? `${new Date().getFullYear() - parseInt(birthYear)}歳` : "未記入";

  return `# USER_${sessionId} - 個人プロフィール（自動生成）

## 基本情報
- 氏名: ${user.name ?? "未記入"}
- 年齢: ${age}
- 生年月日: ${user.birthDate ?? "未記入"}
- 希望コミュニケーション言語: ${lang}

## 学歴
- 最終学歴: ${edu}
- 大学・学校名: ${user.universityName ?? "未記入"}

## 職務・インターン経験（STAR形式）
※ AIチャットで経験を詳しく話すと、ここが自動的に更新されます。

## スキル・強み
※ AIチャットで詳しく教えてください。

## 自己分析
※ AIチャットで深掘りします。

---
*このファイルはCareerPassへの登録情報から自動生成されました。*
*AIチャット機能でさらに詳しい情報を入力すると、ES生成・面接対策の精度が向上します。*
`;
}

function languageOrDefault(user?: User | null): "ja" | "zh" | "en" {
  return (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
}

/**
 * Fixed kickoff line sent right after the user replies with what they want to
 * be called. Uses the nickname they just gave us.
 */
function buildMailMonitoringKickoffText(nickname: string, lang: "ja" | "zh" | "en"): string {
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

const NICKNAME_PROMPT_ZH = "对了——为了让我能下班，先问一句：我应该怎么称呼你比较顺口？";

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
      .filter((line) => !/怎么称呼你|称呼你比较顺口/.test(line))
      .join("\n")
      .trim();
  }
  if (!intro) intro = opening.trim();
  return { intro, nicknamePrompt: NICKNAME_PROMPT_ZH };
}

function formatEventTypeLabel(lang: "ja" | "zh" | "en", eventType: string): string {
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
  const toJstMs = (dateText: string | null, timeText: string | null): number => {
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
    .filter((e) => {
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
      const link = e.mailLink ? ` [原邮件链接](${e.mailLink})` : "";
      return `${idx + 1}. ${dt}｜${company}｜${action}${link}`;
    });
    return `我把你接下来 14 天要做的事按顺序列好了（JST）：\n${lines.join("\n")}`;
  }

  const header =
    lang === "en"
      ? "Here are your upcoming action items (JST):"
      : "直近の対応事項を整理しました（JST）：";
  const lines = schedulable.map((e, idx) => {
    const dt = `${e.eventDate}${e.eventTime ? ` ${e.eventTime}` : ""} JST`;
    const company = e.companyName ?? (lang === "en" ? "Unknown company" : "企業不明");
    const type = formatEventTypeLabel(lang, e.eventType);
    const action =
      e.todoItems?.[0] ??
      (lang === "en"
        ? `Confirm and prepare for this ${type.toLowerCase()} step`
        : `この${type}対応を確認して準備`);
    const linkLabel = lang === "en" ? "Open mail" : "原メール";
    const link = e.mailLink ? ` [${linkLabel}](${e.mailLink})` : "";
    return `${idx + 1}. ${dt} | ${company} | ${action}${link}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function buildDeepDiveOfferText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "从今天开始邮件和日程我帮你看，既然开启了我们的合作，让我先了解一下你的基础情况：\n\n1. 你的目标方向是什么？\n\n• 哪个业界？什么岗位？\n• 也不确定，想先聊聊\n\n2. 你有过什么经历？\n\n• 简单提提就可以\n• 我会看到你的闪光点\n\n简单回复即可，我会根据你的情况调整策略。";
  }
  if (lang === "en") {
    return "From today on, I’ll watch your inbox and schedule for you. Now that we’ve started working together, let me quickly understand your basics:\n\n1. What direction are you aiming for?\n\n• Which industry? What role?\n• Not sure yet, want to talk first\n\n2. What experience do you have?\n\n• A simple overview is enough\n• I’ll find your strengths\n\nA short reply is enough. I’ll adjust the strategy based on your situation.";
  }
  return "今日からメールと日程は私が見ます。せっかく一緒に進めるので、まずはあなたの基本情報を軽く教えてください。\n\n1. 志望の方向性は？\n\n• どの業界？どの職種？\n• まだ決まっていないので、まず相談したい\n\n2. これまでの経験は？\n\n• ざっくりで大丈夫\n• あなたの強みは私が見つけます\n\n短く返信してくれればOKです。内容に合わせて戦略を調整します。";
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

function buildInterviewDisabledText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "模拟面试功能暂时停用中，过段时间再开放。\n\n这段时间我可以帮你做企业调研、ES、看板更新或者整理面试要点。";
  }
  if (lang === "en") {
    return "Mock interview is temporarily unavailable.\n\nFor now, I can help with company recon, ES drafting, board updates, or interview talking-point prep.";
  }
  return "模擬面接機能は一時停止中です。\n\nその間は、企業調査・ES作成・ボード更新・面接論点整理を手伝えます。";
}

function buildCheckmailStartedText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") return "正在检查您的邮箱并同步关键事件，请稍候...";
  if (lang === "en") return "Checking your inbox and syncing key events now. Please wait a moment...";
  return "メールを確認し、重要イベントを同期しています。少々お待ちください。";
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

function buildOAuthWarningText(lang: "ja" | "zh" | "en", isManual: boolean): string {
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
  if (lang === "zh") return "⚠️ 邮箱检查失败，请稍后重试。";
  if (lang === "en") return "⚠️ Inbox check failed. Please try again shortly.";
  return "⚠️ メール確認に失敗しました。しばらくしてから再試行してください。";
}

function parseConversationMemoryTurns(rawContent: string, metadata: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  let fromMetadata: unknown[] | null = null;
  if (metadata && typeof metadata === "object") {
    const dialogue = (metadata as Record<string, unknown>).dialogue;
    if (Array.isArray(dialogue)) {
      fromMetadata = dialogue as unknown[];
    }
  }
  if (fromMetadata) {
    const turns = (fromMetadata as unknown[])
      .filter((t): t is { role: "user" | "assistant"; content: string } => {
        return (
          !!t &&
          typeof t === "object" &&
          ((t as any).role === "user" || (t as any).role === "assistant") &&
          typeof (t as any).content === "string"
        );
      });
    if (turns.length > 0) return turns;
  }

  const trimmed = (rawContent ?? "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { dialogue?: Array<{ role: "user" | "assistant"; content: string }> };
      if (Array.isArray(parsed.dialogue)) {
        return parsed.dialogue.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string");
      }
    } catch {
      // ignore JSON parsing errors and fallback to legacy parser
    }
  }

  const match = trimmed.match(/^User:\s*([\s\S]*?)\nAssistant:\s*([\s\S]*)$/);
  if (!match) return [];
  return [
    { role: "user", content: match[1] ?? "" },
    { role: "assistant", content: match[2] ?? "" },
  ];
}

function isDeepDiveOptIn(text: string): boolean {
  const t = text.trim();
  return /^(开始|開始|好|可以|行|要|来|やる|お願いします|はい|ok|okay|yes|yep|sure)\b/i.test(t);
}

function looksLikeExperienceNarrative(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Heuristic 1: long, content-rich message (common when users dump experience details).
  const longEnough = t.length >= 80;
  const multiline = t.split(/\n+/).filter(Boolean).length >= 2;

  // Heuristic 2: experience-related vocabulary in zh/ja/en.
  const expKeywords =
    /(实习|项目|经历|负责|成果|结果|参加|组织|志愿|兼职|社团|比赛|开发|intern|internship|project|experience|led|built|implemented|impact|成果|経験|プロジェクト|インターン|担当|実績|開発)/i;

  // Heuristic 3: action/result pattern-like clues.
  const actionHint =
    /(我负责|我做了|我参与了|最后|结果是|学到了|担当しました|取り組みました|結果|I was responsible|I led|I built|as a result)/i;

  return (longEnough || multiline) && (expKeywords.test(t) || actionHint.test(t));
}

async function shouldEnterDeepDiveByLLM(params: {
  text: string;
  lang: "ja" | "zh" | "en";
}): Promise<boolean | null> {
  const content = params.text.trim();
  if (!content) return null;
  try {
    const systemPrompt =
      "你是对话状态分类器。任务：判断用户这条消息是否表达了“愿意/正在提供经历内容，应该切到经历深挖模式（STAR）”。" +
      "只输出JSON，不要输出其他内容：{\"enterDeepDive\": boolean, \"confidence\": number, \"reason\": string}";
    const userPrompt =
      `语言偏好: ${params.lang}\n` +
      `用户消息:\n${content}\n\n` +
      "判定标准：\n" +
      "- 若用户明确说开始，或已经在描述实习/项目/志愿/工作经历细节，enterDeepDive=true\n" +
      "- 若用户主要在问日程、提醒、看板、公司进度，enterDeepDive=false";

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    const raw = response.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as { enterDeepDive?: unknown; confidence?: unknown };
    if (typeof parsed.enterDeepDive !== "boolean") return null;
    if (typeof parsed.confidence === "number" && parsed.confidence < 0.45) return null;
    return parsed.enterDeepDive;
  } catch {
    return null;
  }
}

function formatJobStatusLabel(lang: "ja" | "zh" | "en", status: string): string {
  const zh: Record<string, string> = {
    researching: "调研中",
    applied: "エントリー済み",
    briefing: "说明会",
    es_preparing: "ES准备中",
    es_submitted: "ES已投递",
    document_screening: "書類選考中",
    written_test: "筆記試験",
    interview_1: "一面",
    interview_2: "二面",
    interview_3: "三次面接",
    interview_4: "四次面接",
    interview_final: "终面",
    offer: "Offer",
    rejected: "拒信",
    withdrawn: "已撤回",
  };
  const ja: Record<string, string> = {
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
  const en: Record<string, string> = {
    researching: "Researching",
    applied: "Entry Submitted",
    briefing: "Briefing",
    es_preparing: "ES Preparing",
    es_submitted: "ES Submitted",
    document_screening: "Document Screening",
    written_test: "Written Test",
    interview_1: "Interview 1",
    interview_2: "Interview 2",
    interview_3: "Interview 3",
    interview_4: "Interview 4",
    interview_final: "Final Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  };
  const map = lang === "zh" ? zh : lang === "en" ? en : ja;
  return map[status] ?? status;
}

function formatDateYmd(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function truncateForBoard(input: string, maxLen: number): string {
  const s = input.replace(/[\r\n]+/g, " ").trim();
  const chars = Array.from(s);
  if (chars.length <= maxLen) return s;
  return `${chars.slice(0, Math.max(0, maxLen - 1)).join("")}…`;
}

function padForBoard(input: string, width: number): string {
  const s = truncateForBoard(input, width);
  return s.length >= width ? s : s.padEnd(width, " ");
}

function computePriorityLabel(params: {
  lang: "ja" | "zh" | "en";
  status: string;
  nextActionAt?: Date | null;
}): string {
  const now = Date.now();
  const nextAt = params.nextActionAt ? new Date(params.nextActionAt).getTime() : null;
  const daysToNext = nextAt ? Math.floor((nextAt - now) / (24 * 3600 * 1000)) : null;

  const terminal = ["offer", "rejected", "withdrawn"].includes(params.status);
  if (terminal) return params.lang === "en" ? "-" : "—";

  const high =
    ["written_test", "interview_1", "interview_2", "interview_3", "interview_4", "interview_final"].includes(params.status) ||
    (daysToNext !== null && daysToNext <= 3);
  const mid =
    ["applied", "briefing", "es_preparing", "es_submitted", "document_screening"].includes(params.status) ||
    (daysToNext !== null && daysToNext <= 7);

  if (params.lang === "en") return high ? "High" : mid ? "Med" : "Low";
  if (params.lang === "ja") return high ? "高" : mid ? "中" : "低";
  return high ? "高" : mid ? "中" : "低";
}

function buildBoardText(params: {
  lang: "ja" | "zh" | "en";
  apps: Array<{ id: number; companyNameJa: string; companyNameEn: string | null; status: string; updatedAt: Date; nextActionAt?: Date | null }>;
  lastEvents: Array<{ reason?: string | null; createdAt: Date } | null>;
}): string {
  const header =
    params.lang === "zh"
      ? "📌 求职动态看板（最近更新在前）"
      : params.lang === "en"
      ? "📌 Job Board (most recently updated first)"
      : "📌 就活ボード（更新順）";

  const dashboardUrl = `${APP_DOMAIN.replace(/\/+$/, "")}/dashboard`;
  const dashboardLink =
    params.lang === "zh"
      ? `🔗 [打开网页看板](${dashboardUrl})`
      : params.lang === "en"
      ? `🔗 [Open Web Board](${dashboardUrl})`
      : `🔗 [Webボードを開く](${dashboardUrl})`;

  const colCompany = params.lang === "en" ? "Company" : params.lang === "ja" ? "会社名" : "公司名";
  const colStatus = params.lang === "en" ? "Status" : params.lang === "ja" ? "状態" : "状态";
  const colType = params.lang === "en" ? "Type" : params.lang === "ja" ? "種類" : "类型";
  const colPri = params.lang === "en" ? "Pri" : params.lang === "ja" ? "優先" : "优先";
  const colUpdated = params.lang === "en" ? "Updated" : params.lang === "ja" ? "更新" : "更新";

  const typeLabel = params.lang === "en" ? "Job" : params.lang === "ja" ? "就活" : "求职";

  const wCompany = 18;
  const wStatus = 10;
  const wType = 6;
  const wPri = 4;
  const wUpdated = 10;

  const tableHeader =
    `${padForBoard(colCompany, wCompany)}  ` +
    `${padForBoard(colStatus, wStatus)}  ` +
    `${padForBoard(colType, wType)}  ` +
    `${padForBoard(colPri, wPri)}  ` +
    `${padForBoard(colUpdated, wUpdated)}`;
  const tableSep =
    `${"-".repeat(wCompany)}  ${"-".repeat(wStatus)}  ${"-".repeat(wType)}  ${"-".repeat(wPri)}  ${"-".repeat(wUpdated)}`;

  const rows = params.apps.map((a) => {
    const company = a.companyNameJa || a.companyNameEn || "—";
    const status = formatJobStatusLabel(params.lang, a.status);
    const pri = computePriorityLabel({ lang: params.lang, status: a.status, nextActionAt: a.nextActionAt ?? null });
    const updated = formatDateYmd(a.updatedAt);
    return (
      `${padForBoard(company, wCompany)}  ` +
      `${padForBoard(status, wStatus)}  ` +
      `${padForBoard(typeLabel, wType)}  ` +
      `${padForBoard(pri, wPri)}  ` +
      `${padForBoard(updated, wUpdated)}`
    );
  });

  const footer =
    params.lang === "zh"
      ? "\n查看单家公司：/recon 公司名 或 /es 公司名\n开始面试：/interview 公司名（需要你主动）"
      : params.lang === "en"
      ? "\nCompany detail: /recon <company> or /es <company>\nStart interview: /interview <company> (explicit opt-in)"
      : "\n企業別：/recon 企業名 または /es 企業名\n面接開始：/interview 企業名（明示同意）";

  const table = `\`\`\`\n${tableHeader}\n${tableSep}\n${rows.join("\n")}\n\`\`\``;
  return `${header}\n${dashboardLink}\n${table}${footer}`;
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase();
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

function buildAutoWorkflowKickoffText(lang: "ja" | "zh" | "en", companies: string[]): string {
  const list = companies.slice(0, 6).join(lang === "zh" ? "、" : ", ");
  if (lang === "zh") {
    return `我已经识别到你正在推进这些公司：${list}。\n\n我现在先自动帮你跑「企业调研 + ES 初稿」。模拟面试不会自动开始，需要你确认后才进入。`;
  }
  if (lang === "en") {
    return `I found you’re active with: ${list}.\n\nI’ll automatically run company recon + an ES draft next. Mock interview will NOT start automatically; it will require your consent.`;
  }
  return `進行中の企業：${list}\n\nこれから自動で「企業調査 + ES初稿」を作成します。模擬面接は自動開始しません（同意が必要です）。`;
}

async function autoStartWorkflowsIfNeeded(params: {
  userId: number;
  sessionId: string;
  chatId: string | number;
  lang: "ja" | "zh" | "en";
  events: Array<{ companyName: string | null; eventType?: string | null }>;
}) {
  const companyNames = uniqueCompanyNamesFromEvents(params.events).slice(0, 3);
  if (companyNames.length === 0) return;

  const memories = await getAgentMemory(params.userId);
  const hasReport = (company: string) =>
    memories.some((m) => m.memoryType === "company_report" && m.title.includes(company));
  const hasEs = (company: string) =>
    memories.some((m) => m.memoryType === "es_draft" && m.title.includes(company));

  const toRun = companyNames.filter((c) => !(hasReport(c) && hasEs(c)));
  if (toRun.length === 0) return;

  await sendTelegramMessage(params.chatId, buildAutoWorkflowKickoffText(params.lang, toRun));
  for (const company of toRun) {
    await sendTelegramMessage(
      params.chatId,
      params.lang === "zh"
        ? `🔍 正在生成 ${company} 的调研与 ES 初稿...`
        : params.lang === "en"
        ? `🔍 Generating recon + ES draft for ${company}...`
        : `🔍 ${company} の調査とES初稿を作成中です...`
    );
    try {
      await startCompanyWorkflow(params.userId, company, "総合職", params.sessionId);
      await sendTelegramMessage(
        params.chatId,
        params.lang === "zh"
          ? `✅ ${company}：调研与 ES 初稿已生成。`
          : params.lang === "en"
          ? `✅ ${company}: recon + ES draft generated.`
          : `✅ ${company}：調査とES初稿が完成しました。`
      );
    } catch (err) {
      console.error("[Telegram] autoStartWorkflows failed:", err);
      await sendTelegramMessage(
        params.chatId,
        params.lang === "zh"
          ? `⚠️ ${company}：自动生成调研/ES 失败了，你可以稍后用 /recon 或 /es 手动触发。`
          : params.lang === "en"
          ? `⚠️ ${company}: auto recon/ES failed. You can trigger it later via /recon or /es.`
          : `⚠️ ${company}：自動生成に失敗しました。後で /recon または /es で手動実行できます。`
      );
    }
  }
}

async function maybeSendTrialLifecycleNudges(userId: number, chatId: string | number) {
  const nudges = await collectTrialNudges(userId);
  for (const n of nudges) {
    const ok = await sendTelegramMessage(chatId, n.text);
    if (ok) {
      await markTrialNudgeDelivered(userId, n.kind);
    }
  }
}

// Webhook endpoint: POST /api/telegram/webhook
telegramRouter.post("/webhook", async (req, res) => {
  try {
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
    }
    console.log("[Telegram] Received update:", JSON.stringify(update).slice(0, 200));

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
    if (text.startsWith("/start")) {
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
            const session = await getOrCreateAgentSession(userId, String(chatId));
            const sessionId = String(session?.id ?? userId);

            // Auto-generate USER.md from registration profile if not already exists
            const existingResumes = await getAgentMemory(userId, "resume");
            if (existingResumes.length === 0) {
              const resumeContent = generateProfileResume(user, sessionId);
              await saveAgentMemory({
                userId,
                memoryType: "resume",
                title: `USER_${sessionId}.md`,
                content: resumeContent,
                metadata: { sessionId, source: "auto_from_profile" },
              });
              console.log(`[Telegram] Auto-generated USER.md for user ${userId}`);
            }

            const greeting = buildFixedOpening(user, sessionId);
            const lang = languageOrDefault(user);
            const initialSessionState = (session?.sessionState as Record<string, unknown> | null) ?? {};
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
          await sendTelegramMessage(chatId, "無効なリンクです。就活パスのウェブサイトからQRコードを再生成してください。");
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
        const lang = ((user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en");
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
        await sendTelegramBubbles(chatId, buildMailMonitoringKickoffText(nickname, lang));

        // Start the first mailbox scan only after nickname is confirmed.
        // Suppress per-mail pushes here and send one 14-day action digest instead.
        void (async () => {
          try {
            const { needsOAuth, watchOk, result, blockedByBilling } = await startMailMonitoringAndCheckmail({
              userId: uid,
              mode: "auto",
            });

            const freshSession = await getOrCreateAgentSession(uid, String(chatId));
            const freshState = (freshSession?.sessionState as Record<string, unknown> | null) ?? {};
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
              await sendTelegramMessage(chatId, buildOAuthWarningText(lang, false));
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
            await sendTelegramMessage(chatId, digest ?? buildNoUpcomingScheduleText(lang));
            await sendTelegramMessage(chatId, buildDeepDiveOfferText(lang));
          } catch (err) {
            console.error("[Telegram] nickname-confirmed initial mail scan failed:", err);
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
              { role: "assistant", content: buildMailMonitoringKickoffText(nickname, lang) },
            ],
          },
        });
        return res.json({ ok: true });
      }

      await maybeSendTrialLifecycleNudges(uid, chatId);

      // Simple routing based on session state or commands
      if (text.startsWith("/board") || text.startsWith("/kanban") || /看板|进度|求职.*板|board|kanban/i.test(text)) {
        const user = await getUserById(uid);
        const lang = ((user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en");
        const apps = await getJobApplications(uid);
        if (apps.length === 0) {
          await sendTelegramMessage(
            chatId,
            lang === "zh"
              ? "📌 你的看板还是空的。等我从邮件里识别到公司事件后，会自动帮你建卡并更新状态。"
              : lang === "en"
              ? "📌 Your board is empty. Once I detect company-related events from email, I’ll auto-create and update entries."
              : "📌 まだボードが空です。メールから企業イベントを検知すると自動で作成・更新します。"
          );
          return res.json({ ok: true });
        }

        const topApps = apps.slice(0, 12);
        const lastEvents = await Promise.all(
          topApps.map(async (a) => {
            const rows = await listJobStatusEvents(uid, a.id, 1);
            return rows[0] ?? null;
          })
        );
        await sendTelegramMessage(chatId, buildBoardText({ lang, apps: topApps as any, lastEvents: lastEvents as any }));
      } else if (text.startsWith("/recon")) {
        const companyName = text.replace("/recon", "").trim();
        if (!companyName) {
          await sendTelegramMessage(chatId, "企業名を入力してください。例: `/recon トヨタ`", "Markdown");
        } else {
          await sendTelegramMessage(chatId, `🔍 ${companyName} の情報を調査しています... しばらくお待ちください。`);
          const report = await runAgentRecon(uid, companyName);
          await sendTelegramMessage(chatId, `✅ ${companyName} の調査レポートが完成しました：\n\n${report.slice(0, 4000)}`);
        }
      } else if (text.startsWith("/es")) {
        const parts = text.replace("/es", "").trim().split(" ");
        const companyName = parts[0];
        const position = parts[1] ?? "総合職";
        if (!companyName) {
          await sendTelegramMessage(chatId, "企業名を入力してください。例: `/es トヨタ 営業職`", "Markdown");
        } else {
          await sendTelegramMessage(chatId, `📄 ${companyName} のESを作成しています...`);
          const es = await runAgentES(uid, companyName, position, sessionId);
          await sendTelegramMessage(chatId, `✅ ${companyName} のES案が完成しました：\n\n${es.slice(0, 4000)}`);
        }
      } else if (text.startsWith("/interview")) {
        // 模擬面接モジュールは一時的に停止中。
        const user = await getUserById(uid);
        const lang = languageOrDefault(user);
        await sendTelegramMessage(
          chatId,
          buildInterviewDisabledText(lang)
        );
      } else if (text === "/stop") {
        await updateAgentSession(uid, { interviewMode: false, currentAgent: "careerpass" });
        await sendTelegramMessage(chatId, "対話を終了し、メインメニューに戻ります。");
      } else if (
        text.startsWith("/checkmail") ||
        /检查.*邮箱|查看.*邮箱|check.*mail|check.*inbox/i.test(text)
      ) {
        const user = await getUserById(uid);
        const lang = languageOrDefault(user);
        await sendTelegramMessage(chatId, buildCheckmailStartedText(lang));
        // Run asynchronously and return webhook response quickly.
        void (async () => {
          try {
            const { needsOAuth, result, access } = await startMailMonitoringAndCheckmail({
              userId: userId!,
              mode: "manual",
            });
            const upsell = access.autoMonitoringEnabled ? "" : `\n\n${manualScanUpsellLine()}`;
            if (needsOAuth) {
              await sendTelegramMessage(
                chatId,
                `${buildOAuthWarningText(lang, true)}${upsell}`
              );
              await updateAgentSession(userId!, {
                sessionState: {
                  ...((session.sessionState as Record<string, unknown> | null) ?? {}),
                  onboarding: { stage: "needs_oauth", updatedAt: new Date().toISOString() },
                },
              });
              return;
            }
            if (!result) {
              await sendTelegramMessage(chatId, `${buildCheckmailFailedText(lang)}${upsell}`);
              return;
            }
            await updateAgentSession(userId!, {
              sessionState: {
                ...((session.sessionState as Record<string, unknown> | null) ?? {}),
                onboarding: { stage: "experience_offer", updatedAt: new Date().toISOString() },
              },
            });
            const digest = buildScheduleDigestText(lang, result.events, { onlyRecentDays: 14, maxItems: 4 });
            await sendTelegramMessage(chatId, `${digest ?? buildNoUpcomingScheduleText(lang)}${upsell}`);
            await sendTelegramMessage(chatId, buildDeepDiveOfferText(lang));
          } catch (err) {
            console.error("[Telegram] /checkmail async monitor failed:", err);
            await sendTelegramMessage(chatId, buildCheckmailFailedText(lang));
          }
        })();
      } else {
        // Natural Language Processing via Orchestrator
        const memories = await getAgentMemory(userId, "conversation");
        const history = memories
          .slice(0, 5)
          .reverse()
          .flatMap((m) => parseConversationMemoryTurns(m.content, m.metadata));

        if (session.interviewMode) {
          // Continue interview
          const sessionState = (session.sessionState as Record<string, unknown> | null) ?? {};
          const workflow = (sessionState.workflow as Record<string, unknown> | null) ?? {};
          const companyName =
            typeof workflow.companyName === "string" && workflow.companyName.trim()
              ? workflow.companyName
              : "企業名不明";
          const position =
            typeof workflow.position === "string" && workflow.position.trim()
              ? workflow.position
              : "総合職";
          const question = await runAgentInterview(userId, companyName, position, history, text);
          await sendTelegramMessage(chatId, question);
        } else {
          // Regular Chat
          const sessionState = (session.sessionState as Record<string, any> | null) ?? {};
          const onboardingStage = sessionState?.onboarding?.stage as string | undefined;
          let extraSystemInstruction: string | undefined;

          if (onboardingStage === "schedule" || onboardingStage === "experience_offer") {
            const base =
              `当前处于“日程/看板优先”阶段：不要追问用户经历，不要进入STAR深挖。` +
              `优先处理日程、截止、冲突与下一步行动。若用户无明确问题，提示可以开始STAR深挖并征求同意。`;

            extraSystemInstruction = base;

            if (onboardingStage === "experience_offer") {
              const llmDecision = await shouldEnterDeepDiveByLLM({ text, lang: languageOrDefault(await getUserById(userId)) });
              const shouldDeepDive =
                llmDecision === true ||
                isDeepDiveOptIn(text) ||
                looksLikeExperienceNarrative(text);
              if (!shouldDeepDive) {
                // keep schedule-first mode
              } else {
              await updateAgentSession(userId, {
                sessionState: {
                  ...sessionState,
                  onboarding: { stage: "deep_dive", updatedAt: new Date().toISOString() },
                },
              });
              extraSystemInstruction =
                `用户已同意开始经历深挖。请用STAR开始对其经历进行结构化追问：` +
                `一次只问一个问题，优先从最近/最强的一段经历开始，最多连续追问3轮后收束为结构化要点。`;
              }
            }
          }

          const { reply } = await handleAgentChat(userId, text, sessionId, history, extraSystemInstruction);
          await sendTelegramBubbles(chatId, reply);
        }
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
    console.error("[Telegram] setWebhook skipped: TELEGRAM_BOT_TOKEN is not configured.");
    return;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    console.log("[Telegram] Webhook registered:", data);
    return data;
  } catch (err) {
    console.error("[Telegram] Failed to register webhook:", err);
  }
}
