# Plan-Execution 内核重构 — 进度与续作手册

> 续作入口文档。下次运行先读这份，再看 `/home/saya/.claude/plans/bright-squishing-forest.md`(原始已批准方案)。

## 目标(回顾)

把 `packages/engine/src/modules/plan-execution`(原 8100 行 / 50 文件)的「双写者 + 双事实来源 + 三套命令词汇 + 32 处 `as unknown as` + 5 个复制入口 + setTimeout 续跑」结构债,重构为**单一入口命令内核**。已批准为**破坏性重构**:数据库 drop 重建、允许改 `@chrona/graph-runtime`、重设计 API。

## 分支与提交状态

- 分支:`refactor/plan-execution-kernel`(基于 `main`)。
- 已提交:`286b669 refactor(plan-execution): unify types + add single-writer kernel (foundation)` —— Stage 1–4 的地基,**纯增量、全绿**。
- **未提交(工作区)**:Stage 5 的原子替换 + Stage 8 聚焦回归修复(见下「当前工作区改动」)。当前 `plan-execution` 套件 **79 通过 / 0 失败**;本次未重跑全仓 `tsc`。
- 注意:`CLAUDE.md` 被外部 GitNexus 工具清空(非本次重构所为),一直未纳入提交,保持原样勿动。

## 已完成并验证(Stage 1–4,已提交)

1. **类型统一**:`@chrona/graph-runtime/src/types/*` 改为 re-export `@chrona/contracts/ai` 的领域类型(`PlanGraph/NodeAttempt/NodeResult/EffectivePlanGraph/ExecutionContextSnapshot`/layers…),仅保留 runtime 本地细化(`EdgeType` 族、`RuntimeProgressStatus` 逻辑、精简版 `CompiledPlan`)。graph-runtime 新增对 `@chrona/contracts` 的依赖。验证:全仓 `tsc` 0 错误;graph-runtime 37 测试通过。
2. **统一命令词汇**:新增 `packages/contracts/src/plan-runtime/execution-command.ts`(`ExecutionCommand` / `SubmittedNodeResult` / `ExecutionCommandContext` / `ExecutionCommandEnvelope`),已在 `plan-runtime/index.ts` 导出。
3. **单写者内核** `packages/engine/src/modules/plan-execution/kernel/`:
   - `execute-command.ts` —— 唯一入口 `executeCommand(envelope)`:装载→映射命令→graph dispatch→持久化→finalize→响应。
   - `graph-callbacks.ts` —— 内核 graph 回调(executeNode 复用执行器注册表 / onEvent 标记活动节点 / onStateChange 推送观察者)。
   - `kernel-types.ts` —— `EngineRuntimeContext` / `PlanExecutionObserver` / `ExecutionConflictError`。
   - `sync-runtime-result.ts` —— 带外 provider 结果 = `submit_node_result` 普通命令。
   - `plan-run-store.ts` 新增 `savePlanRunGuarded`(基于既有 `executionEpoch` 列的乐观并发写)。
4. **执行器**:无需移植,内核经 `runtime/node-executor-registry.ts` 复用现有执行器(统一类型下)。验证:`kernel/execute-command.smoke.bun.test.ts` 3 测试通过(含 duplicate-start 单次 attempt、serial 串行推进)。

## 当前工作区改动(Stage 5 原子替换 + Stage 8 部分修复,未提交)

**策略**:不重命名 40 个调用方;保留 `task-plan-execution.ts` 各导出函数签名,**把函数体改成 `executeCommand` 的薄翻译层**,删除双写者内部实现。结果:facade、~40 调用方、checkpoint-transition 全部无需改动,内核成为唯一执行路径。

