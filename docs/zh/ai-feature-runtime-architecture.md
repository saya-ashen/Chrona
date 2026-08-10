# Chrona AI Feature Runtime 架构与实施规范

状态：Implemented（已落地）。本文是 Chrona AI Feature Runtime 的现行架构和实施规范，描述生产代码的责任边界、持久化协议与验收要求。

## 1. 目的与统一模型

Chrona 的 AI 能力不是 prompt 或 Provider 调用的集合。每一次 AI Feature Run 都必须由以下要素完整界定：

1. 本次运行的 Objective；
2. 可见且冻结的领域 Observation；
3. 运行中允许 invoke 的领域 Action；
4. 终态中只可 propose 的领域 Action；
5. 结构化 Result、Artifact 和 Evidence；
6. 确定性的 Completion 条件；
7. 与领域投影一同提交的原子终态。

```text
AI Feature Run =
  Objective
  + frozen Observation Space
  + declared Action Space
  + Result Contract
  + deterministic Completion
  + atomic domain commit
```

Runtime 是 Engine 内部协议。HTTP、UI、Provider 和领域模块各自保持自己的边界：领域模块定义语义与提交；Runtime 管理运行状态和恢复；Provider 仅转换协议；HTTP 与 UI 仅暴露经授权的领域流程和安全进度。

## 2. 现行目录与模块责任

### 2.1 Contracts

`packages/contracts/src/ai-feature-runtime/` 是可序列化 Runtime Contract 的唯一所有者。

```text
packages/contracts/src/ai-feature-runtime/
  contracts.ts
  index.ts
```

`contracts.ts` 定义并严格校验以下内容：

- 有版本的 contract ref、Feature manifest、subject、operation、objective；
- Observation binding 与带 canonicalizer、hash、revision 的 Observation envelope；
- invoke/propose Action binding、Evidence、Artifact ref、terminal result；
- completion report、run/action DTO、稳定状态和稳定错误码；
- 有界 JSON、标识符、数量、文本、深度与字节大小限制。

`index.ts` 是该 Contract 的窄出口。Contract 不导入 Engine、Prisma 或 Provider。

### 2.2 Engine Runtime 核心

`packages/engine/src/modules/ai/feature-runtime/` 承担与存储无关的运行协议：

```text
packages/engine/src/modules/ai/feature-runtime/
  define-feature.ts
  definition-registry.ts
  feature-runner.ts
  feature-compiler.ts
  provider-capabilities.ts
  observation-registry.ts
  action-execution.ts
  action-registry.ts
  result-validator.ts
  completion-validator.ts
  run-repository.ts
  stable-json.ts
  public-progress.ts
  index.ts
```

- `define-feature.ts` 冻结 manifest，并验证 Observation、Action、Artifact resolver 与 schema 的静态对应关系。
- `feature-runner.ts` 实现 prepare/execute 生命周期、租约、Provider turn、terminal 校验和提交协调。
- `feature-compiler.ts` 将冻结的运行快照编译为 Provider-neutral request；只有 `invoke` Action 会编译为 Provider tool。
- `observation-registry.ts` 构建 seed Observation，校验 Action result Observation 的 manifest 归属、canonical JSON hash 和大小限制。
- `action-execution.ts` 先持久 claim，再执行领域 Action；完成时把 Action 与其输出 Observation 原子记录。
- `result-validator.ts` 校验 terminal envelope、output、Evidence、Artifact 与 proposed Action。
- `run-repository.ts` 定义运行、Action、CAS、lease、public read 的持久化端口。
- `public-progress.ts` 仅投影稳定 phase/message，剥离 prompt、输入、输出、tool payload、Provider 原始事件、内部引用和错误原文。

该目录经 `packages/engine/src/modules/ai/index.ts` 导出；Engine 外部调用必须使用 Engine barrel，而不 deep-import 内部模块。

### 2.3 Runtime 的具体组合与存储

`packages/engine/src/modules/ai/runtime/feature-runtime/` 将核心协议接到产品基础设施：

```text
packages/engine/src/modules/ai/runtime/feature-runtime/
  prisma-run-store.ts
  foundation-provider-runtime.ts
  runtime-service.ts
  public-query.ts
```

