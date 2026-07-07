# Chrona 测试指南

## 当前测试基建

Chrona 测试基建由五层组成：

| 层级 | 命令 | 适用范围 |
|------|------|----------|
| 类型/静态检查 | `bun run typecheck`, `bun run lint` | TypeScript、ESLint、基础质量门禁 |
| Vitest | `bun run test` | 前端组件、hooks、纯 TypeScript 单元测试 |
| Bun Test | `bun run test:bun` | Bun-only runtime、SQLite/Prisma、engine、contracts、providers |
| API Test | `bun run test:api` | Hono route/API 工作流 |
| Playwright | `bun run test:e2e` | 浏览器端关键用户旅程 |

默认测试不得访问真实 LLM、真实外网或开发者本机数据。真实 provider 数据只能通过显式 fixture record 命令生成。

## 新增工具

| 工具 | 用途 | 位置 |
|------|------|------|
| MSW | 前端组件/API mock | `apps/web/src/test/msw/` |
| `@axe-core/playwright` | E2E 可访问性扫描 | `e2e/specs/accessibility-test-helpers.ts` |
| `fast-check` | 状态矩阵/属性测试 | domain、graph-runtime、schedule 纯逻辑测试 |
| LLM fixture recorder | 录制/回放 provider 返回快照 | `packages/engine/src/test/llm-fixture-recorder.ts` |

