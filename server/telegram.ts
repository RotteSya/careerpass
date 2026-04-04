import express from "express";
import {
  createTelegramBinding,
  getUserById,
  getOrCreateAgentSession,
  saveAgentMemory,
  getAgentMemory,
  updateAgentSession,
  getTelegramBindingByTelegramId,
} from "./db";
import {
  handleAgentChat,
  reconCompany as runAgentRecon,
  generateES as runAgentES,
  startInterview as runAgentInterview,
} from "./agents";
import type { User } from "../drizzle/schema";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "8789422574:AAGg--HXTl5Gxm0EmkeDjv8XmT5YLnuIKrU";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const APP_DOMAIN = process.env.APP_DOMAIN ?? "https://careerpax.com";

export const telegramRouter = express.Router();

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
    return `您好，${name}。我是就活パス。我知道您正处于一个开始迈入社会的特殊阶段，请让我和您一起努力。\n\n您的档案ID是：*${profileId}*、您是*${birthDate}*出生的*${name}*，*${education}*，来自*${university}*，没错吧？\n\n您是新卒，还是有过工作经验呢？`;
  }

  if (lang === "en") {
    return `Hello, ${name}. I am CareerPass. I understand you are at a special stage of stepping into society, and I would like to work hard together with you.\n\nYour profile ID is: *${profileId}*. You were born on *${birthDate}*, your name is *${name}*, your education is *${education}*, and you are from *${university}*, correct?\n\nAre you a new graduate, or do you already have work experience?`;
  }

  return `こんにちは、${name}さん。私は就活パスです。社会に踏み出す大切な時期だと理解しています。ぜひ一緒に頑張りましょう。\n\nあなたのプロフィールIDは *${profileId}* です。*${birthDate}* 生まれの *${name}* さんで、*${education}*、*${university}* ご出身でお間違いないですか？\n\nあなたは新卒ですか？それとも就業経験がありますか？`;
}

// Send a message via Telegram Bot API
export async function sendTelegramMessage(chatId: string | number, text: string, parseMode = "Markdown") {
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

      // Simple routing based on session state or commands
      if (text.startsWith("/recon")) {
        const companyName = text.replace("/recon", "").trim();
        if (!companyName) {
          await sendTelegramMessage(chatId, "企業名を入力してください。例: `/recon トヨタ`", "Markdown");
        } else {
          await sendTelegramMessage(chatId, `🔍 ${companyName} の情報を調査しています... しばらくお待ちください。`);
          const report = await runAgentRecon(userId, companyName);
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
          const es = await runAgentES(userId, companyName, position, sessionId);
          await sendTelegramMessage(chatId, `✅ ${companyName} のES案が完成しました：\n\n${es.slice(0, 4000)}`);
        }
      } else if (text.startsWith("/interview")) {
        const companyName = text.replace("/interview", "").trim();
        if (!companyName) {
          await sendTelegramMessage(chatId, "企業名を入力してください。例: `/interview トヨタ`", "Markdown");
        } else {
          await updateAgentSession(userId, { interviewMode: true, currentAgent: "careerpassinterview" });
          const question = await runAgentInterview(userId, companyName, "総合職");
          await sendTelegramMessage(chatId, `🎤 ${companyName} の模擬面接を開始します。私は面接官です。失礼いたします。\n\n${question}`);
        }
      } else if (text === "/stop") {
        await updateAgentSession(userId, { interviewMode: false, currentAgent: "careerpass" });
        await sendTelegramMessage(chatId, "対話を終了し、メインメニューに戻ります。");
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
          const { reply } = await handleAgentChat(userId, text, sessionId, history);
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