- `PrismaAiFeatureRunStore` 实现 run/action repository，执行唯一性、state-version CAS、owner-bound lease 和 Observation/Action 持久化。
- `commitAiFeatureRunAtomically` 由领域 committer 在自己的 Prisma transaction 中调用，使领域投影与 Runtime terminal receipt 一起提交。
- `FoundationProviderRuntime` 将 Provider Foundation 的 start、attach、resume、stream 和 tool-result 协议适配为 Runtime port。
- `runtime-service.ts` 提供仅创建持久 run、立即运行、恢复指定 run 和恢复过期 lease 的组合入口。
- `public-query.ts` 只执行 subject-scoped 的安全读取。

持久化 schema 与迁移位于 `prisma/schema.prisma` 和 `prisma/migrations/20260729000000_add_ai_feature_runtime_persistence/migration.sql`，其中 Runtime 表为 `AiFeatureRun`、`AiFeatureRunObservation` 与 `AiFeatureRunAction`。`TaskPlan` 和 `GoalReviewProposal` 记录可空的 `aiFeatureRunId` provenance；历史记录保留为空，不伪造来源。`TaskPlanGenerationHead` 保存按 Task/工作块 scope 的 baseline、current pointer、generation version 和 state version。

### 2.4 领域 Feature 的所有权

Goal Review 位于 `packages/engine/src/modules/goals/ai/goal.review.ts`。它拥有：冻结 Goal/Task snapshot、Goal Review 的 output/proposed-action 语义、完成校验、proposal 投影和 proposal/run 的原子提交。

Task Plan Generate 位于 `packages/engine/src/modules/plans/ai/task.plan.generate.ts`，其运行入口位于 `task-plan-generate-run.ts`，持久化 committer 位于 `task-plan-generation-persistence.ts`。它拥有：冻结 Task/head Observation、`PlanBlueprint` 的结构校验、单一 plan proposal 语义、baseline/head CAS 与 draft plan 的原子物化。

`start-task-plan-generation.ts` 先持久创建 run 并原子取得 generation head，再交由 SSE 流恢复或执行。`generate-task-plan-manual-stream.ts` 不拥有 Plan 持久化；它只把 Runtime 的领域收据映射为产品 SSE。

## 3. Feature Definition 与不可变运行快照

一个 Feature 以 `defineAiFeature` 定义。Definition 包含 manifest、输入/输出 schema、subject resolver、Objective builder、instructions builder、Observation builder、Action declaration、Artifact resolver、completion validator 和可选领域 committer。

Definition 不是传给 Provider 的任意代码对象。创建 run 时 Runtime 解析输入、subject、workspace 和 operation，随后冻结：

- 版本化 manifest 及其 content hash；
- canonical 输入及 input hash；
- resolved subject；
- Objective；
- 后续持久化的 Observation、terminal candidate、result、completion 与 commit receipt。

运行一旦创建，继续执行和重放只读取已保存的数据；不得用当前数据库状态替换 frozen input、manifest 或 Observation。

### 3.1 start-or-attach 与 execute

`startOrAttachAiFeatureRun` 只做确定性持久化交接：输入和 subject 校验、subject resolution、operation 校验、冻结 manifest/input/objective，以及按幂等键 create-or-read 一个 `queued` run。它不调用 Provider，也不执行领域副作用。

`executeAiFeatureRunById` 取得已持久 run 后：claim lease、准备 seed Observation、启动或恢复 Provider、处理 invoke Action、校验终态、运行 completion validator，并通过 Feature 的 committer 写入领域结果。`runAiFeature` 只是以上两个步骤的便捷组合；需要 SSE 交接的领域流程应先 start-or-attach，再在自己的执行时机调用 execute/resume。

## 4. 状态机、CAS 与 lease

运行状态为：

```text
queued
  -> preparing_observations
  -> starting_provider
  -> running
  -> validating
  -> committing_result
  -> completed | needs_input | cannot_complete | failed | cancelled
```

所有可变更 transition 都以 `stateVersion` compare-and-swap 和 `leaseOwner` 约束。claim 仅接受无 owner 或 lease 已过期的 run；claim、renew、release 都递增 state version。attempt、heartbeat 与 lease expiry 共同支持 worker takeover。

恢复 worker 周期性选择 `queued`、已 release（无 lease）或 lease 已过期的 active run，并以相同持久 run 重新执行；进程启动时立即执行首轮扫描。新 `queued` run 先经过短暂的领域 pointer handoff grace，避免 prepare 与 subject/head CAS 之间被 worker 抢占；grace 后遗留 run 仍会被恢复并由领域 committer 证明或拒绝。恢复不得重新生成 seed Observation，不得改变 operation identity，也不得绕过原有 terminal candidate 或 commit 状态。