## 推荐命令

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run test:e2e:desktop
bun run test:e2e:tablet
bun run test:e2e:mobile
CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay
CHRONA_LLM_FIXTURE_MODE=record bun run test:llm:record
```

完整覆盖率交付前必须记录以下命令结果：

| 命令 | 目的 | 结果记录 |
|------|------|----------|
| `bun run typecheck` | TypeScript 严格类型检查 | `specs/014-test-coverage/verification/typecheck.md` |
| `bun run lint` | ESLint 与 UI foundation 相关静态检查 | `specs/014-test-coverage/verification/lint.md` |
| `bun run test` | Vitest 前端/共享单元测试 | `specs/014-test-coverage/verification/test.md` |
| `bun run test:bun` | Bun runtime、engine、domain、contracts、provider 测试 | `specs/014-test-coverage/verification/test-bun.md` |
| `bun run test:api` | Hono/API 工作流测试 | `specs/014-test-coverage/verification/test-api.md` |
| `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay` | Provider fixture replay，不访问真实 LLM | `specs/014-test-coverage/verification/test-llm-replay.md` |
| `bun run test:e2e:desktop` | Desktop 端到端工作流 | `specs/014-test-coverage/verification/test-e2e-desktop.md` |
| `bun run test:e2e:tablet` | Tablet 端到端工作流和响应式回归 | `specs/014-test-coverage/verification/test-e2e-tablet.md` |
| `bun run test:e2e:mobile` | Mobile 端到端工作流和无横向滚动回归 | `specs/014-test-coverage/verification/test-e2e-mobile.md` |

如果运行单个数据库相关 Bun 测试文件，先创建隔离 SQLite：

```bash
bun run scripts/init-sqlite-db.ts --reset .tmp/<suite-name>.db
DATABASE_URL=file:/absolute/path/to/.tmp/<suite-name>.db NODE_ENV=test bun test <files>
```

## 测试数据原则

- 优先使用 builders 和 fixtures，不在测试体内复制大段对象。
- 数据必须 deterministic，可读、可复现。
- bug 回归测试先抽取最小数据，再写红测。
- 不使用真实用户 prompt、真实日程、API key、本地路径。
- seed 只提供基础世界；测试自己创建最小差异数据。

## LLM Fixture 规范

真实 LLM/provider 数据采用 record/replay/off 三模式。录制边界必须是 provider 返回值，即 `ProviderRunSnapshot`，不能录制上层 feature normalizer、业务 service 或任意包装函数的返回值。

| 模式 | 环境变量 | 行为 |
|------|----------|------|
| off | unset | 不读写 cassette，直接执行 provider 请求 |
| record | `CHRONA_LLM_FIXTURE_MODE=record` | 执行真实 provider 请求或受控 debug provider 请求，脱敏后写入 fixture |
| replay | `CHRONA_LLM_FIXTURE_MODE=replay` | 从 fixture 读取 `ProviderRunSnapshot`，不访问网络 |

cassette 路径：

```text
packages/engine/src/test/llm-fixtures/<provider>/<feature>/<name>.json
```

cassette 必须包含：

- `schemaVersion`
- `provider`
- `feature`
- `recordedAt`
- `request.inputHash`
- `request.redactedInput`
- `response`，类型为 `ProviderRunSnapshot`

`response` 至少应覆盖 provider 合约字段：

- `provider`
- `runId`
- `status`
- `outputText` 或 `structuredPayload`
- `error`

上层解析结果不写入 cassette。需要验证 feature 解析时，应先 replay provider snapshot，再让生产解析逻辑处理 `structuredPayload` / `outputText`。

禁止写入：

- API key / Authorization header
- 用户真实任务内容
- 真实 calendar/memory/action-center 数据
- 本地绝对路径
- chain-of-thought / reasoning trace
- provider 原始 debug metadata 中的敏感字段

## 前端测试规范

- 默认使用 Testing Library 行为断言，不写 snapshot。
- API mock 优先使用 MSW：从 `apps/web/src/test/msw/server.ts` 导入 `server`，在测试文件内显式 `listen/resetHandlers/close` 后使用 `server.use(http.get(...))`。
- MSW 不在全局 setup 自动启动。每个需要网络 mock 的测试文件必须显式声明生命周期，避免无关测试被隐藏的 handler 污染：`beforeAll(() => server.listen({ onUnhandledRequest: "error" }))`、`afterEach(() => server.resetHandlers())`、`afterAll(() => server.close())`。
- 需要 React Query 时使用 `renderWithQueryClient()`。
- UI 文案从 i18n message 走，不在测试中固化无关文案。
- SSE 相关逻辑测试 `apps/web/src/lib/fetch-json-event-source.ts`，组件只测用户可见状态。

## E2E 规范

- 默认 desktop：`bun run test:e2e:desktop`。
- viewport 回归：`bun run test:e2e:tablet`、`bun run test:e2e:mobile`。
- 移动端必须无横向滚动。
- 可访问性扫描用 `scanPageAccessibility(page)`，再断言 violations。
- E2E 只覆盖关键旅程，不替代 API/engine 测试。

## 测试运行器

Chrona 使用三套运行器处理不同层级的测试：

| 运行器 | 文件模式 | 用途 |
|--------|----------|------|
| **Bun Test** | `*.bun.test.ts` | 后端集成测试、API 工作流测试、桥接合约测试 |
| **Vitest** | `*.test.ts(x)` | 前端组件测试、单元测试 |
| **Playwright** | `e2e/*.spec.ts` | 端到端浏览器测试 |

三者互斥：Vitest 配置显式排除 `*.bun.test.ts` 和 `e2e/`，不会交叉运行。

## 运行测试

```bash
# 全部测试（Vitest 单元 + 覆盖率）
bun run test

# Vitest 监听模式
bun run test:watch

# Bun 后端测试（指定目录）
bun test apps/server/src/__tests__/
bun test packages/engine/src/modules/

# 单个 Bun 测试文件
bun test apps/server/src/__tests__/api/task-workflow.bun.test.ts

# 端到端测试
bun run test:e2e

# 代码检查 + 类型检查 + 测试
bun run lint && bun run typecheck && bun run test
```

## 测试覆盖范围

### 1. 单元测试（Vitest — `*.test.ts(x)`）

位于 `apps/web/src/` 内各模块的 `__tests__/` 目录，覆盖：

- **UI 组件** — 渲染、交互、边界状态（空列表、错误、加载）
- **Hooks / 工具函数** — 纯逻辑单元
- **状态派生** — `packages/domain/` 中的业务规则

前端测试使用 `vi.mock()` 做模块级 stub，测试环境为 `jsdom`，setup 文件注入 `@testing-library/jest-dom` 断言扩展。

### 2. 运行时单元测试（Bun Test — `*.bun.test.ts`）

位于 `packages/engine/src/modules/` 内各子模块的 `__tests__/` 目录，覆盖：

- **服务（services）** — create-task、update-task、generate-task-plan 等 CQRS 写操作
- **页面模块（pages）** — get-dashboard、get-schedule-page 等读模型
- **投影（projections）** — 事件溯源投影重建逻辑
- **运行时同步（runtime-sync）** — 计划节点状态同步、父子计划一致性
- **AI 模块** — 计划生成、冲突检测、时间槽建议、自动化建议

这类测试手写 adapter 对象实现 `HermesAdapter` 接口来模拟 AI 运行时，不使用 mocking 框架。

### 3. API 工作流测试（Bun Test — `apps/server/src/__tests__/api/`）

端到端验证 Hono API 路由器的完整业务流程，**每个测试文件覆盖一条完整的业务工作流**：

| 测试文件 | 覆盖内容 |
|----------|----------|
| `task-workflow.bun.test.ts` | 任务 CRUD 全流程：创建 → 列表 → 查询 → 更新 → 验证 → 删除 → 404；级联删除；负向用例（缺少必填字段、不存在的资源） |
| `plan-lifecycle-workflow.bun.test.ts` | 计划生命周期：草稿(waiting_acceptance) → 接受(accepted) → 物料化子任务；批量应用内联节点；重复接受/应用幂等性；负向用例 |
| `schedule-proposal-workflow.bun.test.ts` | 排期建议：创建提案 → 接受(生效到任务) → 拒绝(不生效) → 重复决策阻止；负向用例 |

**核心模式**：使用内联路由处理器（inline route handlers）构建独立 Hono app，避免导入完整 `api.ts` 触发的级联依赖。通过 `app.request()` 发请求，无需启动真实 HTTP 服务。

```
App (Hono)
  └── route("/api", testRouter)
        ├── GET  /tasks?workspaceId=...
        ├── POST /tasks
        ├── GET  /tasks/:taskId
        ├── PATCH /tasks/:taskId
        ├── DELETE /tasks/:taskId
        ├── GET  /tasks/:taskId/plan
        ├── POST /tasks/:taskId/plan/accept
        ├── POST /tasks/:taskId/schedule/proposals
        └── POST /schedule/proposals/decision
```

每条测试：
1. `beforeEach` 重置数据库
2. 播种初始数据
3. 通过 `app.request()` 发送 HTTP 请求
4. 仅做状态断言（status code + 响应体），不 mock Prisma

### 4. 桥接合约测试（Bun Test — `apps/server/src/__tests__/bridge/`）

验证 Hermes Bridge 的 HTTP 合约，不依赖真实网关：

| 测试文件 | 覆盖内容 |
|----------|----------|
| `hermes-bridge-contract.bun.test.ts` | 健康检查、feature 路由（generate-plan 工具约束/function_call 解析/结构化结果）、execution 路由（无工具约束/输出/SSE 流）、错误处理（401/500/超时/畸形 JSON/缺失字段/token 不泄露） |
| `hermes-live-smoke.bun.test.ts` | **默认跳过**。当设置 `CHRONA_LIVE_HERMES_TESTS=1` 时，向真实网关发请求，验证 bridge 健康状态和 plan 结构化结果 schema |

桥接测试使用 `createBridgeApp(options)` 工厂函数，注入 mock 的 `executeRequest` 来模拟网关响应，通过 `app.request()` 验证请求体构造、响应解析、错误传播。

### 5. 端到端测试（Playwright — `e2e/*.spec.ts`）

Headful 浏览器测试，覆盖关键用户路径：

- `control-plane.spec.ts` — 控制台核心交互
- `schedule.spec.ts` — 排期页面操作
- `demo.readme.spec.ts` — README 演示录制

Playwright 配置自动启动 dev server（`DATABASE_URL` + `db:seed` → `bun run dev`），测试运行在 Chromium 上。

## 共享测试工具

### `apps/server/src/__tests__/bun-test-helpers.ts`

提供跨测试文件共用的函数：

| 函数 | 用途 |
|------|------|
| `resetTestDb()` | 按外键顺序清空所有表 |
| `seedWorkspace(name)` | 创建测试工作区，返回 `{ workspaceId }` |
| `seedTask(workspaceId, overrides?)` | 创建测试任务，返回 `{ taskId }` |
| `seedDraftPlan(taskId, workspaceId, nodes?, edges?)` | 创建草稿计划（memory 表，type=`task_plan_graph_v1`），返回 `{ planId }` |
| `expectTaskExists(taskId)` | 断言任务存在于数据库 |
| `expectTaskNotFound(taskId)` | 断言任务不存在于数据库 |
| `expectPlanState(taskId, expected)` | 断言计划状态（`idle` / `waiting_acceptance` / `accepted`） |
| `runLiveHermes` | 布尔标志，当 `CHRONA_LIVE_HERMES_TESTS=1` 时为 `true` |

## Mock 策略

### 后端测试
- **不使用 mocking 框架**（无 `vi.mock` / `jest.mock`）
- 手写 adapter 对象实现 `HermesAdapter` 接口模拟 AI 运行时
- 桥接测试用 mock `executeRequest` 函数替代 `globalThis.fetch`
- `HERMES_MODE=mock` 环境变量激活 fixture-based mock adapter（从 JSON 文件加载预设响应）

### 前端测试
- `vi.mock(path, factory)` — stub 组件、hooks、工具模块
- `vi.fn().mockImplementation()` — 有状态的 mock 函数
- `globalThis.fetch` 覆盖 — 模拟 API 响应

## 环境变量

| 变量 | 作用 |
|------|------|
| `HERMES_MODE=mock` | 激活 mock AI 适配器（CI 环境） |
| `CHRONA_LIVE_HERMES_TESTS=1` | 启用 Hermes 真实网关冒烟测试 |
| `DATABASE_URL` | SQLite 数据库路径（测试自动使用临时路径） |

## CI 策略

- **CI 默认运行**：所有单元测试 + API 工作流测试 + 桥接合约测试（不需要真实网络）
- **CI 不运行**：Hermes 真实网关冒烟测试（需 `CHRONA_LIVE_HERMES_TESTS=1`）
- **CI 不运行**：Playwright E2E 浏览器测试（需另配 Chromium 环境）

## 编写新测试

### API 工作流测试

1. 在 `apps/server/src/__tests__/api/` 创建 `*.bun.test.ts` 文件
2. 导入 `bun:test` 和 `bun-test-helpers`
3. 构建内联路由（inline route handlers），避免导入 `apps/server/src/routes/api.ts`（会触发前端代码级联导入）
4. 调用业务命令函数（`createTask`、`updateTask` 等），不直接操作 Prisma
5. 通过 `app.request()` 发请求，做状态断言

### Hermes Provider 测试

1. 在 `packages/providers/hermes/src/` 下靠近实现放置 `*.bun.test.ts`
2. 优先测试 `transport/`、`execution/`、`features/` 这些 provider 内部子层
3. 对外部 gateway 调用使用 mock `fetch`
4. 验证请求体构造、响应解析、错误传播与会话语义

### 前端组件测试

1. 在组件同级或上级 `__tests__/` 目录创建 `*.test.tsx`
2. 导入 `vitest`（`describe`、`expect`、`it`、`vi`）
3. 使用 `@testing-library/react` 渲染组件
4. 需要 stub 的模块用 `vi.mock()` 处理

## 文件命名速查

| 模式 | 运行器 | 位置 |
|------|--------|------|
| `**/*.bun.test.ts` | Bun | 后端任意位置 |
| `**/*.test.ts(x)` | Vitest | 前端 `apps/web/`、部分共享包 |
| `**/*.spec.ts` | Playwright | `e2e/` |
