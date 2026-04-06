# OpenClaw Hybrid Integration

This project now supports a hybrid mode:

- Chat entry (`/api/trpc agent.chat`, Telegram NLP path) can call OpenClaw first.
- On any OpenClaw error, backend falls back to legacy `handleAgentChat`.
- OpenClaw can call backend tool endpoints under `/api/openclaw-tools`.

## 1) Environment Variables

### A. Hybrid chat switch

```bash
OPENCLAW_HYBRID_ENABLED=true
OPENCLAW_GATEWAY_URL=http://localhost:8080
OPENCLAW_CHAT_ENDPOINT=/v1/chat/completions
OPENCLAW_AGENT_ID=careerpass
OPENCLAW_API_KEY=your_openclaw_api_key
```

Notes:

- `OPENCLAW_HYBRID_ENABLED` is off by default.
- If `OPENCLAW_GATEWAY_URL` is missing or request fails, it auto-falls back to legacy agent.

### B. Backend tool API switch

```bash
OPENCLAW_TOOLS_ENABLED=true
OPENCLAW_TOOL_SECRET=replace_with_long_random_secret
```

All `/api/openclaw-tools/*` endpoints require:

- Header: `x-openclaw-secret: $OPENCLAW_TOOL_SECRET`

## 2) Tool Endpoints for OpenClaw

Base URL: `https://<your-domain>/api/openclaw-tools`

- `GET /health`
- `GET /metrics`
  - Returns in-memory observability snapshot (hybrid route hit ratio, fallback/error count, per-tool success/failure and average latency).
- `POST /recon`
  - Body: `{ "userId": number, "companyName": string, "jobApplicationId"?: number }`
- `POST /es`
  - Body: `{ "userId": number, "companyName": string, "position"?: string, "sessionId"?: string }`
- `POST /workflow/start`
  - Body: `{ "userId": number, "companyName": string, "position"?: string, "sessionId"?: string }`
- `POST /interview/start`
  - Body: `{ "userId": number, "companyName": string, "position"?: string, "history"?: [{ "role": "user"|"assistant", "content": string }], "userAnswer"?: string }`

## 3) OpenClaw Tool Mapping (example)

In OpenClaw, map each tool to HTTP calls:

- `careerpass_recon` -> `POST /api/openclaw-tools/recon`
- `careerpass_es` -> `POST /api/openclaw-tools/es`
- `careerpass_workflow_start` -> `POST /api/openclaw-tools/workflow/start`
- `careerpass_interview_start` -> `POST /api/openclaw-tools/interview/start`

Send auth header on each request:

```text
x-openclaw-secret: <OPENCLAW_TOOL_SECRET>
```

## 4) Smoke Test

Use script:

```bash
scripts/smoke-openclaw-tools.sh
```

Required env:

```bash
export APP_BASE_URL=http://localhost:3000
export OPENCLAW_TOOL_SECRET=replace_with_long_random_secret
export TEST_USER_ID=1
export TEST_COMPANY_NAME="トヨタ"
```

## 5) Rollback

Fast rollback path:

- Set `OPENCLAW_HYBRID_ENABLED=false` (or remove it)
- Set `OPENCLAW_TOOLS_ENABLED=false` (or remove it)

Legacy behavior remains intact.
