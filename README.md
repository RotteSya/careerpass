# CareerPass (就活パス)

AI 驱动的日本就活支援平台。通过多 Agent 对话深挖个人经历，自动生成 ES、企业侦察报告，并提供模拟面试练习，全方位辅助日本求职流程。

## 功能概览

- **AI 对话深挖经历** — 基于 STAR 法则的多轮对话，引导用户梳理并结构化个人经历，生成可复用的履历档案
- **企业侦察报告** — 网页抓取 + LLM 分析，生成目标公司的深度简报（Firecrawl → Tavily → LLM 三级降级）
- **ES 自动生成** — 结合履历档案和公司简报，一键生成日文志望動機和自我 PR
- **模拟面试** — 严厉日本面试官角色，全程日语敬语，逐题推进
- **Gmail 邮件监控** — 自动识别面接通知、宣讲会、笔试、内定、不采用等邮件，并写入 Google Calendar
- **Google Calendar 集成** — OAuth 授权后自动同步求职日程
- **Telegram 通知** — 绑定 Bot 后接收实时求职动态推送
- **求职状态看板** — 9 种状态追踪（researching → offer/rejected），可视化管理全部投递

## 技术栈

| 层级 | 技术 |
|------|------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Wouter, React Query |
| Backend | Node.js, Express, tRPC, Drizzle ORM |
| Database | MySQL |
| Auth | Email/Password + Google OAuth |
| AI/LLM | 多 Agent 架构（STAR 对话、企业侦察、ES 生成、模拟面试） |
| External APIs | Google Calendar, Gmail, Telegram Bot, Resend, Firecrawl, Tavily |
| Build | Vite, esbuild, pnpm |
| Test | Vitest |

## 项目结构

```
careerpass/
├── client/          # React 前端
├── server/          # Express + tRPC 后端
├── shared/          # 共享类型与常量
├── drizzle/         # 数据库 Schema 与迁移
└── scripts/         # 工具脚本
```

## 快速开始

### 前置条件

- Node.js >= 18
- pnpm
- MySQL
- 各 API 密钥（见下方环境变量）

### 安装

```bash
pnpm install
```

### 环境变量

复制模板：

```bash
cp .env.example .env
```

`.env.example` 列出全部已知变量与默认值。下面只解释关键分组，详细注释见模板本身。

#### 必填

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | MySQL 连接串。|
| `JWT_SECRET` | 应用 JWT 签名密钥。|
| `APP_DOMAIN` | 公网 HTTPS 域名，用于生成 Telegram / Gmail Push / Calendar Push 的 webhook URL。|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth（Gmail + Calendar）。|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token。|

#### Gmail Push（实时主路径）

| 变量 | 说明 |
|------|------|
| `GMAIL_PUBSUB_TOPIC` | 完整 topic 资源名 `projects/<gcp>/topics/<id>`。|
| `GMAIL_PUBSUB_SUBSCRIPTION` | Push subscription 名。|
| `GMAIL_PUBSUB_AUDIENCE` | OIDC audience，需等于 `${APP_DOMAIN}/api/gmail/push`。|
| `GMAIL_PUBSUB_SERVICE_ACCOUNT` | Push subscription 使用的 OIDC service account。|

#### Gmail Fallback / Bootstrap 策略

Push 为主路径，但 watch 过期、historyId 失效、首次 OAuth 等场景需要受控 fallback。所有开关默认开启（unset 视为 true），设为 `"false"` 即关闭对应分支。

| 变量 | 默认 | 行为 |
|------|------|------|
| `GMAIL_BACKGROUND_SCAN_ENABLED` | `true` | 允许 `startBackgroundMailScan` 在后台跑全量初始化扫描。|
| `GMAIL_OAUTH_BOOTSTRAP_SCAN_ENABLED` | `true` | OAuth 成功后允许一次受控 bootstrap scan。|
| `GMAIL_HISTORY_EXPIRED_FALLBACK_ENABLED` | `true` | historyId 失效时允许 silent resync，否则只更新 checkpoint 等待 `/rewatch_gmail`。|
| `GMAIL_FALLBACK_SUPPRESS_ITEM_TELEGRAM` | `true` | Fallback 过程中不发送单条 Telegram 通知。|
| `GMAIL_FALLBACK_NOTIFY_SUMMARY` | `true` | Fallback 结束后发送一条摘要通知。|

#### Calendar Push（Phase B+）

`CALENDAR_PUSH_ENABLED`、`CALENDAR_WEBHOOK_PATH`、`CALENDAR_CHANNEL_TOKEN` 等控制 Google Calendar `events.watch` 行为，详见模板。

#### Private Mode

`PRIVATE_MODE=true` 用于两人自用：绕过 billing gate，仅放行白名单内的用户/Telegram ID。设为 `false` 时保留 SaaS 行为。

### 数据库迁移

```bash
pnpm db:push
```

### 开发

```bash
pnpm dev
```

启动后访问 http://localhost:3000

### 生产构建

```bash
pnpm build
pnpm start
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（热重载） |
| `pnpm build` | 构建前端 + 后端 |
| `pnpm start` | 运行生产构建 |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm db:push` | 生成并执行数据库迁移 |

## 设计系统

UI 遵循 Notion 风格设计语言：暖色调中性色、超细边框、多层次低透明度阴影、Inter 字体。详见 [DESIGN.md](./DESIGN.md)。

## License

MIT
