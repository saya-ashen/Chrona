# 循环任务重构分析

## 当前架构

```
Task (1 row, recurrenceRule: RFC5545 RRULE)
  └── WorkBlock[*] (每个occurrence 1个, recurrenceKey=ISO时间戳, taskId_recurrenceKey unique)
      ├── TaskPlan[*] (按workBlockId隔离 ✓)
      ├── ExecutionSession (按workBlockId隔离 ✓)
      ├── PlanRun (按workBlockId隔离 ✓)
      └── Event / TaskTimelineItem (❌ 无workBlockId, 全task混合)
```

存储层 (TaskPlan, ExecutionSession, PlanRun) 正确传了 workBlockId。但推送层 / 事件层 / 前端读取层完全缺失 workBlock 意识。

## 根因清单

### A. 数据库 Schema 缺口 (CRITICAL)

**Event 表** 和 **TaskTimelineItem 表** 无 `workBlockId` 列。

- `appendCanonicalEvent` (`packages/engine/src/modules/events/append-canonical-event.ts:39-53`) 入参无 `workBlockId`
- `ai-runtime-invoker.ts:544-572` -- AI 运行时事件写入时不携带 workBlockId
- `task-plan-execution.ts:229` -- lease_ignored 事件无 workBlockId
- `plan-state-store.ts:134` -- plan state 事件无 workBlockId

结果: `get-task-page.ts:814-819` 的 activity 查询无法按 occurrence 隔离，切换 occurrence 看到的是全 task 的混合 activity。

### B. SSE 事件流缺 workBlockId (CRITICAL)

- `task-projection-events.ts` 所有事件类型（`execution.runtime_event`, `plan.generation.event` 等）基类型 `WorkspaceEventBase` 只有 `taskId`，无 `workBlockId`
- SSE 路由 `work.routes.ts:265` `subscribeToTaskProjectionEvents(taskId, ...)` 只监听 task 级别，所有 workBlock 的事件混在一起发送
- 前端 `use-task-workspace-plan-state.ts:408-465` 处理 SSE 事件时不检查 `workBlockId`，A occurrence 的事件直接更新 B occurrence 的状态

### C. 前端缓存 Key 不匹配 (CRITICAL)

`use-task-workspace-plan-state.ts:370-371`:
```ts
queryClient.setQueryData(
  taskWorkspaceQueryKeys.planState(task.id),  // 缺 workBlockId!
```
而 query 的 key 是 `taskWorkspaceQueryKeys.planState(task.id, workBlockId)`。写入和读取的 key 不一致，导致切换 occurrence 后 plan 不更新。

### D. Plan generation 检查缺 workBlockId (HIGH)

`get-task-page.ts:671`:
```ts
isTaskPlanGenerationRunning({ taskId })  // 缺 workBlockId
```
A occurrence 生成 plan 时，切换到 B occurrence 也显示 "generating"。

### E. 无定期 recurrence re-expansion (MEDIUM)

WorkBlock 在创建 task 时物化 180 天 (`create-task.ts:173`)，orchestrator 无定期扩展 worker。180 天后的 occurrence 不可见。

### F. RECURRENCE_PRESETS 双份定义 (LOW)

`task-create-dialog.tsx:40` 和 `task-config-form.tsx:36` 各有一份，列表不一致（form 有 "none"，dialog 没有）。

## 重构方案 (不兼容旧数据)

### Phase 1: Schema 改造

```prisma
model Event {
  // ...existing...
  workBlockId String?    // NEW
  workBlock   WorkBlock? @relation(fields: [workBlockId], references: [id], onDelete: SetNull)  // NEW
  @@index([taskId, workBlockId, ingestSequence])  // MODIFIED from [taskId, ingestSequence]
  @@index([taskId, nodeId, workBlockId, ingestSequence])  // MODIFIED
}

model TaskTimelineItem {
  // ...existing...
  workBlockId String?    // NEW
  workBlock   WorkBlock? @relation(fields: [workBlockId], references: [id], onDelete: SetNull)  // NEW
  @@index([taskId, workBlockId, sortTime])  // MODIFIED from [taskId, sortTime]
  @@index([taskId, nodeId, workBlockId, sortTime])  // MODIFIED
}
```

