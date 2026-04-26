# OpenClaw / Runtime / AI Features Architecture

## 新分层总览

本次重构把代码按职责整理为四层：

### 1. Runtime core

位置：`packages/common/runtime-core`

职责：

- 提供 backend-agnostic runtime contracts
- 提供 runtime task config spec/path/validation helpers
- 不包含任何 OpenClaw-specific transport/protocol/orchestration 代码

主要文件：

- `packages/common/runtime-core/src/types.ts`
- `packages/common/runtime-core/src/config-spec.ts`
- `packages/common/runtime-core/src/index.ts`

---

### 2. OpenClaw integration

位置：`packages/providers/openclaw/integration`

职责：

- 封装所有 OpenClaw-specific 实现
- 描述 bridge 协议、structured result、runtime orchestration、task config
- 对上暴露 OpenClaw runtime adapter 和 feature-side structured bridge integration

子层结构：

- `src/transport/*`
  - `bridge-client.ts`
  - `bridge-types.ts`
- `src/runtime/*`
  - `adapter.ts`
  - `orchestrator.ts`
  - `runtime-client.ts`
  - `mock-adapter.ts`
- `src/protocol/*`
  - `types.ts`
  - `structured-result.ts`
- `src/config/*`
  - `config.ts`
  - `device-identity.ts`
  - `evaluate-gate.ts`
  - `probe.ts`
- `src/openclaw/*`
  - 兼容旧路径的 re-export facade

### 关于 `bridge-client` 的职责说明

`packages/providers/openclaw/integration/src/transport/bridge-client.ts` 不只是“HTTP client”。

它当前还保留一层 OpenClaw bridge adapter-side compatibility state：

- session messages cache
- last run snapshot cache
- last structured result cache

这样做的原因是：

- OpenClaw bridge 本身是 blocking HTTP bridge
- 上层 runtime API 需要 `readHistory / waitForRun / getStructuredResult` 这类 runtime-style 查询能力
- 这些状态是 OpenClaw integration 的适配逻辑，不属于 runtime-core 的通用抽象

因此本次不把它上移到 runtime-core，而是在 integration 层明确标注职责。

---

### 3. AI features

位置：`packages/common/ai-features`

职责：

- 承载同步生成型 AI feature
- suggestion / generatePlan / conflicts / timeslots / chat
- 包含 feature-level prompt building、schema normalization、provider dispatch、streaming

结构：

- `src/core/*`
  - types / prompts / providers / structured / streaming
- `src/features/index.ts`
  - feature implementations
- `src/index.ts`
  - canonical barrel

边界规则：

- AI features 可以依赖 OpenClaw integration 提供的 structured result / bridge response types
- AI features 不依赖 runtime task lifecycle orchestration
- suggestion / plan 等 structured generation 不需要绑定完整 runtime lifecycle

---

### 4. API / service layer

位置：应用内 `src/modules/*` 与 `src/app/api/*`

职责：

- `src/modules/ai/ai-service.ts` 作为 AI feature service entry
- runtime/task/session API 继续走 task execution / commands / routes
- app 内旧模块路径保留为 facade，减少一次性迁移风险

---

## 两条主链路

### A. suggestion / plan / conflicts / timeslots / chat

走法：

`API / ai-service`
→ `@chrona/ai-features`
→ provider dispatch
→ OpenClaw bridge 或 LLM provider

说明：

- 这是同步生成型 feature 路径
- 不依赖完整 runtime session lifecycle
- 如果使用 OpenClaw，只利用其 structured dispatch / business tool / structured result 能力

---

### B. runtime / task / session / approval / resume

走法：

`task routes / commands / runtime-sync`
→ `@chrona/openclaw-integration` runtime adapter
→ OpenClaw bridge client
→ OpenClaw bridge server
→ OpenClaw CLI

说明：

- 这是任务执行型 runtime 路径
- 由 runtime adapter / orchestrator 承载 session/run/approval lifecycle
- 与 feature-layer structured generation 明确分开

---

## Bridge server 与 bridge client 的关系

### Bridge server

位置：`packages/providers/openclaw/bridge`

职责：

- 独立 HTTP service
- 把 `openclaw agent --local --json` 暴露为 `/v1/chat`, `/v1/chat/stream`, `/v1/health`
- 负责 transcript/tool call/structured result 提取

### Bridge client

位置：`packages/providers/openclaw/integration/src/transport/bridge-client.ts`

职责：

- 调用 bridge server
- 把 bridge response 适配成 runtime-style API
- 维护有限的 integration-side compatibility cache

一句话关系：

- `openclaw-bridge` 是服务端桥
- `openclaw-integration/transport/bridge-client` 是客户端桥接适配器

---

## 兼容层说明

为了保守重构，本次历史上保留过以下 facade；在当前 clean-break 状态下它们应被删除：

### 1. `@chrona/runtime-client`

现在是 compatibility facade：

- 根导出 -> `@chrona/runtime-core`
- `openclaw/*` -> `@chrona/openclaw-integration/openclaw/*`

### 2. `src/modules/openclaw/*`

现在是 app 内兼容 re-export。

### 3. `src/modules/task-execution/types.ts` / `config-spec.ts`

现在转发到 `@chrona/runtime-core`。

### 4. `src/modules/ai/client/*`

现在转发到 `@chrona/ai-features`。

这样做的目的：

- 不打断现有 app 代码
- 保留功能
- 先把 canonical source of truth 搬到职责清晰的新包

---

## 如果后续接入别的 backend，应该接在哪一层

### 如果是新的任务执行 backend

接在：`runtime-core` 之上的新 integration package

例如：

- `packages/foo-runtime-integration`

它应当：

- 实现 `RuntimeExecutionAdapter`
- 提供自己的 protocol / transport / runtime orchestration
- 不污染 `runtime-core`

### 如果是新的同步生成 backend

接在：

- `packages/common/ai-features/src/core/providers.ts`
- 或提取为新的 feature provider integration package

原则：

- feature provider 不应依赖 runtime lifecycle，除非该 backend 本质就是任务执行型 runtime

---

## 当前设计取舍

1. 没有删除旧入口，只把旧入口变成 facade
2. 没有重写 OpenClaw bridge / prompt / schema / API payload
3. 没有强行抽走 `bridge-client` 的 session cache，而是把它明确归类为 integration-side compatibility state
4. 没有让 suggestion / plan 依赖 runtime orchestrator
5. 通过 canonical package + compatibility facade 的方式降低重构风险

---

## 现在回答几个关键问题

### 哪些是 OpenClaw integration？

`packages/providers/openclaw/integration`

### 哪些是 runtime core？

`packages/common/runtime-core`

### 哪些是 AI features？

`packages/common/ai-features`

### 哪些是 bridge service？

`packages/providers/openclaw/bridge`

### suggestion / plan 走哪条链？

`ai-service -> ai-features -> provider/bridge`

### runtime/task/session/approval 走哪条链？

`task routes/commands -> openclaw-integration runtime adapter/orchestrator -> bridge client -> bridge server`

