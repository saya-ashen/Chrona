# 改进审计 / Improvement Audit

Date: 2026-05-31

Scope: 只读全栈分析，覆盖产品体验、核心用户流程、代码质量、架构扩展性、
性能/安全/稳定性、测试覆盖，以及快速高价值改动。本文件是继
`production-readiness-audit.md`（2026-05-21）之后的新审计，重点纳入 015
外部日历功能引入的新风险，并复核了旧审计项的修复状态。

## 旧审计复核（2026-05-21 → now）

| 旧 P0 项 | 当前状态 |
| --- | --- |
| AI client 密钥返回前端 | 已修复。`apps/server/src/routes/ai/clients.routes.ts:38` 用 `redactClientConfig` + `SECRET_CONFIG_KEYS` 白名单剥离密钥后再序列化。 |
| 生产 500 暴露内部错误 | 部分缓解。`app.ts` onError 走 i18n 文案 + 结构化日志；但 `lib/http.ts internalServerError` 仍用 `console.error`（日志双轨，见 P2-#2）。 |
| 其余（Docker bind、Hermes 原始日志、deadcode、E2E 端口）| 未在本次范围内逐一复核，沿用旧审计结论。 |

总体判断：工程底盘扎实（spec-kit 驱动、严格 TS、shadcn 约束、边界检查、
属性测试、多端 e2e、lease 化单 owner 调度器）。下一阶段的主要风险集中在三处：
**015 日历功能引入的真实安全漏洞**、**核心循环的闭环缺口（日历刷新）**、
**少数超大组件/服务的可维护性债**。

## P0 — 安全 / 数据正确性（必须优先）

### P0-1 日历 Feed 存在 SSRF + 任意本地文件读取（HIGH）

证据：
- `packages/integrations/src/calendar/feed-fetcher.ts:16-24` `defaultCalendarFeedTransport`：
  - `file:` 开头 URL → `readFile(fileURLToPath(url))`，可读任意本地文件（`file:///etc/passwd`）。
  - 其余走裸 `fetch(url)`，无私网/localhost/云元数据端点拦截，可请求
    `http://169.254.169.254`、内网主机。
- `packages/integrations/src/calendar/source-url.ts:23` `normalizeCalendarSourceUrl`
  在生产代码中显式放行 `file:` scheme（注释称其为"测试 fixture"）。

攻击链：`calendar-sources.routes.ts` → `external-calendar-service`
（`validateSourceUrl`/`createSource`/`refreshSource`）→ `fetchCalendarFeed`
→ `defaultCalendarFeedTransport(userUrl)` → 裸 fetch / 本地文件读取。

已有缓解：1MB 截断（`MAX_CALENDAR_FEED_BYTES`）、存储 redacted URL label、
错误文案经 `safeCalendarErrorMessage` 脱敏。
缺失：生产 scheme 限制、私网/保留 IP 黑名单、重定向跳数与逐跳 IP 校验。

影响：local-first 默认绑 127.0.0.1 降低了爆炸半径，但 `file:` 读取是实打实的，
且该功能本质面向网络，SSRF 现实风险被放大。

解决方案：
1. 生产路径仅允许 `https:`；`file:` 仅在测试注入 transport 时可用，移出生产 normalizer。
2. 解析 DNS 后校验目标 IP，黑名单私网/保留/元数据网段（防 DNS rebinding）。
3. 限制重定向跳数，并对每个重定向目标重新校验 IP。
4. 每条拦截规则写成回归测试（见 P3-#1）。

### P0-2 鉴权时序不安全 + 默认全开放

证据：
- `apps/server/src/middleware/auth.ts:28` 用 `providedKey !== expectedKey`（非常量时间比较）。
- 未设 `API_KEY` 时鉴权直接 no-op（`auth.ts:10-12`）；`config/env.ts:12`
  `ALLOWED_ORIGINS` 默认 `*`，`app.ts:24` 据此返回 `*`。

良好实践（保留）：`config/env.ts assertSafeBind()` 拒绝无 key 的 `HOST=0.0.0.0`，
除非显式 `CHRONA_UNSAFE_PUBLIC_BIND=1`。

解决方案：
1. key 比较改用 `crypto.timingSafeEqual`（先比长度，再常量时间比较）。
2. 启动日志在"未启用鉴权 / CORS=*"时打印醒目提示（见 P4-#3）。

## P1 — 核心流程闭环缺口（直接影响产品价值）

### P1-1 日历订阅没有自动刷新

证据：`packages/.../external-calendar-service.ts:35` 定义 `REFRESH_INTERVAL_MS=1h`
并计算 `nextExpectedRefreshAt`（line 134），但全仓 grep 确认**无任何代码消费它**
——刷新只能手动 `POST .../refresh`。"订阅日历"实质是一次性导入，会静默过期。

已有基础设施：任务侧的 lease 化调度器（`task-orchestrator.ts`、
`due-scheduled-work-worker.ts`、`restart-recovery-worker.ts`，按 worker 注册、
15s tick、单 owner lease）完全可复用。