运行唯一身份为：

```text
workspaceId + featureId + subjectType + subjectId + operationKind + operationId
```

同一身份只有在 frozen input hash 与 manifest hash 都一致时才能返回已有 run；否则必须返回 `idempotency_conflict`。后续 retry/answer 使用新的 operation identity，并由领域记录其与前一 run 的谱系；Provider 的 run reference 只用于恢复与 provenance，不是 Chrona 的幂等键。

## 5. Observation、Evidence 与 Action

### 5.1 Observation

seed Observation 在 Provider 启动前构建并持久化。每一项包含类型/版本、稳定 key、revision、观察时间、canonicalizer、hash algorithm、content hash 和有界 JSON data。Runtime 只接受 manifest 声明且符合 `chrona.stable-json.v1` 与 SHA-256 完整性校验的 Observation。

Observation 不暴露原始数据库 row、secret、prompt、思维链或 Provider raw event。新 revision 追加新 Observation；旧 Observation 不覆盖。重放使用已保存 payload，不重新查询“当前最新”领域状态。

Evidence 只能引用本 run 已冻结的 Observation。Artifact 必须由领域 resolver 校验 workspace、subject/provenance、类型与 hash；模型提供的展示元数据不覆盖存储元数据。

### 5.2 Action

Action 的 mode 必须明确：

- `invoke`：Provider 在运行中请求的、由 Engine 执行的领域能力；
- `propose`：terminal result 中的建议，持久化后仍不执行。

on-demand Observation 与 action-result Observation 都必须绑定已声明的 invoke Action。未声明 Action、错误版本、错误 input schema、未绑定 Observation 或超出 `maxCalls` 的请求一律拒绝。

每个 invoke 使用 `runId:invoke:callId` 作为 execution key；持久层还以 `runId + mode + callId` 唯一约束隔离 Action 记录。Runtime 在任何副作用前 claim Action。重复完成的同 call 直接返回已保存 output Observation；同 call 携带不同输入是冲突。

领域 Action 必须采用以下一种可恢复语义：

1. 与 Action 完成和输出 Observation 处于同一数据库 transaction；
2. 领域 use case 原生接收 execution key，持久化唯一幂等结果，并可据此重建 Observation；
3. 纯只读、可安全重跑。

外部副作用只有在目标系统同时支持幂等键与 outcome lookup 时才可注册为 invoke。结果无法确认时必须停在可恢复状态并报告 `action_outcome_unknown`，不得猜测成功、重复副作用或把 run 标记为完成。

## 6. Provider operation identity、恢复与 tool bridge

Provider 编译输入仅包含 instructions、Objective、冻结 Observation、terminal contract、invoke tool schema 和稳定 `clientOperationId`。Provider 不读取 Prisma，不拥有领域 allowlist，也不执行领域写入。

`clientOperationId` 等于持久 run id。Provider adapter 必须先声明并在执行前验证：

- client-operation identity 的幂等 start/attach；
- 持久 provider resume ref 的恢复能力；
- Engine-managed action result bridge 的能力。

启动使用 start-or-attach；持久 provider run/ref 后才推进为 `running`。恢复使用 `providerRunRef` 与 `providerResumeRef` 查询既有运行，并在已完成时读取同一 terminal payload。缺少恢复引用或 provider 明确不具备对应能力时，Runtime 以稳定错误终止，而不启动不确定的第二次 Provider 工作。

Provider stream 的 pending tool call 只能匹配已编译的 invoke Action。Runtime 暂停该 turn，持久 claim 并执行领域 Action，原子保存 output Observation，随后通过 `submitActionResult` 把该 Observation 交回同一 Provider run。bridge 中断后恢复必须复用持久 Action output，绝不重新执行已完成副作用。

terminal structured output 与工具调用是不同概念：终态结果始终先进入 Runtime validation；propose Action 永远不被编译为 Provider tool，也永远不在 completion transaction 中执行。

## 7. Result、Completion 与领域原子 committer

terminal result 仅可为 `completed`、`needs_input` 或 `cannot_complete`。Runtime 先验证 envelope、严格 output schema、Evidence、Artifact、proposed Action 和 terminal 分支的边界条件。

`completed` 还必须通过 Feature-specific completion validator。validator 只可做确定性计算或读取 frozen run 数据；不得读取当前最新业务状态、调用 Provider、执行 Action、写 event 或更新 projection。

