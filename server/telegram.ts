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
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
  startCompanyWorkflow,
} from "./agents";
import { startMailMonitoringAndCheckmail } from "./mailMonitoring";
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

function educationLabelJa(edu?: string | null): string {
  const map: Record<string, string> = {
    high_school: "高校卒", associate: "短大・専門卒", bachelor: "大学卒",
    master: "修士課程", doctor: "博士課程", other: "その他",
  };
  return edu ? (map[edu] ?? edu) : "学歴未記入";
}
function educationLabelZh(edu?: string | null): string {
  const map: Record<string, string> = {
    high_school: "高中毕业", associate: "专科/短大", bachelor: "本科",
    master: "硕士", doctor: "博士", other: "其他",
  };
  return edu ? (map[edu] ?? edu) : "学历未填写";
}
function educationLabelEn(edu?: string | null): string {
  const map: Record<string, string> = {
    high_school: "High School", associate: "Associate", bachelor: "Bachelor's",
    master: "Master's", doctor: "Doctorate", other: "Other",
  };
  return edu ? (map[edu] ?? edu) : "Education not specified";
}

function buildTelegramFixedOpening(user: User, sessionId: string): string {
  const lang = (user.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
  const profileId = `user_${sessionId}`;
  const name =
    user.name ?? (lang === "zh" ? "同学" : lang === "en" ? "there" : "ユーザーさん");
  const birthDate =
    user.birthDate ??
    (lang === "zh" ? "未填写" : lang === "en" ? "not provided" : "未記入");
  const education =
    lang === "zh"
      ? educationLabelZh(user.education)
      : lang === "en"
      ? educationLabelEn(user.education)
      : educationLabelJa(user.education);
  const university =
    user.universityName ??
    (lang === "zh" ? "未填写" : lang === "en" ? "not provided" : "未記入");

  // Note: opening is intentionally a single bubble — no blank lines, so the
  // bubble splitter keeps it together.
  if (lang === "zh") {
    return (
      `您好 ${name}，我是就活パス的员工。说实话，我老板放话了——不帮你找到工作，今晚就别想下班，所以接下来这段时间咱俩算是绑一起了。\n` +
      `我能帮你做这些事：\n` +
      `- 自动盯着你的邮箱，把说明会 / 笔试 / 面试 / 截止全部抓出来，第一时间提醒你\n` +
      `- 维护一份动态求职看板，每家公司走到哪一步我都帮你记着\n` +
      `- 帮你做企业调研、ES 草稿、面试要点整理\n` +
      `- 把面试 / 截止自动写进你的 Google 日历\n` +
      `等老板以后给我加工资，可能我还可以打电话帮你模拟面试，帮你投投简历什么的。\n` +
      `对了——为了让我能下班，先问一句：我应该怎么称呼你比较顺口？`
    );
  }

  if (lang === "en") {
    return (
      `Hi ${name}, I’m an employee at CareerPass. Real talk: my boss said I’m not allowed to clock out until I’ve helped you land a job, so you and I are kind of stuck together for a while.\n` +
      `Here’s what I can do for you:\n` +
      `- Watch your inbox and surface every briefing / test / interview / deadline the moment it lands\n` +
      `- Keep a live job board so we always know where each company stands\n` +
      `- Run company research, draft ES, and prep interview talking points\n` +
      `- Auto-write interviews and deadlines into your Google Calendar\n` +
      `If my boss ever gives me a raise, I might even start calling you up for mock interviews, or sending out applications on your behalf, that kind of thing.\n` +
      `Quick one so I can eventually go home — what should I call you?`
    );
  }

  return (
    `${name}さん、はじめまして。私は就活パスの社員です。正直に言うと、上司から「この子を内定までもっていくまで帰るな」と言われていまして、しばらくの間、私はあなたと運命共同体です。\n` +
    `私ができること：\n` +
    `- メールを監視して、説明会・Webテスト・面接・締切を検知したらすぐ通知\n` +
    `- 動的な就活ボードを更新し、各社の進捗を常に最新に保つ\n` +
    `- 企業調査・ES下書き・面接対策の論点整理\n` +
    `- 面接や締切を Google カレンダーへ自動登録\n` +
    `上司がいつか給料を上げてくれたら、電話で模擬面接の相手をしたり、エントリーを代わりに出したり、そんなこともできるかもしれません。\n` +
    `さて、私が帰宅できる日のために最初に一つだけ——あなたのことは何とお呼びすればよいですか？`
  );
}

/**
 * Fixed kickoff line sent right after the user replies with what they want to
 * be called. Uses the nickname they just gave us.
 */
function buildMailMonitoringKickoffText(nickname: string, lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return `好的 ${nickname}，我已经开始工作了，正在帮你检查邮箱，待会儿要是看到说明会、笔试、面试、截止之类的，会第一时间戳你。`;
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
  events: Array<{ eventType: string; companyName: string | null; eventDate: string | null; eventTime: string | null; location: string | null; todoItems: string[] }>
): string | null {
  const schedulable = events
    .filter((e) => e.eventDate && e.eventType !== "other")
    .slice()
    .sort((a, b) => `${a.eventDate ?? ""} ${a.eventTime ?? ""}`.localeCompare(`${b.eventDate ?? ""} ${b.eventTime ?? ""}`))
    .slice(0, 6);

  if (schedulable.length === 0) return null;

  const header =
    lang === "zh"
      ? "我帮你把近期关键安排整理好了（JST）："
      : lang === "en"
      ? "Here are your upcoming key items (JST):"
      : "直近の重要予定を整理しました（JST）：";

  const lines = schedulable.map((e) => {
    const dt = `${e.eventDate}${e.eventTime ? ` ${e.eventTime}` : ""} JST`;
    const company = e.companyName ?? (lang === "zh" ? "公司未知" : lang === "en" ? "Unknown company" : "企業不明");
    const type = formatEventTypeLabel(lang, e.eventType);
    const loc = e.location ? ` @ ${e.location}` : "";
    const todo = e.todoItems?.length ? `；你先做：${e.todoItems.slice(0, 2).join(" / ")}` : "";
    return `- ${dt} | ${company} | ${type}${loc}${todo}`;
  });

  return `${header}\n${lines.join("\n")}`;
}

function buildDeepDiveOfferText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "这波日程我先帮你兜住了。接下来要不要进入“经历深挖模式”？我会用 STAR 法把你的打工/实习/项目经历扒清楚，生成结构化履历（用于 ES/面试）。回复“开始”或“先不”。";
  }
  if (lang === "en") {
    return "Schedules are under control. Next, do you want to deep-dive your experiences? I’ll use STAR to structure your work/intern/project stories into a resume-ready format. Reply “start” or “not yet”.";
  }
  return "日程は一旦こちらで押さえました。次に、経験の深掘り（STAR）に進みますか？アルバイト/インターン/プロジェクト経験をSTARで整理して、ES/面接用の構造化履歴書にします。「開始」か「今はしない」で返信してください。";
}

