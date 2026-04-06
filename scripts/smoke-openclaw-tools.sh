#!/usr/bin/env bash
set -euo pipefail

: "${APP_BASE_URL:?APP_BASE_URL is required, e.g. http://localhost:3000}"
: "${OPENCLAW_TOOL_SECRET:?OPENCLAW_TOOL_SECRET is required}"
: "${TEST_USER_ID:?TEST_USER_ID is required, e.g. 1}"
: "${TEST_COMPANY_NAME:?TEST_COMPANY_NAME is required, e.g. トヨタ}"

BASE="${APP_BASE_URL%/}/api/openclaw-tools"
HEADER_SECRET="x-openclaw-secret: ${OPENCLAW_TOOL_SECRET}"
HEADER_JSON="content-type: application/json"

echo "[1/6] health"
curl -sS -X GET "${BASE}/health" -H "${HEADER_SECRET}" | sed 's/^/  /'
echo

echo "[2/6] recon"
curl -sS -X POST "${BASE}/recon" \
  -H "${HEADER_SECRET}" \
  -H "${HEADER_JSON}" \
  -d "{\"userId\": ${TEST_USER_ID}, \"companyName\": \"${TEST_COMPANY_NAME}\"}" | sed 's/^/  /'
echo

echo "[3/6] es"
curl -sS -X POST "${BASE}/es" \
  -H "${HEADER_SECRET}" \
  -H "${HEADER_JSON}" \
  -d "{\"userId\": ${TEST_USER_ID}, \"companyName\": \"${TEST_COMPANY_NAME}\", \"position\": \"総合職\"}" | sed 's/^/  /'
echo

echo "[4/6] workflow/start"
curl -sS -X POST "${BASE}/workflow/start" \
  -H "${HEADER_SECRET}" \
  -H "${HEADER_JSON}" \
  -d "{\"userId\": ${TEST_USER_ID}, \"companyName\": \"${TEST_COMPANY_NAME}\", \"position\": \"総合職\"}" | sed 's/^/  /'
echo

echo "[5/6] interview/start"
curl -sS -X POST "${BASE}/interview/start" \
  -H "${HEADER_SECRET}" \
  -H "${HEADER_JSON}" \
  -d "{\"userId\": ${TEST_USER_ID}, \"companyName\": \"${TEST_COMPANY_NAME}\", \"position\": \"総合職\"}" | sed 's/^/  /'
echo

echo "[6/6] metrics"
curl -sS -X GET "${BASE}/metrics" -H "${HEADER_SECRET}" | sed 's/^/  /'
echo

echo "Smoke test finished."
