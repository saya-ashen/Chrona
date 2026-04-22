# OpenClaw / Runtime / AI Features Refactor Plan

## Goal

在不改产品语义、不重写业务逻辑的前提下，把当前代码重组为更清楚的四层：

1. OpenClaw integration / transport
2. Runtime core
3. AI features
4. API / service layer

核心原则：先搬运和收敛职责，再通过兼容导出降低改动风险。

---

## 当前问题摘要

### 1. `packages/runtime-client` 命名失真

当前 `runtime-client` 实际同时承载了：

- runtime core contracts（`src/types.ts`, `src/config-spec.ts`）
- OpenClaw bridge transport（`openclaw/bridge-client.ts`, `bridge-types.ts`）
- OpenClaw-specific protocol/result parsing（`structured-result.ts`, `types.ts`）
- runtime orchestration（`adapter.ts`, `orchestrator.ts`）
- probe / gate / device identity

也就是说它并不是“纯 client”。

### 2. OpenClaw transport 与 runtime state 混杂

`packages/runtime-client/src/openclaw/bridge-client.ts` 里除了 HTTP bridge 调用，还维护了：

- in-memory `sessions` map
- pseudo session history
- last run snapshot cache
- structured result cache

这些不是纯 transport，需要在架构上明确标记为“integration-side runtime state adapter cache”，避免继续被误解成简单 HTTP client。

### 3. Bridge server / bridge client 上下游关系不直观

当前：

- `packages/openclaw-bridge/src/server.ts` 是 HTTP bridge server
- `packages/runtime-client/src/openclaw/bridge-client.ts` 是它的调用端

但目录上它们分属两个语义不清的区域，读代码时不容易一眼看出：

- bridge server 是独立服务
- bridge client 是 OpenClaw integration 的 transport adapter

### 4. AI feature 路径与 runtime 路径没有被显式区分

`suggestion / generatePlan / conflicts / timeslots / chat` 在 `src/modules/ai/client/*` 中实现，但它们又直接依赖 `packages/runtime-client/src/openclaw/*` 的 OpenClaw bridge/result types。

结果是：

- feature 层没有独立边界
- OpenClaw integration 细节渗透到 feature 层
- 同步 structured generation 与任务运行型 runtime 概念容易混淆

### 5. API/service 层入口已经有雏形，但底层分层不清

`src/modules/ai/ai-service.ts` 已经基本像 feature service 层入口。
`src/modules/task-execution/*` + `src/modules/openclaw/*` 已经基本像 runtime/task execution 路径。

问题不是“没有入口”，而是底层包结构没有把边界表达清楚。

---

## 目标分层设计

### A. `packages/runtime-core`

职责：纯 runtime 抽象与无后端特定逻辑的通用 config spec 工具。

包含：

- `types.ts`
  - `RuntimeInput`
  - `RuntimeExecutionAdapter`
  - `RuntimeAdapterDefinition`
  - runtime task config types
- `config-spec.ts`
  - runtime task config path helpers / validation helpers
- `index.ts`

不包含：

- OpenClaw-specific protocol
- bridge transport
- orchestrator implementation
- structured result parsing

### B. `packages/openclaw-integration`

职责：所有 OpenClaw-specific 集成代码。

建议子层：

- `src/transport/*`
  - `bridge-client.ts`
  - `bridge-types.ts`
- `src/runtime/*`
  - `adapter.ts`
  - `orchestrator.ts`
  - `runtime-client.ts`（保留接口名，但文档说明这是 OpenClaw runtime session/run client contract）
- `src/protocol/*`
  - `types.ts`
  - `structured-result.ts`
- `src/config/*`
  - `config.ts`
  - `device-identity.ts`
  - `evaluate-gate.ts`
  - `probe.ts`
- `src/index.ts`

并明确说明：

- `bridge-client.ts` 不是纯 transport-only client；它还承载 bridge-side compatibility cache，用于把 blocking bridge response 映射为 runtime-style session/history API。
- 这部分 cache 目前保留在 integration 层，不上移到 runtime-core，因为它是 OpenClaw bridge 适配逻辑的一部分，而不是通用 runtime 抽象。

### C. `packages/ai-features`

职责：同步生成型 AI feature 层。

建议子层：

- `src/core/*`
  - `types.ts`
  - `prompts.ts`
  - `providers.ts`
  - `structured.ts`
  - `streaming.ts`
- `src/features/*`
  - `index.ts`（导出 suggest / generatePlan / conflicts / timeslots / chat）
- `src/index.ts`

边界：

- AI features 允许依赖 OpenClaw integration 的 structured/bridge response types
- 但不依赖 runtime orchestrator / executeTask lifecycle
- suggestion / plan 等同步 structured dispatch 走 feature 层
- run/session/approval 走 runtime 层

### D. `packages/openclaw-bridge`

职责保持不变：

- 独立 HTTP bridge service
- 把 `openclaw agent --local --json` 暴露为 HTTP API

但依赖改为：

- `@chrona/openclaw-integration` 提供 shared bridge/protocol helpers

### E. app/service/api 层

保留现有结构，重点只调整 import：

- `src/modules/ai/ai-service.ts` -> 依赖 `@chrona/ai-features`
- runtime/task execution 路径 -> 依赖 `@chrona/openclaw-integration` 与 `@chrona/runtime-core`
- `src/modules/openclaw/*` 与 `src/modules/task-execution/*` 继续保留为兼容 re-export facade