已改写:
- `task-plan-execution.ts` —— 现为薄翻译层(`startPlanExecution`/`continuePlanExecution`/`resumePlanExecutionWithApproval`/`dispatchExecutionAction`/`submitCheckpointAction` 均 → `executeCommand`;`commandForExecutionAction` 做 `ExecutionActionInput → ExecutionCommand` 映射)。保留 `submitCheckpointAction` 主体 + 注入翻译层委托。`complete_manual_node` 会把 provider `sessionId` 写入 `SubmittedNodeResult.evidence`;`dispatchExecutionAction` 会转发 `commandContext.actor/origin` 给内核事件 envelope。
- `use-cases/submit-terminal-node-result.ts` —— 去掉 `setTimeout` fire-and-forget 续跑;`submit_node_output` 仍走 `submitNodeOutput`,终态走 `dispatchExecutionAction`。provider 终态工具提交时强制 `continueExecution:false`,避免嵌套命令直接启动下游节点,由外层 graph loop 接管续跑。
- `use-cases/sync-runtime-result/reconcile-stale-runtime-runs.ts` —— `syncPlanRunRuntimeResult` 导入改指向 `kernel/sync-runtime-result`。
- `persistence/runtime-event-store.ts` —— `appendGraphRuntimeEvents` 的 `envelope` 改为可选。
- `kernel/graph-callbacks.ts` —— 已接回重入协调:`onStateChange` 落库 running 中间态,`resolveSubmittedNodeState` 读取嵌套命令已提交结果。
- `runtime/committed-state.ts` —— 已恢复(当前仍是 untracked,提交前需要 `git add`)。
- `contracts/src/plan-runtime/execution-command.ts` —— `SubmittedNodeResult` 四种终态都支持 `evidence`,用于保留 provider runtime session/run 引用。
- `kernel/execute-command.ts` —— 已补 `branchRef → selectedBranch` 解析、迟到 completed/cancelled 响应 message、graph outcome 权威 finalize、late out-of-band guard;已修 provider session id 与 execution session id 混用问题;提交节点结果时 `waitingNode` 优先于 ready fallback;runtime events 会带统一 envelope(`actor/origin/correlation/command`);session `completedNodeIds` 过滤 skipped 节点;取消 paused session 时响应 `mainSessionId` 返回既有 execution session id。
- `types.ts` —— `PlanGraphCommandEnvelope` 默认命令类型放宽为 `AdvanceRuntimeCommand | { type: string }`,允许事件 envelope 保留 legacy API 命令标签如 `complete_manual_node`。
- `plan-runner.task-executor.fixtures.ts` —— 测试 mock 补齐 `runTaskNodeFeature` 真实导出透传,避免全目录运行时 Bun mock 污染 `node-ai-capabilities.bun.test.ts`。

已删除(`git rm`):`runtime/committed-state.ts`、`runtime/graph-runtime-callbacks.ts`、`runtime/execution-fencing.ts`(+test)、`runtime/node-attempt-idempotency.ts`(+test)、`persistence/execution-lease-store.ts`(+test)、`use-cases/advance-outcome.ts`、`use-cases/execution-lifecycle.ts`、`use-cases/dispatch-runtime-command-action.ts`、`runtime/advance-dispatch/*`、`use-cases/sync-runtime-result/sync-plan-run-runtime-result.ts`(+test)。

内核 finalize 已修正:状态用 `executionStatusFromGraphOutcome(outcome)`(graph 权威信号),而非从 effective 图反推(pause 表现为 `outcome.status="blocked"`,cancel 为 `"cancelled"`)。已加守卫:带外 sync 在 session 非 Active 时忽略;无法解析目标节点的命令优雅忽略(返回当前状态);已完成/已取消迟到结果返回精确 message `"Execution already completed; node result ignored."`;epoch 冲突返回当前状态。

## ⚠️ 关键技术洞察(续作必读)

**committed-state 协调不是纯粹的「双写者 cruft」,而是 dispatch 内「重入」所必需。** 真实 provider 终态工具的工作方式:执行器(executeNode)在运行中**重入** `executeCommand`(嵌套 `complete_manual_node` / 条件分支),提交本节点结果,然后 provider run 对象再单独返回 `started`/`done`。当前工作区已恢复并接入该协调,相关边界回归已绿。正确处理原则:

1. **dispatch 内必须持久化中间态**:graph 在调用 executeNode 前会 `onStateChange`(此时 attempt 已 running)。当前工作区已用 `persistRuntimeState` 落库 running 态,让嵌套命令能读到 running attempt。
2. **必须恢复 `resolveSubmittedNodeState` 回调**:executeNode 返回后,graph 用它回读该节点的已提交结果;若节点已被嵌套命令提交,则采用已提交态而非执行器返回值。当前工作区已接入 `committedStateForSubmittedNode` / `committedStateIfRunningNodeAdvanced`。
3. **并发**(非重入):当前并发回归已绿:`plan-runner.task-executor.concurrency.bun.test.ts` 5 通过;`duplicate-execution-regression.bun.test.ts` 通过。旧文档中“必须恢复 execution lease”已过时;当前 `execution-lease-store.ts` 仍 staged 删除,入口未显式获取 lease。后续若出现真实 overlapping writer 漏洞,再补轻量 lease,不要先回滚删除。

> 结论:`committed-state.ts` 已恢复,`graph-callbacks.ts` 已重新接 `onStateChange`(含 committed 检查)+ `resolveSubmittedNodeState`。提交前确认 `runtime/committed-state.ts` 被纳入 git。架构收益(单入口 / 统一类型 / 单命令词汇 / 无 setTimeout / 无独立 sync 通道)依然成立。

## 当前验证结果(2026-06-04)

