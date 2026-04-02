import express from "express";
import { createTelegramBinding, getUserById, getOrCreateAgentSession } from "./db";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "8789422574:AAGg--HXTl5Gxm0EmkeDjv8XmT5YLnuIKrU";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export const telegramRouter = express.Router();

// Send a message via Telegram Bot API
async function sendTelegramMessage(chatId: string | number, text: string, parseMode = "Markdown") {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
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

    // Handle /start command with deep link payload
    if (text.startsWith("/start")) {
      const parts = text.split(" ");
      const payload = parts[1]; // e.g. "user_12345"

      if (payload && payload.startsWith("user_")) {
        const userId = parseInt(payload.replace("user_", ""), 10);

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
            await getOrCreateAgentSession(userId, String(chatId));

            const lang = user.preferredLanguage ?? "ja";
            const greetings: Record<string, string> = {
              ja: `こんにちは、${user.name ?? "ユーザー"}さん！🎉\n\n就活パスへようこそ！私はあなた専属のAIキャリアアドバイザーです。\n\n*CareerPass* があなたの日本就活を全力でサポートします。\n\nまず、あなたのこれまでの経験（インターン・アルバイト・プロジェクト・研究など）を教えてください。STAR法則で一緒に整理していきましょう！`,
              zh: `你好，${user.name ?? "用户"}！🎉\n\n欢迎来到就活パス！我是你的专属AI求职顾问。\n\n*CareerPass* 将全力支持你的日本求职活动。\n\n首先，请告诉我你的经历（实习、兼职、项目、研究等）。我们一起用STAR法则来整理！`,
              en: `Hello, ${user.name ?? "User"}! 🎉\n\nWelcome to CareerPass! I'm your dedicated AI career advisor.\n\n*CareerPass* will fully support your Japanese job hunting.\n\nFirst, please tell me about your experiences (internships, part-time jobs, projects, research, etc.). Let's organize them using the STAR method!`,
            };

            await sendTelegramMessage(chatId, greetings[lang] ?? greetings.ja);
          } else {
            await sendTelegramMessage(
              chatId,
              "アカウントが見つかりませんでした。就活パスのウェブサイトで先に登録してください。\n\nhttps://careerpass.manus.space"
            );
          }
        } else {
          await sendTelegramMessage(chatId, "無効なリンクです。就活パスのウェブサイトからQRコードを再生成してください。");
        }
      } else {
        // /start without payload
        await sendTelegramMessage(
          chatId,
          "就活パスへようこそ！\n\n就活パスのウェブサイトでアカウントを作成し、QRコードをスキャンしてください。\n\nhttps://careerpass.manus.space"
        );
      }
    } else {
      // Regular message — echo back a placeholder
      await sendTelegramMessage(
        chatId,
        "メッセージを受信しました。現在、Telegram経由のAI対話機能は準備中です。\n\nウェブサイトのAIチャット機能をご利用ください。"
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
