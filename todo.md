# CareerPass (就活パス) - Project TODO

## Phase 1: 项目初始化与基础架构
- [x] 初始化项目脚手架 (React + tRPC + Express + Drizzle)
- [x] 设计并迁移数据库 Schema（users扩展、oauth_tokens、telegram_bindings、job_applications、agent_memory、agent_sessions）
- [x] 配置全局主题（深色专业风格，Inter + Noto Sans JP 字体）
- [x] 安装必要依赖（qrcode.react、nanoid）
- [x] 配置路由框架（/, /register, /dashboard, /dashboard/calendar/callback, /dashboard/chat, /dashboard/jobs, /dashboard/es, /dashboard/interview）

## Phase 2: 用户注册/登录系统
- [x] 扩展 users 表（birthDate、education、universityName、preferredLanguage、profileCompleted）
- [x] 注册页面 UI（两步骤表单：基本信息 + 语言偏好）
- [x] 后端注册 tRPC procedure（user.completeRegistration）
- [x] 个人中心 Dashboard 布局（侧边栏导航 + 移动端适配）
- [x] 用户信息展示（Profile Summary 卡片）
- [x] 快捷操作入口（AI聊天、ES生成、模拟面试、求职管理）

## Phase 3: 个人中心模块1 - 日历OAuth授权
- [x] 前端"连接 Google/Outlook 日历"按钮与跳转逻辑
- [x] OAuth 2.0 授权回调页面 /dashboard/calendar/callback（CalendarCallback.tsx）
- [x] 后端 oauth_tokens 表（存储 access_token、refresh_token、provider、expiresAt）
- [x] 后端 Google Calendar OAuth 流程（授权URL生成、Token交换、存储）
- [x] 后端 Outlook Calendar OAuth 流程
- [x] 日历授权状态展示（已连接/未连接）
- [x] 断开日历连接功能

## Phase 4: 个人中心模块2 - Telegram绑定
- [x] 后端 telegram_bindings 表（userId、telegramId、telegramUsername、isActive）
- [x] 前端动态生成 Deep Link（https://t.me/CareerpassBot?start=user_xxx）
- [x] 前端 QR 码生成展示（qrcode.react）
- [x] 后端 Telegram Bot Webhook 接入（/api/telegram/webhook）
- [x] Webhook 解析 /start user_xxx 并绑定账号
- [x] 多语言欢迎消息（ja/zh/en）
- [x] Telegram 绑定状态展示（已绑定/未绑定，5秒轮询）
- [x] 后续扩展 Line/WhatsApp/WeChat（messaging_bindings 表已实现 provider 抽象，支持 telegram/line/whatsapp/wechat）

## Phase 5: LangGraph 多 Agent 工作流（基础版）
- [x] careerpass 中枢 Agent：多语言打招呼（ja/zh/en）
- [x] careerpass：STAR 法则多轮对话深挖经历（AgentChat.tsx）
- [x] careerpass：生成结构化履历 USER_<SessionID>.md 并存入记忆库
- [x] careerpassrecon：生成《公司深度简报》[公司日文名]_Recon_Report.md（LLM基础版）
- [x] careerpasses：读取 USER.md + 公司简报，生成日文 ES（志望動機+自己PR）
- [x] careerpassinterview：严厉日本面试官角色，全程日语敬语，每次1个问题
- [ ] Firecrawl 真实网页抓取集成（需要 FIRECRAWL_API_KEY）
- [ ] Tavily 搜索 API 集成（需要 TAVILY_API_KEY）
- [ ] web-content-fetcher 降级方案
- [ ] LangGraph 状态机编排（Python 微服务）

## Phase 6: 记忆库与状态追踪
- [x] agent_memory 表（userId、memoryType、title、content、metadata）
- [x] 求职状态看板 UI（JobTracker.tsx，含状态更新）
- [x] job_applications 表（9种状态：researching→offer/rejected）
- [ ] pgvector 语义相似度搜索
- [ ] Gmail/Outlook 邮件监控后台任务
- [ ] 邮件自动识别并写入日历

## Phase 7: 联调、测试与部署
- [x] Vitest 单元测试（35 tests passing，含凭据验证、多渠道绑定架构测试）
- [x] 配置 Google OAuth 凭据（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）
- [x] 配置 Telegram Bot Token（TELEGRAM_BOT_TOKEN）
- [ ] 配置 Outlook OAuth 凭据（用户暂时跳过）
- [ ] Firecrawl 集成（需要用户提供 FIRECRAWL_API_KEY）
- [ ] Tavily 搜索 API 集成（需要用户提供 TAVILY_API_KEY）
- [ ] 注册 Telegram Webhook（发布后执行）
- [ ] 发布到 Manus 托管环境