逐文件聚焦结果:

| 测试文件 | 结果 |
|---|---|
| `kernel/execute-command.smoke.bun.test.ts` | 3 通过 / 0 失败 |
| `plan-runner.task-executor.external-results.bun.test.ts` | 7 通过 / 0 失败 |
| `plan-runner.task-executor.approval.bun.test.ts` | 3 通过 / 0 失败 |
| `plan-runner.task-executor.full-chain.bun.test.ts` | 1 通过 / 0 失败 |
| `plan-runner.bun.test.ts` | 7 通过 / 0 失败 |
| `node-ai-capabilities.bun.test.ts` | 5 通过 / 0 失败 |
| `plan-runner.task-executor.concurrency.bun.test.ts` | 5 通过 / 0 失败 |
| `__tests__/duplicate-execution-regression.bun.test.ts` | 1 通过 / 0 失败 |
| `__tests__/serial-branch-result-regression.bun.test.ts` | 1 通过 / 0 失败 |
| `__tests__/stop-pause-regression.bun.test.ts` | 3 通过 / 0 失败 |
| `__tests__/execution-state-invariants.bun.test.ts` | 3 通过 / 0 失败 |

本次修复后已清掉:

- A 组:provider-started 覆盖 node 结果 / 覆盖 blocked 结果 / provider 终态重入后由外层 loop 续跑下游 / AI 条件经 graph 命令收敛。
- B 组:`branchRef` 已解析成 `selectedBranch`;`continueExecution:false` 暂停语义已恢复;等待态 condition 可通过统一 graph 命令提交结果。
- C 组:迟到 completed/cancelled message 已实现。
- D 组:并发回归已绿,无需立刻恢复 lease。
- E 组:approval feedback snapshot / cancel paused `mainSessionId` / full-chain skipped filtering 已绿。
- 4 个验收回归套件全部绿:duplicate / serial-branch / stop-pause / state-invariants。
- 全目录:`bun test ./packages/engine/src/modules/plan-execution` = 79 通过 / 0 失败 / 424 expect / 21 files。

## 剩余失败用例

当前 `plan-execution` 聚焦套件无剩余失败。

注意:本次只复跑 plan-execution 相关测试;全仓 `bun run typecheck` / `bun run lint` / `bun run test` 尚未在更新后执行。

## 剩余阶段(Stage 6–9)

- **Stage 6 DB 迁移**:当前内核复用既有 `executionEpoch` 列,**可能无需新迁移**;若决定 drop 旧 lease/fencing 残留列再单独做破坏性 migration(`prisma/schema.prisma` + `prisma migrate`)。
- **Stage 7 调用方**:当前策略下无需改写(签名保留)。若仍要做 API 重命名(原计划),作为可选收尾。
- **Stage 8 测试**:`plan-execution` 聚焦套件已全绿;4 个回归套件(duplicate / serial-branch / stop-pause / state-invariants)已全绿。
- **Stage 9 验证**:`bun run typecheck`、graph-runtime + engine 测试、端到端、并发回归。

## 续作命令速查

```bash
git checkout refactor/plan-execution-kernel
bunx tsc --noEmit --pretty false 2>&1 | grep -cE "error TS"          # 期望 0
bun test ./packages/engine/src/modules/plan-execution                  # 当前 79 通过 / 0 失败
bun test ./packages/engine/src/modules/plan-execution/plan-runner.task-executor.external-results.bun.test.ts
bun test ./packages/engine/src/modules/plan-execution/plan-runner.task-executor.approval.bun.test.ts
bun test ./packages/engine/src/modules/plan-execution/plan-runner.task-executor.full-chain.bun.test.ts
bun test ./packages/engine/src/modules/plan-execution/plan-runner.bun.test.ts
bun test ./packages/engine/src/modules/plan-execution/plan-runner.task-executor.concurrency.bun.test.ts
```

## 清理待办(低优先)

- 孤儿文件(无引用,不影响编译):`runtime/command-envelope.ts`、`runtime/terminal-command.ts`、`runtime/execution-events.ts`、`runtime/execution-control-registry.ts`、`use-cases/sync-runtime-result/{attempts,node-result,types}.ts`(确认后删,或保留供 sync 复用)。
- `types.ts` 中旧 `AdvanceRuntimeCommand` 等若彻底无引用可删;`SyncPlanRunRuntimeResultInput`/`ExecutionActionWithContinuation`/`PlanExecutionObserver` 仍被引用,保留。
- `execution-state-machine.ts` 的 `executionStatusFromWaitKind` 等若无引用可清(`executionStatusFromGraphOutcome`/`executionStatusFromEffectiveGraph`/`executionTransition` 仍用)。