---

## 目录迁移计划

### 新增包

- `packages/runtime-core`
- `packages/openclaw-integration`
- `packages/ai-features`

### 兼容策略

保留现有：

- `packages/runtime-client`
- `src/modules/openclaw/*`
- `src/modules/task-execution/types.ts`
- `src/modules/task-execution/config-spec.ts`
- `src/modules/ai/client/*`
- `src/modules/ai/ai-client.ts`

但把它们改成清晰的 compatibility facade：

- `packages/runtime-client` -> facade，转发到 `runtime-core` + `openclaw-integration`
- `src/modules/openclaw/*` -> app-layer compatibility re-export
- `src/modules/ai/client/*` -> app-layer compatibility re-export / barrel

这样先保功能，再逐步淘汰旧入口。

---

## 计划中的文件移动 / 重命名 / 拆分

### 1. 从 `packages/runtime-client` 拆出 runtime core

复制并迁移：

- `packages/runtime-client/src/types.ts` -> `packages/runtime-core/src/types.ts`
- `packages/runtime-client/src/config-spec.ts` -> `packages/runtime-core/src/config-spec.ts`
- `packages/runtime-client/src/index.ts` -> 改为 facade
- `packages/runtime-core/src/index.ts` -> 新建 canonical export

### 2. 把 OpenClaw-specific 代码收敛到 `packages/openclaw-integration`

迁移：

- `packages/runtime-client/src/openclaw/*` -> `packages/openclaw-integration/src/*`

并按职责重新组织为：

- `transport/bridge-client.ts`
- `transport/bridge-types.ts`
- `runtime/adapter.ts`
- `runtime/orchestrator.ts`
- `runtime/runtime-client.ts`
- `protocol/types.ts`
- `protocol/structured-result.ts`
- `config/config.ts`
- `config/device-identity.ts`
- `config/evaluate-gate.ts`
- `config/probe.ts`

同时：

- `packages/openclaw-integration/src/index.ts` 提供统一出口
- `packages/openclaw-integration/src/openclaw/*` 提供旧路径兼容 re-export，避免大面积 import 断裂

### 3. 把 AI feature 代码收敛到 `packages/ai-features`

迁移：

- `src/modules/ai/client/types.ts`
- `src/modules/ai/client/prompts.ts`
- `src/modules/ai/client/providers.ts`
- `src/modules/ai/client/structured.ts`
- `src/modules/ai/client/streaming.ts`
- `src/modules/ai/client/features.ts`
- `src/modules/ai/client/index.ts`

到：

- `packages/ai-features/src/core/*`
- `packages/ai-features/src/features/index.ts`
- `packages/ai-features/src/index.ts`

然后把原 `src/modules/ai/client/*` 改为 facade。

### 4. 调整 bridge server 依赖

- `packages/openclaw-bridge/src/server.ts`
  - 从 `@chrona/runtime-client/openclaw/*` 改为 `@chrona/openclaw-integration/*`

### 5. 调整 service / app 层依赖

- `src/modules/ai/ai-service.ts` -> `@chrona/ai-features`
- `src/modules/task-execution/registry.ts` -> `@chrona/runtime-core`
- runtime execution factories / commands 保持 `@/modules/openclaw/*` facade 不动或小改

---

## 本次保留兼容导出

### 保留 `@chrona/runtime-client`

它不再是源码主入口，而是兼容层：

- 根导出 -> `@chrona/runtime-core`
- `./openclaw` 及其子路径 -> `@chrona/openclaw-integration`

### 保留 `src/modules/openclaw/*`

原因：

- app 内已有大量 `@/modules/openclaw/*` 引用
- 一次性清空收益不大，风险较高

### 保留 `src/modules/ai/client/*`

原因：

- app/service/tests 已经引用
- 先改成 facade，后续再决定是否完全淘汰

---

## 本次暂不改的点

1. 不重写 prompt 内容
2. 不改 feature schema
3. 不改 runtime API 返回格式
4. 不改 OpenClaw bridge HTTP endpoint 语义
5. 不删除旧文件夹，只把旧层变成兼容外壳
6. 不把 bridge-client 的 session cache 强行抽成通用 runtime cache
   - 本次仅明确它属于 OpenClaw integration adapter-side compatibility state

---

## 最小验证计划

1. TypeScript compile / `tsc --noEmit`
2. 运行与本次改动最相关的测试：
   - OpenClaw adapter / orchestrator / structured-result tests
   - AI client structured / streaming tests
   - bridge server tests
3. 若全量测试过重，则至少完成：
   - targeted vitest
   - import/export path smoke check

---

## 预期结果

重构完成后，读代码的人可以快速回答：

- OpenClaw bridge server 在哪？ -> `packages/openclaw-bridge`
- OpenClaw bridge client / protocol / structured result 在哪？ -> `packages/openclaw-integration`
- runtime core contracts 在哪？ -> `packages/runtime-core`
- suggestion / plan / conflicts / timeslots / chat 在哪？ -> `packages/ai-features`
- API/service 怎么调用？ -> `src/modules/ai/ai-service.ts` / task runtime routes

应用代码已迁移到 canonical package 路径；兼容层现在只剩待删除的历史壳。

