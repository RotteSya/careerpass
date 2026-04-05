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
} from "./db";
import {
  handleAgentChat,
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
  startCompanyWorkflow,
} from "./agents";
import { startMailMonitoringAndCheckmail } from "./mailMonitoring";
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

  if (lang === "zh") {
    return `您好，${name}。我是就活パス。\n\n我先帮你把“动态看板”和“日程”跑起来：我会监控你的邮箱，识别说明会/笔试/面试/截止等事件，并主动提醒你。\n\n你的档案ID：*${profileId}*（*${birthDate}*出生，*${education}*，*${university}*）`;
  }

  if (lang === "en") {
    return `Hello, ${name}. I am CareerPass.\n\nI’ll first set up your dynamic board and schedules: I will monitor your mailbox, detect briefing/tests/interviews/deadlines, and proactively notify you.\n\nYour profile ID: *${profileId}* (born on *${birthDate}*, *${education}*, from *${university}*).`;
  }

  return `こんにちは、${name}さん。私は就活パスです。\n\nまずは「動的看板」と「日程」を整えます。メールを監視して、説明会・Webテスト・面接・締切などを検知し、自動で通知します。\n\nあなたのプロフィールIDは *${profileId}* です（*${birthDate}* 生まれ、*${education}*、*${university}*）。`;
}

function buildMailMonitoringKickoffText(lang: "ja" | "zh" | "en"): string {
  if (lang === "zh") {
    return "已开始监控你的邮箱，并马上自动检查一次。之后只要有新的求职相关邮件，会主动通知你。";
  }
  if (lang === "en") {
    return "Mail monitoring is now enabled. I’ll run one check right away. After that, I’ll proactively notify you when job-related emails arrive.";
  }
  return "メール監視を開始しました。今すぐ1回チェックします。以後、就活関連メールが来たら自動で通知します。";
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
      ? "你近期的关键日程（JST）："
      : lang === "en"
      ? "Your upcoming key items (JST):"
      : "直近の重要予定（JST）：";

  const lines = schedulable.map((e) => {
    const dt = `${e.eventDate}${e.eventTime ? ` ${e.eventTime}` : ""} JST`;
    const company = e.companyName ?? (lang === "zh" ? "公司未知" : lang === "en" ? "Unknown company" : "企業不明");
    const type = formatEventTypeLabel(lang, e.eventType);
    const loc = e.location ? ` @ ${e.location}` : "";
    const todo = e.todoItems?.length ? ` | TODO: ${e.todoItems.slice(0, 2).join(" / ")}` : "";
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

  const lines = params.apps.map((a, idx) => {
    const company = a.companyNameJa || a.companyNameEn || "—";
    const status = formatJobStatusLabel(params.lang, a.status);
    const updated = formatDateYmd(a.updatedAt);
    const nextAction = a.nextActionAt ? formatDateYmd(a.nextActionAt) : "";
    const last = params.lastEvents[idx];
    const hint = last?.reason ? String(last.reason).replace(/\s+/g, " ").slice(0, 60) : "";
    const tail =
      params.lang === "zh"
        ? `${updated ? ` | 更新:${updated}` : ""}${nextAction ? ` | 下一步:${nextAction}` : ""}${hint ? ` | 线索:${hint}` : ""}`
        : params.lang === "en"
        ? `${updated ? ` | Updated:${updated}` : ""}${nextAction ? ` | Next:${nextAction}` : ""}${hint ? ` | Note:${hint}` : ""}`
        : `${updated ? ` | 更新:${updated}` : ""}${nextAction ? ` | 次:${nextAction}` : ""}${hint ? ` | 根拠:${hint}` : ""}`;
    return `- ${company} | ${status}${tail}`;
  });

  const footer =
    params.lang === "zh"
      ? "\n查看单家公司：用 /recon 公司名 或 /es 公司名\n开始面试：用 /interview 公司名（需要你主动）"
      : params.lang === "en"
      ? "\nCompany detail: /recon <company> or /es <company>\nStart interview: /interview <company> (explicit opt-in)"
      : "\n企業別：/recon 企業名 または /es 企業名\n面接開始：/interview 企業名（明示同意）";

  return `${header}\n${lines.join("\n")}${footer}`;
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueCompanyNamesFromEvents(events: Array<{ companyName: string | null }>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of events) {
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
  events: Array<{ companyName: string | null }>;
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
            await sendTelegramMessage(chatId, greeting);
            await saveAgentMemory({
              userId,
              memoryType: "conversation",
              title: `Chat ${new Date().toISOString()}`,
              content: `User: /start user_${userId}\nAssistant: ${greeting}`,
              metadata: { sessionId },
            });

            await sendTelegramMessage(chatId, buildMailMonitoringKickoffText((user.preferredLanguage ?? "ja") as "ja" | "zh" | "en"));

            const initialSessionState = (session?.sessionState as Record<string, unknown> | null) ?? {};
            await updateAgentSession(userId!, {
              sessionState: {
                ...initialSessionState,
                onboarding: {
                  stage: "schedule",
                  updatedAt: new Date().toISOString(),
                },
              },
            });

            void (async () => {
              try {
                const { needsOAuth, watchOk, result } = await startMailMonitoringAndCheckmail({
                  userId: userId!,
                  telegramChatId: String(chatId),
                });

                const sessionState = (session?.sessionState as Record<string, unknown> | null) ?? {};
                await updateAgentSession(userId!, {
                  sessionState: {
                    ...sessionState,
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
                      `✅ 邮箱检查完成：扫描 ${result.scanned} 封，识别 ${result.detected} 个事件，写入日历 ${result.calendarEvents} 个。`
                    );
                  } else {
                    await sendTelegramMessage(
                      chatId,
                      `ℹ️ 邮箱检查完成：扫描 ${result.scanned} 封，但未识别到“说明会/面试/结果通知”等有效事件。`
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
        const companyName = text.replace("/interview", "").trim();
        if (!companyName) {
          await sendTelegramMessage(chatId, "企業名を入力してください。例: `/interview トヨタ`", "Markdown");
        } else {
          await updateAgentSession(uid, { interviewMode: true, currentAgent: "careerpassinterview" });
          const question = await runAgentInterview(uid, companyName, "総合職");
          await sendTelegramMessage(chatId, `🎤 ${companyName} の模擬面接を開始します。私は面接官です。失礼いたします。\n\n${question}`);
        }
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
            const { needsOAuth, result } = await startMailMonitoringAndCheckmail({
              userId: userId!,
              telegramChatId: String(chatId),
            });
            if (needsOAuth) {
              await sendTelegramMessage(
                chatId,
                `⚠️ 还没连接 Google 邮箱/日历。\n请先在网页 Dashboard 完成 Google 授权后再试。\n\n${APP_DOMAIN}`
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
              await sendTelegramMessage(chatId, "⚠️ 邮箱检查失败，请稍后重试。");
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
                `✅ 检查完成：扫描 ${result.scanned} 封，识别 ${result.detected} 个有效事件，写入日历 ${result.calendarEvents} 个。`
              );
            } else {
              await sendTelegramMessage(
                chatId,
                `ℹ️ 检查完成：扫描 ${result.scanned} 封，但未识别到“说明会/面试/结果通知”等有效事件。`
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
          await sendTelegramMessage(chatId, reply);
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