`needs_input` 和 `cannot_complete` 必须通过各自的结构校验，不能夹带 Artifact 或 proposed Action。Provider timeout、协议错误、无效 JSON、无效 Evidence、非法 completion 或 committer 失败均是 `failed`，不能伪装为业务性无法完成。

当 Feature 需要产品投影时，其 `commitResult` 是领域所有的 atomic committer。committer 在一个本地 transaction 中：

1. 对 frozen baseline、领域 projection 和 run state 执行 CAS；
2. 写入领域结果和必要的 read model；
3. 调用 `commitAiFeatureRunAtomically` 写入 terminal result、completion、proposed Action、receipt 和 finished time。

如果 transaction 失败，领域投影和 Runtime terminal receipt 都不得部分提交。重试已验证 candidate 时只重试 committer；不重新请求 Provider。propose Action 保留给用户或明确领域命令处理，不能作为 committer 的隐式副作用。

## 8. Goal Review 语义

Goal Review 的 subject 是 Goal Review proposal，snapshot 包含 `initial` 或 `progress` mode 的冻结 Goal/Task 上下文。生成 run 不修改 Goal、Task、guidance 或 schedule。

完成结果投影为 `Ready` 和可显式 apply/reject 的 proposal items；`needs_input` 投影为 `NeedsInput` 并保存有界问题、部分输出和 answer lineage；`cannot_complete` 投影为 `CannotComplete` 并保存稳定 reason/missing Observation。Provider 或 Runtime 异常才投影为 `Failed`。

answer 与 retry 都要求 proposal state version，并创建具备新 operation identity 的后续 run。Goal Review committer 以 proposal 的 `Generating` 状态、state version 和 `aiFeatureRunId` 为条件更新 proposal；随后在同一 transaction 原子写入 Runtime terminal receipt。应用 proposal 时仍执行领域 revision/dependency stale check，生成时的 Observation 不能静默覆盖当前领域数据。

## 9. Task Plan Generate 语义

Task Plan Generate 的 Feature id 为 `task.plan.generate`。其 subject 是 Task；operation kind 为 `generate`；生成 session 的 generation id 是该领域命令传入的 operation identity。

Feature 仅使用两个冻结 seed Observation：Task 与当前 `TaskPlanGenerationHead`。Result 必须是一个 `PlanBlueprint`，并且恰好携带一个与 blueprint 完全一致的 plan proposal。completion validator 同时验证输入、DAG、节点配置、可达性、proposal 一致性和 Observation 数量。

生成、accept 和 execute 是三个独立动作：

- 生成只创建 draft plan 与 generation receipt；
- accept 是显式领域命令；
- execute 也是独立的显式领域命令。

生成启动时先将 `TaskPlanGenerationHead` 原子链接到 queued run。提交时 `commitTaskPlanGeneration` 对 Task identity、scope、baseline/current plan pointer、revision、hash、head state version 和 current run id 做 CAS；成功后在同一 transaction 物化 draft、更新 head、记录 Runtime terminal receipt。旧 baseline 不能覆盖并发 edit、accept、regenerate 或执行状态变化；此类冲突稳定返回 `stale_plan_baseline`。

SSE 以领域 generation session 为边界。流在 terminal 后只读取 atomic commit receipt（plan id 与 head state version），不直接物化 plan，也不把 Provider 事件当作领域完成。

## 10. API、UI 与安全 progress

HTTP 保留领域专用 command 与查询边界。路由负责 workspace/subject 授权、解析领域 resource，并把已授权的 subject scope 传入 Engine；它们不暴露通用 Feature 执行入口。

UI 读取 Goal proposal、Task plan generation session、Task plan/head 等领域 read model，不解释任意 Runtime JSON，也不执行 AI 生成的 UI control。任何 proposed Action 都必须映射到产品定义的组件和显式领域 command。

公开进度读取必须同时约束 workspace、Feature ref、subject type/id（以及适用时 subject revision）和 run id。`readAiFeatureRunPublic` 只返回 status、state version、attempt、时间与稳定 error code/message key。`AiFeaturePublicProgress` 只返回 phase/message。不得通过仅持有 run 或外部关联标识的查询暴露跨 subject 状态，更不得返回 manifest、Objective、Observation、Action、terminal candidate、result、Provider ref、prompt、payload 或原始错误。

所有新状态、错误码、问题和 proposal/action 名称都必须具有中英文产品文案。Provider 原始错误不是默认 UI 文案。