解决方案：新增一个 orchestration worker（如 `calendar-refresh-worker`），
按 `nextExpectedRefreshAt` 到期触发 `refreshSource`，注册进现有 orchestrator
worker 集合即可复用 lease/恢复/事件记录。这是 015 从"能用"到"可信"的关键一步。

### P1-2 `TaskStatus` 同时存在 `Completed` 与 `Done`

证据：`prisma/schema.prisma` 的 12 态枚举里 `Completed` 与 `Done` 并存。

影响：极易在状态机判断、过滤、UI 文案上产生分叉 bug，是会持续产生隐性 bug
的设计债。

解决方案：先文档化二者的精确语义边界（零代码成本止血），再评估合并或明确各自触发点。

### P1-3 路由 loader 串行瀑布

证据：`apps/web/src/loaders.ts` 中 `loadScheduleRouteData`/`loadInboxRouteData`/
`loadMemoryRouteData`/`loadTaskListData` 均为两跳串行：先
`GET /api/workspaces/default`，拿到 id 再请求真实数据。每次导航多一个串行 RTT。
另：`loadWorkPageData:118-129` 的 try/catch 是死代码（仅 re-throw）。

解决方案：默认 workspace 在 app boot（`loadAppBootData`）解析一次并缓存，
后续 loader 从已加载 boot 数据取 id；删除 `loadWorkPageData` 的无效 try/catch。

## P2 — 可维护性 / 架构债

### P2-1 超大文件（god-component / god-service）

按 LOC 排序的热点（均无相邻测试，且为高频改动核心）：
- 前端：`schedule/forms/task-config-form.tsx` **1432**（最大，按字段组拆子组件 + 抽 hook）；
  `settings/ai-clients-manager.tsx` 841；`execution/task-workspace-node-detail-panel.tsx` 768；
  `schedule/timeline/schedule-page-timeline.tsx` 745。
- 引擎：`services/agent-tool-operations.service.ts` **1089**；
  `plan-execution/task-plan-execution.ts` 812；`ai-runtime-invoker.ts` 771。

解决方案：边拆分边补测（见 P3）。优先 `task-config-form.tsx` 与
`agent-tool-operations.service.ts`。

### P2-2 错误处理不一致 + 脆弱的字符串匹配

证据：
- `lib/http.ts internalServerError` 用 `console.error`，而 `app.ts` 用结构化
  `@chrona/shared/logger` —— 日志双轨。
- `calendar-sources.routes.ts:76` 靠匹配 Prisma 文案 `'Record to update not found'`
  判断 404 —— Prisma 升级即碎。
- `external-calendar-service` 用字符串哨兵（`'calendar_source_not_found'`、
  `'malformed_calendar'`）当错误，而非已有的 `EngineError` 类型化错误码体系
  （`lib/http.ts toHttpError` 已有完整 code→status 映射）。

解决方案：日志统一到结构化 logger；Prisma 404 改用错误码 `P2025`；
日历错误并入 `EngineError` 体系。

### P2-3 仓库提交了构建产物

证据：`dist/releases/` 含 4 个平台构建及各自打包的 schema 副本（二进制入 git）。

解决方案：移出版本控制，走 release artifact，避免仓库膨胀与 schema 副本漂移。

## P3 — 测试覆盖缺口

整体测试文化好（Vitest + Bun Test + Playwright 三端 + fast-check + msw，
orchestration 模块几乎每个文件都有相邻 `.bun.test.ts`），但有明显空洞：

- **`integrations/calendar` 仅 1 个测试文件** —— 恰是刚引入且含 SSRF 风险的模块。
  应补：scheme 拦截、私网拦截、1MB 截断、畸形 ICS 解析。
- `providers/hermes`、`providers/debug` 各仅 1 个测试。
- 最大前端组件（`task-config-form.tsx`、`ai-clients-manager.tsx`）无相邻测试
  ——拆分时同步补测。
- 修 P0 安全项时，把每条拦截规则写成回归测试。

## P4 — 快速高价值小改动

- **删死代码**：`loadWorkPageData` 的无效 try/catch（`loaders.ts:118-129`）。
- **常量时间比较**：auth key 比较一行改动，安全收益明显（P0-2）。
- **启动横幅**：未启用鉴权 / CORS=`*` 时在 server 启动日志打印醒目提示。
- **`https:`-only 校验**：日历源新增校验，单点改动堵住 `file:` 读取主面（P0-1 子集）。
- **`Completed`/`Done` 文档化**：先写清状态机语义，零代码成本先止血。

## 建议执行顺序

1. P0 安全（SSRF/`file:` + 常量时间比较）——含回归测试。
2. P1-1 日历自动刷新——复用 orchestrator worker，补全 015 闭环。
3. P1-2 / P2-2 状态语义与错误处理一致性。
4. P2-1 超大组件拆分（边拆边补 P3 测试）。
