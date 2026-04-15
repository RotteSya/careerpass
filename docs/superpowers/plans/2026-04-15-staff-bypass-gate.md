# Staff Bypass Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留 Waitlist 引流，同时给团队提供可控的 staff bypass 通行证（不依赖账号/DB 状态）

**Architecture:** 服务端通过 `STAFF_BYPASS_TOKEN` 签发 httpOnly cookie `cp_staff_bypass=1`（30 天）。前端启动时请求 `/api/internal/bypass/status` 判定渲染 Waitlist 或 Router，移除 `/?bypass=true` + localStorage 后门。

**Tech Stack:** Express, Vite/React, Vitest

---

## Files

- Create: [internalBypass.ts](file:///workspace/server/internalBypass.ts)
- Modify: [index.ts](file:///workspace/server/_core/index.ts)
- Modify: [App.tsx](file:///workspace/client/src/App.tsx)
- Test: [internalBypass.test.ts](file:///workspace/server/internalBypass.test.ts)

### Task 1: 添加 internal bypass 路由（TDD）

**Files:**
- Create: [internalBypass.test.ts](file:///workspace/server/internalBypass.test.ts)
- Create: [internalBypass.ts](file:///workspace/server/internalBypass.ts)

- [ ] **Step 1: 写失败测试（status / enable / logout）**

```ts
import { describe, expect, it } from "vitest";
import { internalBypassRouter } from "./internalBypass";

// 断言：无 cookie -> status=false；token 不匹配 -> 401；
// token 匹配 -> 设置 cp_staff_bypass cookie 并 302；
// logout -> 清 cookie 并 200
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm test -- --runInBand server/internalBypass.test.ts
```

Expected: FAIL（模块不存在 / 行为未实现）

- [ ] **Step 3: 最小实现 internalBypassRouter**

实现点：
- Cookie 名：`cp_staff_bypass`
- `GET /api/internal/bypass?token=...`：校验 `STAFF_BYPASS_TOKEN`，成功则 `res.cookie(..., maxAge=30d, httpOnly=true, sameSite=lax, secure=...)` 并 `302 /`
- `GET /api/internal/bypass/status`：读取 cookie，返回 `{ bypassed: boolean }`，并 `Cache-Control: no-store`
- `GET /api/internal/bypass/logout`：清 cookie 并 `302 /`
- 限流：该 router 内部使用现有 `createRateLimiter/createRateLimitMiddleware`，key=ip，max=10/min

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test -- --runInBand server/internalBypass.test.ts
```

Expected: PASS

### Task 2: 接入 server 路由挂载

**Files:**
- Modify: [index.ts](file:///workspace/server/_core/index.ts)

- [ ] **Step 1: 写失败测试（可选）或用现有 unit test 覆盖**

本仓库未使用 supertest；保持 unit test 覆盖 internal router 的 handler 即可。

- [ ] **Step 2: 修改 index.ts 挂载路由**

挂载：

```ts
app.use("/api/internal/bypass", internalBypassRouter);
```

要求：放在 `/api/trpc` 前后均可，但应在 `express.json` 后。

- [ ] **Step 3: 全量测试**

```bash
pnpm test -- --runInBand
pnpm check
```

### Task 3: 前端门禁改造（移除公开后门）

**Files:**
- Modify: [App.tsx](file:///workspace/client/src/App.tsx)

- [ ] **Step 1: 写行为测试（可选）**

仓库无前端测试框架；本次改动用手动验证（本地 `pnpm dev`）+ 代码审查保证。

- [ ] **Step 2: 改 App.tsx**

改动点：
- 删除 `URLSearchParams` + `localStorage.admin_bypass` 逻辑
- 改为在 `useEffect` 中 `fetch("/api/internal/bypass/status")` 获取 `{ bypassed }`
- `isChecking` 期间返回 `null`（保持现有行为）
- `bypassed=false` -> 渲染 Waitlist；`true` -> 渲染 Router

- [ ] **Step 3: 手动验证**

1. 无 cookie 访问 `/`：应显示 Waitlist
2. 访问 `/api/internal/bypass?token=<STAFF_BYPASS_TOKEN>`：应 302 回 `/` 且进入 Router
3. 访问 `/api/internal/bypass/logout`：应回到 Waitlist

### Task 4: 完整回归

- [ ] **Step 1: 跑全量测试 + 类型检查**

```bash
pnpm test -- --runInBand
pnpm check
```

- [ ] **Step 2: 部署注意事项**

需要新增环境变量：
- `STAFF_BYPASS_TOKEN`（32+ bytes base64url）

