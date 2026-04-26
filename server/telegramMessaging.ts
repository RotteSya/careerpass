const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : "";

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  parseMode = "Markdown"
): Promise<boolean> {
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
      bodyPreview: errText.slice(0, 160),
      parseMode,
    });

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
        bodyPreview: fallbackErrText.slice(0, 160),
      });
    }

    return false;
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
    return false;
  }
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export async function sendTelegramMessageWithInlineKeyboard(
  chatId: string | number,
  text: string,
  buttons: TelegramInlineButton[][]
): Promise<boolean> {
  if (!TELEGRAM_API) {
    console.error("[Telegram] inline keyboard send skipped: TELEGRAM_BOT_TOKEN is not configured.");
    return false;
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.length > 4096 ? text.slice(0, 4096) : text,
        reply_markup: { inline_keyboard: buttons },
      }),
    });
    if (res.ok) return true;
    const errText = await res.text();
    console.error("[Telegram] inline keyboard send failed:", {
      status: res.status,
      bodyPreview: errText.slice(0, 160),
    });
    return false;
  } catch (err) {
    console.error("[Telegram] Failed to send inline-keyboard message:", err);
    return false;
  }
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  if (!TELEGRAM_API) return;
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text ?? "" }),
    });
  } catch (err) {
    console.error("[Telegram] answerCallbackQuery failed:", err);
  }
}

export async function editTelegramMessageText(
  chatId: string | number,
  messageId: number,
  text: string
): Promise<void> {
  if (!TELEGRAM_API) return;
  try {
    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text.length > 4096 ? text.slice(0, 4096) : text,
      }),
    });
  } catch (err) {
    console.error("[Telegram] editMessageText failed:", err);
  }
}

export async function sendTelegramBubbles(
  chatId: string | number,
  text: string,
  parseMode = "Markdown"
): Promise<boolean> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;

  const rawChunks = trimmed.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (rawChunks.length <= 1 || trimmed.length < 140) {
    return sendTelegramMessage(chatId, trimmed, parseMode);
  }

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
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  return allOk;
}
