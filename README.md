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

创建 `.env` 文件，填入以下配置：

```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/careerpass

# Auth
JWT_SECRET=your-jwt-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Email (Resend)
RESEND_API_KEY=your-resend-api-key

# AI / Web Scraping
OPENAI_API_KEY=your-openai-api-key
FIRECRAWL_API_KEY=your-firecrawl-api-key
TAVILY_API_KEY=your-tavily-api-key

# AWS S3 (optional)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=ap-northeast-1
AWS_S3_BUCKET=your-bucket-name
```

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
