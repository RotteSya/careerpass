# CareerPass

CareerPass 是一个以求职流程为核心的全栈应用，包含：

- Web 端看板与聊天入口（React + tRPC）
- 后端 Agent 编排、邮件识别、日历同步（Express + Drizzle/MySQL）
- Telegram Bot 交互入口
- 可选 OpenClaw 混合模式（失败自动回退 legacy agent）

## 本地开发

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发环境

```bash
npm run dev
```

默认会启动后端与前端（Vite）。

## 常用脚本

```bash
npm run dev      # 本地开发
npm run check    # TypeScript 检查
npm run test     # 运行测试
npm run build    # 生产构建
```

## OpenClaw 混合架构

详见：

- `docs/openclaw-hybrid.md`

关键点：

- `OPENCLAW_HYBRID_ENABLED=true` 时，聊天会优先走 OpenClaw
- OpenClaw 调用失败会自动回退到现有 `handleAgentChat`
- OpenClaw tools API 在 `/api/openclaw-tools/*`，受 `x-openclaw-secret` 保护

## Smoke 测试（OpenClaw tools）

```bash
export APP_BASE_URL=http://localhost:3000
export OPENCLAW_TOOL_SECRET=your_secret
export TEST_USER_ID=1
export TEST_COMPANY_NAME='トヨタ'
scripts/smoke-openclaw-tools.sh
```

## 目录概览

- `client/`：前端页面与组件
- `server/`：后端路由、Agent、集成逻辑
- `drizzle/`：数据库 schema 与迁移
- `agents/`：各子 agent 的 SOUL/AGENTS 配置
- `docs/`：架构与接入文档
