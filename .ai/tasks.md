# Chrona AI task queue

## CHR-AI-001: 统一 workspace 状态派生 ✅ Done

Goal:
- 把 `task.status`、`currentExecution.status`、`savedPlan.status`、node status 的派生集中到一个纯 helper 模块。
- 输出统一的 header/status/tone/action eligibility 结果。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/*`
- 可以改：相关 test files
- 不可以改：`packages/engine`、`packages/graph-runtime`、server routes、DB schema

Validation:
- `bun run typecheck`
- `bun run test`
- 新增 table-driven 状态矩阵测试

Risk:
- medium

Expected output:
- 一个纯状态模块。
- `task-workspace-query.ts` 少量重构。
- 覆盖 waiting/input/approval/blocked/failed/completed/no-plan 状态。

## CHR-AI-002: 拆分 waiting input 与 waiting approval UI 派生 ✅ Done

Goal:
- UI 派生层区分 `WaitingForInput` 与 `WaitingForApproval`。
- 不改后端状态机。

Scope:
- 可以改：`task-workspace-query.ts`、`task-workspace-actions.ts`、相关 i18n messages、tests
- 不可以改：contracts 状态枚举、engine execution behavior

Validation:
- `bun run typecheck`
- `bun run test`
- 新增两个状态的 header/overview tests

Risk:
- medium

Expected output:
- 独立 copy/tone/status detail。
- 现有 approval-needed 总类别如需保留，应加细分字段。

## CHR-AI-003: 抽 deriveHeaderActions 并补 action matrix ✅ Done

Goal:
- 从 `buildTaskHeaderView()` 抽出 start/pause/stop disabled 规则。
- 用 table-driven tests 锁定 no plan / draft plan / accepted / running / blocked / completed。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
- 可以改：`task-workspace-query.test.ts`
- 不可以改：server execution actions

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-query.test.ts`
- `bun run typecheck`

Risk:
- low

Expected output:
- `deriveHeaderActions()` pure function。
- 至少 8 个状态组合测试。

## CHR-AI-004: 补 json-render validation negative tests ✅ Done

Goal:
- 增加 spec validation 对复杂错误结构的覆盖。

Scope:
- 可以改：`packages/ui-protocol/src/document/validate.bun.test.ts`
- 可少量改：`packages/ui-protocol/src/document/validate.ts` 错误信息
- 不可以改：catalog 大规模重构

Validation:
- `bun run test:bun`
- `bun run typecheck`

Risk:
- low

Expected output:
- 覆盖 missing child、cycle、unknown component、invalid table rows、invalid ActivityStream binding、bad action params。

## CHR-AI-005: 统一 command center fallback spec validation ✅ Done

Goal:
- 让前端本地 fallback spec 都走 `validateChronaSpec()` 或测试中验证合法。
- 防止 fallback spec 和 server-driven spec 漂移。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/execution/build-execution-overview-spec.ts`
- 可以改：相关 tests
- 可以改：`packages/ui-protocol` builder tests
- 不可以改：server command-center API shape

Validation:
- `bun run test`
- `bun run test:bun`
- `bun run typecheck`

Risk:
- medium

Expected output:
- output/trail/now fallback spec 均有 validation tests。
- 无运行时大改。

## CHR-AI-006: 抽 derivePreferredGraphMode ✅ Done

Goal:
- 把 graph mode auto-switch 规则从 React effect 抽成纯函数。

Scope:
- 可以改：`task-workspace-plan-section.tsx`
- 可以改：新增或现有 plan section test
- 不可以改：graph layout 算法

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx`
- `bun run typecheck`

Risk:
- low

Expected output:
- `derivePreferredGraphMode()` 或同等 helper。
- generating/full、running/compact、completed/compact 测试。

## CHR-AI-007: 增强 activity merge/order tests ✅ Done

Goal:
- 锁定 activity stream 实时事件合并、排序、去重规则。

Scope:
- 可以改：`task-workspace-activity.test.ts`
- 可以改：`workspace-activity-feed.test.tsx`
- 不可以改：SSE hook / server event format

Validation:
- `bun run test -- apps/web/src/components/tasks/workspace/model/task-workspace-activity.test.ts`
- `bun run test -- apps/web/src/components/tasks/workspace/execution/workspace-activity-feed.test.tsx`

Risk:
- low

Expected output:
- provider run boundary、same timestamp、sequence tie-break、live/persisted dedupe 测试。

## CHR-AI-008: 审计并收敛 nodeDetail 字段 ✅ Done

Goal:
- 找出 `nodeDetail` 实际消费点，删除未使用字段或补 UI/test。

Scope:
- 可以改：`apps/web/src/components/tasks/workspace/model/task-workspace-query.ts`
- 可以改：`TaskWorkspaceInspector` / execution overview 轻量消费点
- 不可以改：大规模 drawer 设计

Validation:
- `bun run typecheck`
- `bun run test`

Risk:
- medium

Expected output:
- 未使用字段清理，或明确测试覆盖 selected/current node empty state。

## CHR-AI-009: 改善 blocked/failed/recovery action 视觉层级 ✅ Done
Goal:
- 让 blocked/failed 的主行动与危险行动区分更清楚。

Scope:
- 可以改：`task-workspace-plan-section.tsx`
- 可以改：shadcn Button variant 使用
- 不可以改：执行动作语义

Validation:
- `bun run check:ui-foundation`
- `bun run typecheck`
- 相关 component test

Risk:
- low

Expected output:
- retry/edit instruction 不再全部 destructive。
- cancel/fail 仍保留 danger 语义。

## CHR-AI-010: 增加 task workspace smoke e2e ✅ Done
Goal:
- 最小化覆盖 task workspace 首屏：header、plan panel、command center、activity 区域。

Scope:
- 可以改：e2e tests
- 不可以改：app logic

Validation:
- `bun run test:e2e:desktop`
- 如慢，PR 中说明只跑目标 spec

Risk:
- medium

Expected output:
- 一个稳定 smoke test。
- 不依赖外部 LLM/provider。

## CHR-AI-011: 更新 AGENTS 自动修改边界规则 ✅ Done

Goal:
- 增加 task workspace 状态逻辑、json-render、测试命令矩阵规则。

Scope:
- 可以改：`AGENTS.md`
- 可以改：`.ai/tasks.md` 如存在
- 不可以改：代码

Validation:
- 人工 review markdown

Risk:
- low

Expected output:
- 规则包含项目目标、禁止事项、必跑命令、状态逻辑约束、测试要求、AI 边界。


## CHR-AI-012: 清理 provider aimock 调试输出 ✅ Done
- 确认 `providers/claude-code` 测试中的 console dump 不会污染默认测试或泄露真实请求。

Scope:
- 可以改：`packages/providers/claude-code/src/*.test.ts`
- 不可以改：provider runtime behavior

Validation:
- `bun run test:bun`
- `bun run typecheck`

Risk:
- low

Expected output:
- 调试输出只在失败或显式 env 下打印。
