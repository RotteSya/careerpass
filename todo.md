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
  - [x] Firecrawl 真实网页抓取集成（三级降级：Firecrawl → Tavily → LLM-only）
  - [x] Tavily 搜索 API 集成（careerpassrecon 企业侦察）
  - [x] web-content-fetcher 降级方案（已内置在 recon.ts 三级降级逻辑中）
  - [ ] LangGraph 状态机编排（Python 微服务，待后续迭代）

## Phase 6: 记忆库与状态追踪
- [x] agent_memory 表（userId、memoryType、title、content、metadata）
- [x] 求职状态看板 UI（JobTracker.tsx，含状态更新）
- [x] job_applications 表（9种状态：researching→offer/rejected）
- [x] 文本相似度搜索（pgvector 替代方案，基于 TF-IDF 风格 token 匹配）
- [x] Gmail 邮件监控（gmail.ts，识别面接/宣讲会/笔试/内定/不采用类型）
- [x] 邮件自动识别并写入 Google Calendar 日程
- [x] 个人中心添加邮件监视按鈕和记忆库搜索模块

## Phase 7: 联调、测试与部署
- [x] Vitest 单元测试（54 tests passing，含 recon、gmail分类、凭据验证、多渠道绑定架构测试）
- [x] 配置 Google OAuth 凭据（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）
- [x] 配置 Telegram Bot Token（TELEGRAM_BOT_TOKEN）
- [x] 配置 Firecrawl API Key（FIRECRAWL_API_KEY）
- [x] 配置 Tavily API Key（TAVILY_API_KEY）
- [ ] 配置 Outlook OAuth 凭据（用户暂时跳过）
- [x] 注册 Telegram Webhook（scripts/register-telegram-webhook.sh 已创建，发布后执行 DOMAIN=https://xxx.manus.space ./scripts/register-telegram-webhook.sh）
- [ ] 发布到 Manus 托管环境（点击右上角 Publish 按鈕，由用户操作）

## Bugs

- [x] [BUG] Google OAuth 回调页面显示「連携に失敗しました。認証コードが見つかりません」— 已修复：handleCallback 改为 publicProcedure，通过 state 中的 userId 识别用户，不再依赖跨站重定向后可能丢失的 session cookie
- [x] OAuth state 加固：HMAC-SHA256 签名，防伪造、防篹改、防重放（10分钟过期）
- [x] 补充 OAuth 回调针对性测试（12 tests，覆盖签名验证、伪造拒绝、过期拒绝、URL参数解析）
- [x] 重新发布到生产环境（请点击 Publish 按鈕）

## Frontend Debug & Polish

- [x] [Home] 移除「デモを見る」按鈕
- [x] [Home] 重写为非对称布局，添加 Framer Motion 入场动画，右侧统计卡片
- [x] [Dashboard] 修复侧边栏高亮失效（useLocation），Outlook 改为准备中状态，添加移动端底部导航栏
- [x] [Register] 结构良好，无需修复
- [x] [InterviewSimulator] 修复 auth 检查缺少 loading 状态保护
- [x] [NotFound] 重写为深色主题日语风格
- [x] 重新发布到生产环境（请点击 Publish 按鈕）

- [x] [BUG] 注册完成后跳回表单页——已修复：Register 在 navigate 前先 invalidate getProfile 缓存；Dashboard 路由守卫增加 profileLoading 状态保护，防止竞态条件误判断
- [x] [BUG] Google OAuth 回调依然显示「認証コードが見つかりません」— 已修复：新增 server/calendarOAuth.ts 服务端 Express 路由 /api/calendar/callback，直接处理 token 交换并重定向到 /dashboard?calendar=success，彻底绕过 SPA 路由冲突

## UI Polish v1.9
- [x] 删除移动端底部导航栏（Dashboard.tsx 中的 Mobile Bottom Nav 区块）
- [x] Telegram 绑定成功后自动将用户注册信息写入 USER.md（agent_memory 表）
- [x] Telegram Bot 对话逻辑：检测已有 USER.md 则跳过重复收集信息环节，直接进入主菜单

## v2.0 Agent 优化
- [x] 移除前端 Dashboard 中的「メール自動監視」模块（UI + 相关 tRPC 调用）
- [x] 移除前端 Dashboard 中的「記憶ライブラリ検索」模块（UI + 相关 tRPC 调用）
- [x] 修复 Agent 重复询问已知信息：在 agent.chat 系统提示词中注入用户档案（姓名/年龄/学历/大学/语言偏好），明确禁止 Agent 重复询问已知信息

## v2.1 邮箱注册/登录体系（替换 Manus OAuth）
- [x] 数据库：新增 email_auth 表（email/passwordHash/verifyToken/verifiedAt/userId），执行迁移
- [x] 后端：auth.register 过程（邮箱+密码注册，发送验证邮件）
- [x] 后端：auth.verifyEmail 过程（token 验证，标记已验证，创建 session）
- [x] 后端：auth.emailLogin 过程（邮箱+密码登录，返回 session）
- [x] 后端：auth.resendVerification 过程（重发验证邮件）
- [x] 配置 Resend API Key 环境变量
- [x] 前端：SignUp.tsx（/signup）邮箱+密码注册表单
- [x] 前端：Login.tsx（/login）邮箱+密码登录页
- [x] 前端：注册成功后 SignUp.tsx 内联显示「请查收邮件」提示
- [x] 前端：EmailVerified.tsx（/email-verified）验证成功后跳转个人信息表单
- [x] 前端：首页 CTA「今すぐ無料で始める」改为跳转 /signup
- [x] 前端：移除 Manus OAuth 登录入口（Header 的「ログイン」按钮改为跳转 /login）
- [x] 更新 useAuth hook 兼容新的 session 机制（沿用 auth.me tRPC 查询，无需修改）

## v2.3 Bug 修复
- [x] [BUG] 邮箱验证后跳转到 /login 而非 /register — 已修复：sdk.ts 中 authenticateRequest 对 email: 前缀的 openId 跳过 Manus OAuth 同步，直接从数据库查找用户

## v2.4 域名修复
- [x] [BUG] 验证邮件链接指向 careerpax.manus.space 而非 careerpax.com — 已修复：APP_DOMAIN 环境变量更新为 https://careerpax.com