function isDeepDiveOptIn(text: string): boolean {
  const t = text.trim();
  return /^(开始|開始|好|可以|行|要|来|やる|お願いします|はい|ok|okay|yes|yep|sure)\b/i.test(t);
}

function formatJobStatusLabel(lang: "ja" | "zh" | "en", status: string): string {
  const zh: Record<string, string> = {
    researching: "调研中",
    es_preparing: "ES准备中",
    es_submitted: "ES已投递",
    interview_1: "一面",
    interview_2: "二面",
    interview_final: "终面",
    offer: "Offer",
    rejected: "拒信",
    withdrawn: "已撤回",
  };
  const ja: Record<string, string> = {
    researching: "調査中",
    es_preparing: "ES作成中",
    es_submitted: "ES提出済み",
    interview_1: "一次面接",
    interview_2: "二次面接",
    interview_final: "最終面接",
    offer: "内定",
    rejected: "不合格",
    withdrawn: "辞退",
  };
  const en: Record<string, string> = {
    researching: "Researching",
    es_preparing: "ES Preparing",
    es_submitted: "ES Submitted",
    interview_1: "Interview 1",
    interview_2: "Interview 2",
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
    ["interview_1", "interview_2", "interview_final"].includes(params.status) ||
    (daysToNext !== null && daysToNext <= 3);
  const mid =
    ["es_preparing", "es_submitted"].includes(params.status) ||
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

// Send a message via Telegram Bot API
export async function sendTelegramMessage(chatId: string | number, text: string, parseMode = "Markdown") {
  if (!TELEGRAM_API) {
    console.error("[Telegram] sendMessage skipped: TELEGRAM_BOT_TOKEN is not configured.");
    return false;
  }

  try {
    const payload = {
      chat_id: chatId,
      text: text.length > 4096 ? text.slice(0, 4096) : text,
      parse_mode: parseMode,
    };

    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) return true;

    const errText = await res.text();
    console.error("[Telegram] sendMessage failed:", {
      status: res.status,
      body: errText,
      parseMode,
    });

    // Fallback: retry without parse_mode so markdown parse errors do not block all replies.
    if (parseMode) {
      const fallbackRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.text,
        }),
      });
      if (fallbackRes.ok) return true;
      const fallbackErrText = await fallbackRes.text();
      console.error("[Telegram] sendMessage fallback failed:", {
        status: fallbackRes.status,
        body: fallbackErrText,
      });
    }

    return false;
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
    return false;
  }
}