Drop 旧 indexes，新建带 workBlockId 的 composite indexes。Migration 直接 wipe 现有 Event/TaskTimelineItem 数据（不兼容）。

### Phase 2: Engine 事件写入链路补 workBlockId

1. **`EventContext`** (`append-canonical-event.ts:5-18`) 加 `workBlockId?: string | null`
2. **`AppendCanonicalEventInput`** 入参自动下沉到 PRISMA insert
3. **所有调用点** (`ai-runtime-invoker.ts`, `task-plan-execution.ts`, `plan-state-store.ts`, `sync-plan-run-runtime-result.ts`) 传入 `workBlockId` -- 这些调用点已经有 `executionSession.workBlockId` 或 `runtime.workBlockId` 可用
4. **`TaskTimelineItem`** 同理，`appendTaskTimelineItem` 加 workBlockId 字段

### Phase 3: SSE 事件推送到 workBlock

1. **`WorkspaceEventBase`** (`task-projection-events.ts:1`) 加 `workBlockId?: string | null`
2. 所有 emit 点 (`publishTaskWorkspaceUpdatedEvent` etc.) 传入 workBlockId
3. SSE 路由 `work.routes.ts` 改为 `subscribeToTaskProjectionEvents(taskId, workBlockId, ...)` -- 按 (taskId, workBlockId) 粒度订阅
4. 或保持 task-level 订阅，但前端在消费事件时按 workBlockId 过滤（首选方案：后者更简单，改动更小）

### Phase 4: 前端修复

1. **`use-task-workspace-plan-state.ts:370-371`**: 传入 workBlockId
   ```ts
   taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId)
   ```
2. **SSE 事件消费**加 workBlockId 过滤：处理事件前检查 `event.workBlockId === selectedWorkBlockId`
3. **`task-workspace-page.tsx`**: 切换 occurrence 时用 `navigate` 改变 `?workBlockId=` 正确使 React Router re-run loader，无需 remount

### Phase 5: 后端读取层

1. **`get-task-page.ts:671`**: `isTaskPlanGenerationRunning({ taskId, workBlockId: selectedWorkBlockId })`
2. **`get-task-page.ts:519-547`** activity 查询加入 `workBlockId` where 条件
3. **`get-task-page.ts:605`** plan read model 传 selectedWorkBlockId (当前已传 ✓)

### Phase 6: Recurrence Re-expansion Worker

1. 在 `task-orchestrator.ts` 加定期 worker（每小时）
2. 找到所有 `recurrenceRule != null` 的 task，检查最后一个 workBlock 的 `scheduledEndAt`
3. 若距离 "现在+90天" 不足，`expandRecurrenceRule` 补齐新 workBlocks（upsert 已有 recurrenceKey 的则跳过）
4. 切换用 `create-task.ts` 同样的 `expandRecurrenceRule` + upsert 模式

### Phase 7: UI 去重

1. 删除 `task-create-dialog.tsx:40` 的 RECURRENCE_PRESETS 和 RECURRENCE_PRESET_RRULE
2. 复用 `task-config-form.tsx:36` 的 RECURRENCE_PRESETS 和 helper 函数（或抽取到 shared 模块）

## 工作量估算

| Phase | 范围 | 估时 |
|-------|------|------|
| Schema | Prisma schema + migration | 0.5d |
| Engine 事件链路 | appendCanonicalEvent + 全调用点 | 1d |
| SSE 事件 | task-projection-events.ts + work.routes.ts | 0.5d |
| 前端修复 | use-task-workspace-plan-state.ts + SSE filter + plan-state hook | 0.5d |
| 后端读取 | get-task-page.ts | 0.5d |
| Re-expansion worker | task-orchestrator.ts + 测试 | 1d |
| UI 去重 | create-dialog + config-form shared | 0.5d |
| **总计** | | **4.5d** |

## 不改的部分

- Task → WorkBlock 1:N 关系 ✓
- WorkBlock.recurrenceKey 复合唯一约束 ✓
- Plan → WorkBlock 的隔离 ✓
- ExecutionSession/PlanRun → WorkBlock 的隔离 ✓
- RRULE expansion 逻辑 (`expandRecurrenceRule`) ✓
