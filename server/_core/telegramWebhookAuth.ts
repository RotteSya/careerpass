export function assertTelegramWebhookSecret(
  headers: Record<string, string | undefined>,
  params: { requiredSecret: string }
) {
  const value =
    headers["x-telegram-bot-api-secret-token"] ??
    headers["X-Telegram-Bot-Api-Secret-Token"];

  if (!value || value !== params.requiredSecret) {
    throw new Error("Telegram webhook unauthorized");
  }
}

