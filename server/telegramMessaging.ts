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
      body: errText,
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
        body: fallbackErrText,
      });
    }

    return false;
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
    return false;
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
