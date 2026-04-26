if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-jwt-secret";
if (!process.env.APP_DOMAIN) process.env.APP_DOMAIN = "https://app.example.com";
if (!process.env.GMAIL_PUBSUB_AUDIENCE)
  process.env.GMAIL_PUBSUB_AUDIENCE = "https://app.example.com/api/gmail/push";
if (!process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT)
  process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT =
    "pubsub@example.iam.gserviceaccount.com";
// Always override so webhook auth tests use a known value regardless of production env
process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN = "test-telegram-secret";

