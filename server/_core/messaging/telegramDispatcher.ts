import { sendTelegramMessage, sendTelegramBubbles } from "../../telegramMessaging";
import type { ChannelDispatcher, NotificationMessage } from "./dispatch";

export class TelegramDispatcher implements ChannelDispatcher {
  provider = "telegram" as const;

  async send(externalId: string | number, message: NotificationMessage): Promise<boolean> {
    const text = message.title ? `${message.title}\n\n${message.body}` : message.body;
    return sendTelegramMessage(externalId, text);
  }
}

export async function dispatchTelegramBubbles(
  externalId: string | number,
  text: string,
  parseMode = "Markdown"
): Promise<boolean> {
  return sendTelegramBubbles(externalId, text, parseMode);
}