/**
 * Send a long reply as multiple Telegram messages ("bubbles") instead of one
 * dense block. Splits on blank lines so each paragraph becomes its own bubble.
 * Falls back to a single message if the text has no blank-line separators.
 */
export async function sendTelegramBubbles(
  chatId: string | number,
  text: string,
  parseMode = "Markdown"
): Promise<boolean> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;

  // Split on one or more blank lines.
  const rawChunks = trimmed.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);

  // If the message is short, keep it as one bubble.
  if (rawChunks.length <= 1 || trimmed.length < 140) {
    return sendTelegramMessage(chatId, trimmed, parseMode);
  }

  // Telegram has a 4096 char limit per message; further split any oversized chunk.
  const chunks: string[] = [];
  for (const chunk of rawChunks) {
    if (chunk.length <= 3500) {
      chunks.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += 3500) {
        chunks.push(chunk.slice(i, i + 3500));
      }
    }
  }

  let allOk = true;
  for (let i = 0; i < chunks.length; i++) {
    const ok = await sendTelegramMessage(chatId, chunks[i], parseMode);
    if (!ok) allOk = false;
    // Small gap so Telegram preserves order and the user perceives separate bubbles.
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 350));
  }
  return allOk;
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

            const greeting = buildTelegramFixedOpening(user, sessionId);
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

            // Fire mail monitoring in parallel with the greeting — the user sees
            // the intro and the scan starts at the same instant.
            const backgroundScan = (async () => {
              try {
                const { needsOAuth, watchOk, result, blockedByBilling } = await startMailMonitoringAndCheckmail({
                  userId: userId!,
                  telegramChatId: String(chatId),
                  mode: "auto",
                });

                // Re-read session from DB to avoid overwriting fields set while
                // the background scan was in flight (e.g. awaitingNickname,
                // preferredNickname set by the nickname-capture handler).
                const freshSession = await getOrCreateAgentSession(userId!, String(chatId));
                const freshState = (freshSession?.sessionState as Record<string, unknown> | null) ?? {};
                await updateAgentSession(userId!, {
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
                  await sendTelegramMessage(
                    chatId,
                    "免费期已结束：自动邮箱监控和自动写入看板已暂停。你仍可手动发送 /checkmail 触发一次扫描。"
                  );
                  return;
                }

                if (needsOAuth) {
                  await sendTelegramMessage(
                    chatId,
                    `⚠️ 还没连接 Google 邮箱/日历。\n请先在网页 Dashboard 完成 Google 授权后，我才能自动监控新邮件。\n\n${APP_DOMAIN}`
                  );
                  return;
                }

                if (result) {
                  if (result.detected > 0) {
                    await sendTelegramMessage(
                      chatId,
                      `我把邮箱过了一遍：看了 ${result.scanned} 封邮件，抓到 ${result.detected} 条求职相关信息，已写入 ${result.calendarEvents} 条日历。`
                    );
                  } else {
                    await sendTelegramMessage(
                      chatId,
                      `我看了 ${result.scanned} 封邮件，这一轮没有发现需要你马上处理的求职事件。`
                    );
                  }

                  const lang = (user.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
                  const digest = buildScheduleDigestText(lang, result.events);
                  if (digest) await sendTelegramMessage(chatId, digest);

                  await sendTelegramMessage(chatId, buildDeepDiveOfferText(lang));

                  await autoStartWorkflowsIfNeeded({
                    userId: userId!,
                    sessionId,
                    chatId,
                    lang,
                    events: result.events,
                  });
                }
              } catch (err) {
                console.error("[Telegram] /start background mail monitoring failed:", err);
              }
            })();
            void backgroundScan;

            // Now send only the greeting. The kickoff line will be sent after
            // the user replies with what they want to be called.
            await sendTelegramBubbles(chatId, greeting);
            await saveAgentMemory({
              userId,
              memoryType: "conversation",
              title: `Chat ${new Date().toISOString()}`,
              content: `User: /start user_${userId}\nAssistant: ${greeting}`,
              metadata: { sessionId },
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
      await maybeSendTrialLifecycleNudges(uid, chatId);

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
        await saveAgentMemory({
          userId: uid,
          memoryType: "conversation",
          title: `Chat ${new Date().toISOString()}`,
          content: `User: ${text}\nAssistant: ${buildMailMonitoringKickoffText(nickname, lang)}`,
          metadata: { sessionId, source: "nickname_capture" },
        });
        return res.json({ ok: true });
      }

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
        await sendTelegramMessage(
          chatId,
          "模拟面试功能暂时停用中，过段时间再开放。\n\n这段时间我可以帮你做企业调研、ES、看板更新或者整理面试要点。"
        );
      } else if (text === "/stop") {
        await updateAgentSession(uid, { interviewMode: false, currentAgent: "careerpass" });
        await sendTelegramMessage(chatId, "対話を終了し、メインメニューに戻ります。");
      } else if (
        text.startsWith("/checkmail") ||
        /检查.*邮箱|查看.*邮箱|check.*mail|check.*inbox/i.test(text)
      ) {
        await sendTelegramMessage(chatId, "正在检查您的邮箱并同步关键事件，请稍候...");
        // Run asynchronously and return webhook response quickly.
        void (async () => {
          try {
            const { needsOAuth, result, access } = await startMailMonitoringAndCheckmail({
              userId: userId!,
              telegramChatId: String(chatId),
              mode: "manual",
            });
            const upsell = access.autoMonitoringEnabled ? "" : `\n\n${manualScanUpsellLine()}`;
            if (needsOAuth) {
              await sendTelegramMessage(
                chatId,
                `⚠️ 还没连接 Google 邮箱/日历。\n请先在网页 Dashboard 完成 Google 授权后再试。\n\n${APP_DOMAIN}${upsell}`
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
              await sendTelegramMessage(chatId, `⚠️ 邮箱检查失败，请稍后重试。${upsell}`);
              return;
            }
            await updateAgentSession(userId!, {
              sessionState: {
                ...((session.sessionState as Record<string, unknown> | null) ?? {}),
                onboarding: { stage: "experience_offer", updatedAt: new Date().toISOString() },
              },
            });
            if (result.detected > 0) {
              await sendTelegramMessage(
                chatId,
                `我刚帮你查完邮箱：看了 ${result.scanned} 封，识别到 ${result.detected} 条有效事件，已同步 ${result.calendarEvents} 条到日历。${upsell}`
              );
            } else {
              await sendTelegramMessage(
                chatId,
                `这次我查了 ${result.scanned} 封邮件，暂时没有发现需要你立即处理的求职事件。${upsell}`
              );
            }

            const user = await getUserById(userId!);
            const lang = ((user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en");
            const digest = buildScheduleDigestText(lang, result.events);
            if (digest) await sendTelegramMessage(chatId, digest);
            await sendTelegramMessage(chatId, buildDeepDiveOfferText(lang));

            await autoStartWorkflowsIfNeeded({
              userId: userId!,
              sessionId,
              chatId,
              lang,
              events: result.events,
            });
          } catch (err) {
            console.error("[Telegram] /checkmail async monitor failed:", err);
            await sendTelegramMessage(chatId, "⚠️ 邮箱检查失败，请稍后重试。");
          }
        })();
      } else {
        // Natural Language Processing via Orchestrator
        const memories = await getAgentMemory(userId, "conversation");
        const history = memories.slice(0, 5).reverse().map(m => {
          const parts = m.content.split("\nAssistant: ");
          return [
            { role: "user", content: parts[0].replace("User: ", "") },
            { role: "assistant", content: parts[1] ?? "" }
          ];
        }).flat();

        if (session.interviewMode) {
          // Continue interview
          const question = await runAgentInterview(userId, "企業名不明", "総合職", history, text);
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

            if (onboardingStage === "experience_offer" && isDeepDiveOptIn(text)) {
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
