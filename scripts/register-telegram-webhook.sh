#!/bin/bash
# ============================================================
# CareerPass — Telegram Webhook 注册脚本
# 发布后执行此脚本，将 Webhook 指向正式域名
#
# 使用方法:
#   chmod +x scripts/register-telegram-webhook.sh
#   DOMAIN=https://your-domain.manus.space ./scripts/register-telegram-webhook.sh
# ============================================================

BOT_TOKEN="${BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
DOMAIN="${DOMAIN:-https://careerpax.com}"
WEBHOOK_URL="${DOMAIN}/api/telegram/webhook"

if [ -z "$BOT_TOKEN" ]; then
  echo "ERROR: BOT_TOKEN (or TELEGRAM_BOT_TOKEN) is required."
  exit 1
fi

echo "=== CareerPass Telegram Webhook 登録 ==="
echo "Bot Token: ${BOT_TOKEN:0:20}..."
echo "Webhook URL: ${WEBHOOK_URL}"
echo ""

# 1. 先删除旧 Webhook
echo "[1/3] 旧 Webhook を削除中..."
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" \
  -H "Content-Type: application/json" \
  -d '{"drop_pending_updates": true}' | python3 -m json.tool

echo ""

# 2. 注册新 Webhook
echo "[2/3] 新 Webhook を登録中..."
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${WEBHOOK_URL}\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":true}" \
  | python3 -m json.tool

echo ""

# 3. 确认注册状态
echo "[3/3] 登録状態を確認中..."
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool

echo ""
echo "=== 完了 ==="