## 11. 已删除且禁止的旧模式

以下项目在 AI Feature Runtime 中不存在，且禁止重新引入：

- 预备 Feature payload 类型、Feature-specific runtime switch 或由 Provider request 直接驱动领域提交；
- facade、dual path、兼容 alias、迁移期 mapping 或 legacy 正向保留层；
- 由工具事件立即物化 Task Plan 的路径；
- 将 terminal transport tool 视为 invoke Action 的路径；
- 通用的、仅按外部关联标识查询的进度接口；
- 把 Provider 原始事件、内部运行标识、prompt、输出或 tool payload 投影到公开 SSE/UI；
- 在 completion validator 中读取实时领域状态或执行副作用；
- 生成完成后自动 accept、apply 或 execute。


## 12. 验证矩阵

以下矩阵规定改动 AI Feature Runtime 时必须覆盖的验证面；本文不声明任何项目级命令已执行。

| 范围 | 必须验证的行为 |
| --- | --- |
| Contracts | manifest/ref/version、严格 JSON、terminal 三分支、Evidence pointer、Artifact/action/Observation binding、未知字段和容量限制 |
| Definition | 重复 ref、缺失 builder/executor/resolver、on-demand 无 invoke、propose 被编译为 tool、schema/version 不匹配 |
| Observation | canonical hash、revision、大小限制、seed/action-result 来源、不可见敏感数据、replay 不读当前 DB |
| Run | operation 幂等、input/manifest hash 冲突、state-version CAS、lease claim/renew/expiry、prepare 与 execute 的 crash window |
| Provider | client operation attach、持久 run lookup、resume ref、结构化 terminal、未声明 tool 拒绝、tool-result bridge、capability mismatch |
| Action | claim-before-side-effect、execution key 去重、completed action replay、原子 output Observation、outcome unknown 停止、三种 execution semantics |
| Completion/commit | terminal candidate 重校验、completion 纯性、领域投影与 run receipt 同事务、commit retry 不重调 Provider |
| Goal Review | initial/progress、failure 不破坏 Goal、needs-input/answer、cannot-complete/retry、Evidence、proposal CAS、stale apply 与中英文文案 |
| Task Plan | blueprint/DAG、冻结 head、generation head CAS、draft 单写入、并发 edit/accept/regenerate/execute 导致 stale baseline、生成/accept/execute 分离 |
| Public boundary | workspace/Feature/subject scoped 授权、公开字段 allowlist、无 payload/ref/prompt/raw event 泄漏、领域 SSE 映射 |

## 13. 代码审查清单

每个新增或修改的 AI Feature 都必须能明确回答：

1. Objective 是否是本次运行的具体目标？
2. Observation 是否版本化、冻结、有界并可重放？
3. 每个 on-demand 数据是否有已声明的 invoke Action？
4. invoke 与 propose 是否在编译、持久化、UI 和副作用上严格分离？
5. Action 是否复用领域 use case，并以 execution key 保证恢复语义？
6. Action output 是否作为持久 Observation 原子写入？
7. Evidence、Artifact、Result 和 proposed Action 是否都经过 manifest/provenance 校验？
8. completion 是否确定性且只依赖 frozen run 数据？
9. committer 是否同时保护领域 baseline/head 和 Runtime state version？
10. Provider 是否只做协议转换、身份恢复和受控 tool bridge？
11. public progress 是否已按 workspace、Feature、subject 和 run 授权，并且只返回 allowlist 字段？
12. 生成、apply/accept 与 execute 是否仍为明确分离的领域动作？

## 14. 相关标准

外部规范只作为设计参考，不替代 Chrona 的领域语义：

- [Gymnasium Env API](https://gymnasium.farama.org/api/env/)：Observation、Action 与终止条件；
- [Model Context Protocol server primitives](https://modelcontextprotocol.io/specification/2025-11-25/server)：Prompts、Resources、Tools；
- [OpenAI Agents](https://openai.github.io/openai-agents-python/agents/)：instructions、tools 与 structured output；
- [A2A specification](https://a2a-protocol.org/latest/specification/)：Task、Message、Artifact 与 lifecycle；
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api)：State、Node、Edge 与 schema。

Chrona 拥有完整的产品级组合语义：版本化领域 Observation、可控 invoke/propose Action、terminal Result、Evidence、确定性 Completion、可恢复 Provider 运行和领域原子提交。所有外部 AI 系统均是 adapter。
