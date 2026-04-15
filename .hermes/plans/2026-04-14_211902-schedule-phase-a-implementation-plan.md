# Schedule Phase A Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在不触碰 work 页面和其他路由的前提下，把 `/schedule` 的第一阶段做成“真正可排程”的日程 cockpit：支持已排程 block 拖动改期、单端 resize、顶部 quick create，以及时间轴交互反馈优化。

**Architecture:** 继续保持 `src/components/schedule/schedule-page.tsx` 只做 orchestration。时间轴交互细节下沉到专门组件和 schedule utils；所有排程变更最终仍统一走 `applySchedule` / `createTaskFromSchedule`。优先做 client-side optimistic update + server refresh 校正，避免重型全局状态。

**Tech Stack:** Next.js app router, React client components, Bun/Vitest, existing schedule server actions, localized schedule-only modules.

---

## Execution status snapshot (updated)

当前对照代码库的执行进度：

- [completed] Task 1: schedule timeline 共享类型已补齐
- [completed] Task 2: collision / move / preview / quick-create 相关纯函数与测试已完成
- [completed] Task 3: scheduled block 已抽到独立 primitives 组件中
- [completed] Task 4: drag / resize / create preview 已统一为共享 placement card
- [completed] Task 5: scheduled block drag move 已完成，并带冲突预览
- [completed] Task 6: bottom-edge resize 已完成
- [completed] Task 7: top command bar quick create 已完成并接入 page orchestration
- [completed] Task 8: page-level orchestration 已完成一轮收敛，scheduled optimistic patch 已抽成局部 helper
- [completed] Task 9: 已补齐 current-time line，并完成冲突/resize/空状态等关键 timeline polish
- [completed] Task 10: targeted schedule vitest 已通过；schedule query tests 已用正确的 `bun test` runner 通过；全局 TypeScript 路径因既有约束未重试

实现与原计划有两处轻微偏差，但方向一致：
- 原计划中的 `timeline-block-card.tsx` / `timeline-drop-indicator.tsx` 最终落成了复用更高的 `schedule-timeline-primitives.tsx`
- quick create 比原计划更进一步，已经支持命令式解析（如 `@ 14:30 for 90m !high`），而不是只做 preset 表单

---

## Current grounded context

已经确认的现状：
- `src/components/schedule/schedule-page.tsx`
  - 已有 `handleScheduleDrop(...)`
  - 已有 `handleCreateTaskBlock(...)`
  - 已有 optimistic update 雏形
- `src/components/schedule/schedule-page-timeline.tsx`
  - 已支持 queue item drag -> timeline drop
  - 已支持 scheduled item drag start
  - 已支持点击时间轴空白打开 composer
  - scheduled block 目前仍是内联渲染，未独立组件化
- `src/components/schedule/schedule-page-utils.ts`
  - 已有 `snapMinuteToGrid`
  - 已有 `clampScheduledStartMinute`
  - 已有 `createScheduledItemFromQueueItem`
  - 已有 `createScheduledItemFromCreateInput`
  - 已有 `applyScheduleToListItem`
  - 但还缺 resize / collision / scheduled optimistic helpers
- 当前已有 schedule query 测试：
  - `src/modules/queries/__tests__/get-schedule-page.bun.test.ts`
  - `src/modules/queries/__tests__/get-schedule-page-runnable-state.bun.test.ts`
- 当前缺少针对 timeline 交互和 command bar 的专门测试文件。

---

## Phase A scope

只做以下四项：
1. 已排程 block 拖动改期
2. block resize（先只做尾部 resize）
3. 顶部 quick create command bar
4. 时间轴交互与 UI polish（吸附/冲突/提示）

不在本阶段做：
- 自然语言创建
- 智能细化
- 自动执行
- reminder
- schema 级大改动

---

## Files to modify / create

### Modify
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-types.ts`
- `src/components/schedule/schedule-page-copy.ts`
- `src/components/schedule/schedule-page-utils.ts`

### Create
- `src/components/schedule/timeline-block-card.tsx`
- `src/components/schedule/timeline-drop-indicator.tsx`
- `src/components/schedule/schedule-command-bar.tsx`
- `src/components/schedule/schedule-page-timeline.test.tsx`
- `src/components/schedule/schedule-command-bar.test.tsx`
- `src/components/schedule/schedule-page-utils.test.ts`

---

## Task 1: Add missing schedule timeline types [completed]

**Objective:** 给 drag / resize / quick create 引入稳定的共享类型，避免临时对象散落在页面和 timeline 文件中。

**Files:**
- Modify: `src/components/schedule/schedule-page-types.ts`

**Step 1: Add resize and draft types**

在 `schedule-page-types.ts` 新增这些类型：

```ts
export type TimelineInteractionMode = "idle" | "dragging" | "resizing" | "creating";

export type TimelineResizeEdge = "end";

export type TimelineResizeDraft = {
  taskId: string;
  edge: TimelineResizeEdge;
  startMinute: number;
  endMinute: number;
  startAt: Date;
  endAt: Date;
  top: number;
  height: number;
  hasConflict: boolean;
  conflictingTaskIds: string[];
};

export type QuickCreateDraft = {
  title: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
};
```

**Step 2: Add a normalized preview type for drag/resize indicator**

```ts
export type TimelinePlacementPreview = {
  top: number;
  height: number;
  startMinute: number;
  endMinute: number;
  startAt: Date;
  endAt: Date;
  hasConflict: boolean;
  conflictingTaskIds: string[];
  source: "drag" | "resize" | "create";
};
```

**Step 3: Verify type file remains focused**

Check that new types are generic and do not import component-level details.

---

## Task 2: Add pure scheduling helpers for collision, move, and resize [completed]

**Objective:** 把所有 minute/window 计算都放进纯函数，避免 timeline 组件继续膨胀。

**Files:**
- Modify: `src/components/schedule/schedule-page-utils.ts`
- Test: `src/components/schedule/schedule-page-utils.test.ts`

**Step 1: Add conflict detection helper**

新增：

```ts
export function detectScheduleConflicts(
  items: ScheduledItem[],
  candidate: { taskId?: string; startAt: Date; endAt: Date },
) {
  const conflicts = items.filter((item) => {
    if (!item.scheduledStartAt || !item.scheduledEndAt) return false;
    if (candidate.taskId && item.taskId === candidate.taskId) return false;
    return candidate.startAt < item.scheduledEndAt && candidate.endAt > item.scheduledStartAt;
  });

  return {
    hasConflict: conflicts.length > 0,
    conflictingTaskIds: conflicts.map((item) => item.taskId),
  };
}
```

**Step 2: Add end-minute clamp helper for resize**

```ts
export function clampScheduledEndMinute(startMinute: number, endMinute: number, minDuration = 30) {
  return Math.min(Math.max(endMinute, startMinute + minDuration), 24 * 60);
}
```

**Step 3: Add scheduled item move helper**

```ts
export function moveScheduledItem(
  item: ScheduledItem,
  startAt: Date,
  endAt: Date,
): ScheduledItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
  };
}
```

**Step 4: Add list-item update helper reuse**

如果 `applyScheduleToListItem(...)` 已足够，复用它；如果不够清晰，新增一个更语义化 wrapper：

```ts
export function moveListItemSchedule(item: ListItem, startAt: Date, endAt: Date) {
  return applyScheduleToListItem(item, startAt, endAt);
}
```

**Step 5: Add preview builder helper**

```ts
export function buildTimelinePlacementPreview(args: {
  selectedDay: string;
  startMinute: number;
  endMinute: number;
  compressedTimeline: {
    mapMinuteToY: (minute: number) => number;
  };
  items: ScheduledItem[];
  taskId?: string;
  source: "drag" | "resize" | "create";
}): TimelinePlacementPreview {
  const top = args.compressedTimeline.mapMinuteToY(args.startMinute);
  const bottom = args.compressedTimeline.mapMinuteToY(args.endMinute);
  const startAt = toDateForDay(args.selectedDay, args.startMinute);
  const endAt = toDateForDay(args.selectedDay, args.endMinute);
  const { hasConflict, conflictingTaskIds } = detectScheduleConflicts(args.items, {
    taskId: args.taskId,
    startAt,
    endAt,
  });

  return {
    top,
    height: Math.max(bottom - top, 56),
    startMinute: args.startMinute,
    endMinute: args.endMinute,
    startAt,
    endAt,
    hasConflict,
    conflictingTaskIds,
    source: args.source,
  };
}
```

**Step 6: Write tests first**

`src/components/schedule/schedule-page-utils.test.ts` 至少覆盖：
- `detectScheduleConflicts` 在 overlap / non-overlap / self-ignore 三种情况下的输出
- `clampScheduledEndMinute` 的最小时长限制
- `moveScheduledItem` 是否保留 task identity 并更新 window
- `buildTimelinePlacementPreview` 是否正确返回 `hasConflict`

**Step 7: Run targeted tests**

Run:
`bun vitest run src/components/schedule/schedule-page-utils.test.ts`

Expected:
- PASS

---

## Task 3: Extract scheduled block into `timeline-block-card.tsx` [completed with implementation deviation]

**Objective:** 把 `schedule-page-timeline.tsx` 底部内联 block 渲染抽出来，为拖动和 resize handle 做准备。

**Files:**
- Create: `src/components/schedule/timeline-block-card.tsx`
- Modify: `src/components/schedule/schedule-page-timeline.tsx`

**Step 1: Create component props**

```ts
type TimelineBlockCardProps = {
  item: ScheduledItem;
  selectedDay: string;
  selectedTaskId?: string;
  top: number;
  height: number;
  isPending: boolean;
  isSelected: boolean;
  isResizeActive?: boolean;
  onDragStart: (item: ScheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onResizeStart: (item: ScheduledItem, event: React.PointerEvent<HTMLButtonElement>) => void;
};
```

**Step 2: Move existing card markup into the component**

把当前 `items.map(...)` 里的 block UI 移过去，保留：
- title
- priority badge
- time range
- owner
- overdue / approval badge

**Step 3: Add resize handle**

在 block 底部增加一个按钮：

```tsx
<button
  type="button"
  aria-label={`Resize ${item.title}`}
  onPointerDown={(event) => onResizeStart(item, event)}
  className="absolute inset-x-3 bottom-1 h-2 cursor-ns-resize rounded-full bg-border/80 hover:bg-primary/60"
/>
```

第一版只做底部 handle，不做顶部 handle。

**Step 4: Wire back into timeline**

`schedule-page-timeline.tsx` 使用新组件替换底部的内联 `LocalizedLink` block 渲染。

---

## Task 4: Add drag + resize preview indicator [completed with implementation deviation]

**Objective:** 统一渲染拖放预览和 resize 预览，不要在 timeline 主文件里重复写绝对定位 overlay。

**Files:**
- Create: `src/components/schedule/timeline-drop-indicator.tsx`
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`

**Step 1: Create indicator component**

输入：
- `preview: TimelinePlacementPreview`
- `title: string`
- `mode: "drag" | "resize" | "create"`

渲染：
- 正常态：primary border
- conflict 态：critical border + warning text
- 文案：时间范围 + “drop to move block” / “resize block” / “create block”

**Step 2: Add copy keys**

在 `schedule-page-copy.ts` 增加：
- `resizeBlock`
- `resizeConflict`
- `dragConflict`
- `dropConflictsWith`
- `quickCreate`
- `quickCreatePlaceholder`
- `quickCreateSchedule`
- `quickCreateToday`
- `quickCreateTomorrow`

**Step 3: Replace existing inline drag preview**

把 `schedule-page-timeline.tsx` 中现在的 `draggedItem && dragPreview` overlay 替换成 `TimelineDropIndicator`。

**Step 4: Add resize preview support**

时间轴组件新增 `resizeDraft` state；resize 中也使用同一 indicator 渲染。

---

## Task 5: Implement scheduled block drag move completely [completed]

**Objective:** 把已排程 block 拖动改期做完整，包括 optimistic update、conflict preview、失败回滚。

**Files:**
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Test: `src/components/schedule/schedule-page-timeline.test.tsx`

**Step 1: Make scheduled block use unified drag start signature**

在 timeline 内统一：

```ts
function handleScheduledCardDragStart(item: ScheduledItem, event: DragEvent<HTMLElement>) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.taskId);
  onScheduledDragStart(item);
}
```

**Step 2: Ensure preview ignores self-conflict**

调用 `buildTimelinePlacementPreview(...)` 时传入当前 `taskId`。

**Step 3: Reject conflicting drop for now**

第一版策略：
- 预览允许显示冲突
- 但 drop 时如果 `hasConflict` 为 true，则：
  - 不调用 `applySchedule`
  - 显示 `errorMessage`
  - 保持原位置

**Step 4: Keep optimistic move in page component**

在 `schedule-page.tsx` 里把 scheduled 分支中的内联对象更新改为复用 util：

```ts
scheduled: sortScheduledItems(
  current.scheduled.map((scheduledItem) =>
    scheduledItem.taskId === item.taskId
      ? moveScheduledItem(scheduledItem, startAt, endAt)
      : scheduledItem,
  ),
)
```

**Step 5: Add timeline tests**

`src/components/schedule/schedule-page-timeline.test.tsx` 至少覆盖：
- scheduled block drag start 调用 handler
- 拖入新 slot 时生成正确 preview
- 有冲突时 indicator 呈现 conflict style

**Step 6: Run tests**

Run:
`bun vitest run src/components/schedule/schedule-page-utils.test.ts src/components/schedule/schedule-page-timeline.test.tsx`

Expected:
- PASS

---

## Task 6: Implement bottom-edge resize [completed]

**Objective:** 让 scheduled block 支持通过底部 handle 延长/缩短时长。

**Files:**
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Modify: `src/components/schedule/timeline-block-card.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Test: `src/components/schedule/schedule-page-timeline.test.tsx`

**Step 1: Add resize interaction state in timeline**

新增 state：

```ts
const [resizeDraft, setResizeDraft] = useState<TimelineResizeDraft | null>(null);
```

**Step 2: Start resize on pointer down**

`onResizeStart(item, event)`：
- `event.preventDefault()`
- capture 当前 taskId / startMinute / endMinute
- 注册 `pointermove` / `pointerup`

**Step 3: On pointermove, compute next end minute**

逻辑：
- 用 `getMinuteFromClientY(event.clientY)` 获取 minute
- `snapMinuteToGrid(...)`
- `clampScheduledEndMinute(startMinute, nextMinute)`
- 通过 `buildTimelinePlacementPreview(...)` 生成预览

**Step 4: On pointerup, commit resize if valid**

若：
- preview 不冲突
- endMinute 与原值不同

则调用上层：

```ts
onScheduleDrop(
  {
    kind: "scheduled",
    taskId: item.taskId,
    title: item.title,
    dueAt: item.dueAt,
    durationMinutes: nextEndMinute - startMinute,
  },
  startAt,
  endAt,
)
```

说明：第一版可复用 `onScheduleDrop`，不单独引入 `onResizeCommit`。

**Step 5: Add tests**

覆盖：
- pointermove 变更时长
- 小于最小时长时被 clamp
- 冲突时不提交

---

## Task 7: Add top command bar quick create [completed]

**Objective:** 让用户能不用点击时间轴也能快速创建并安排任务。

**Files:**
- Create: `src/components/schedule/schedule-command-bar.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`
- Test: `src/components/schedule/schedule-command-bar.test.tsx`

**Step 1: Create minimal quick create form**

表单字段：
- `title`（必填）
- `priority`（默认 Medium）
- `schedulePreset`：
  - none
  - today-9am
  - today-2pm
  - tomorrow-9am

第一版不要上自然语言解析。

**Step 2: Emit normalized draft**

组件对外暴露：

```ts
onQuickCreateAction(draft: QuickCreateDraft): Promise<void>
```

**Step 3: Implement handler in page**

在 `schedule-page.tsx`：
- 先 `createTaskFromSchedule(...)`
- 如果带 `scheduledStartAt/scheduledEndAt`，立刻 `applySchedule(...)`
- 然后 optimistic 插入 `scheduled` 或 `unscheduled`
- 最后 refreshProjection

**Step 4: Mount command bar near header**

放置位置：
- `PlanningHeader` 下方
- `WeekStrip` 上方

**Step 5: Add tests**

至少覆盖：
- title 为空时不提交
- 选择 today preset 会传出 start/end 时间
- click submit 时调用 handler 一次

**Step 6: Run tests**

Run:
`bun vitest run src/components/schedule/schedule-command-bar.test.tsx`

Expected:
- PASS

---

## Task 8: Integrate page-level orchestration cleanly [partial]

**Objective:** 把 quick create、drag move、resize 全部接进 `schedule-page.tsx`，但不让该文件重新膨胀。

**Files:**
- Modify: `src/components/schedule/schedule-page.tsx`

**Step 1: Add quick create handler**

新增：

```ts
async function handleQuickCreate(draft: QuickCreateDraft) {
  // createTaskFromSchedule
  // optional applySchedule
  // optimistic patch
  // refreshProjection
}
```

**Step 2: Refactor optimistic schedule mutation into local helper**

在页面组件内部抽一个小 helper：

```ts
function patchScheduledWindow(taskId: string, startAt: Date, endAt: Date) {
  setViewData((current) => ({
    ...current,
    scheduled: sortScheduledItems(
      current.scheduled.map((item) =>
        item.taskId === taskId ? moveScheduledItem(item, startAt, endAt) : item,
      ),
    ),
    listItems: current.listItems.map((item) =>
      item.taskId === taskId ? applyScheduleToListItem(item, startAt, endAt) : item,
    ),
  }));
}
```

**Step 3: Reuse helper in drag-drop branch**

减少当前 `handleScheduleDrop` 中的重复对象展开。

**Step 4: Keep rollback simple**

失败时仍然 `setViewData(data)`，不要在第一版引入复杂 patch rollback stack。

---

## Task 9: Add user-visible polish [partial]

**Objective:** 提升基础 UI 反馈，让时间轴更像 cockpit 而不是 demo。

**Files:**
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Modify: `src/components/schedule/timeline-drop-indicator.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`

**Step 1: Add current-time line if active day is today**

显示一条横线和当前时间标记。

**Step 2: Add stronger empty-day CTA**

空白天不仅显示说明，还要提示：
- click to create
- drag queue item here

**Step 3: Distinguish resize vs drag visuals**

- drag: dashed border
- resize: solid primary border
- conflict: critical tone

**Step 4: Show pending cursor and disable interactions while saving**

在 resize/drag 提交期间，禁止新的交互开始。

---

## Task 10: Full verification [partial]

**Objective:** 确认 schedule Phase A 改动在 schedule import chain 内可编译、可测试。

**Files:**
- No source changes required unless failures appear

**Step 1: Run narrow Vitest suite**

Run:
`bun vitest run src/components/schedule/schedule-page-utils.test.ts src/components/schedule/schedule-command-bar.test.tsx src/components/schedule/schedule-page-timeline.test.tsx`

Expected:
- PASS

**Step 2: Run schedule query tests too**

Run:
`bun vitest run src/modules/queries/__tests__/get-schedule-page.bun.test.ts src/modules/queries/__tests__/get-schedule-page-runnable-state.bun.test.ts`

Expected:
- PASS

**Step 3: Run TypeScript check**

Run:
`bunx tsc -p tsconfig.json --noEmit --pretty false`

Expected:
- repo may still contain unrelated legacy errors
- schedule-related files should introduce no new errors

**Step 4: Filter for schedule chain if needed**

If global tsc is red, filter output for:
- `src/components/schedule/`
- `src/modules/queries/get-schedule-page.ts`
- `src/app/api/schedule/projection/route.ts`

Expected:
- no new schedule-side regressions

---

## Risks and guardrails

1. Resize 事件容易与 block 点击跳转冲突
- Guardrail: resize handle 用独立 `button`，`pointerdown` 时 `preventDefault + stopPropagation`

2. Drag preview / resize preview 逻辑重复
- Guardrail: 强制统一使用 `buildTimelinePlacementPreview(...)` + `TimelineDropIndicator`

3. `schedule-page.tsx` 再次膨胀
- Guardrail: 交互细节尽量下沉到 `timeline-block-card.tsx` 和 `timeline-drop-indicator.tsx`

4. 冲突处理过于复杂
- Guardrail: 第一版只做“检测 + 阻止提交 + 显示提示”，暂不做自动挤压/重排

---

## Recommended commit slices

1. `test: add schedule timeline utility coverage`
2. `refactor: extract timeline block card and drop indicator`
3. `feat: support dragging scheduled blocks on schedule timeline`
4. `feat: support bottom-edge resize for scheduled blocks`
5. `feat: add schedule quick create command bar`
6. `test: add schedule timeline and command bar coverage`

---

## Success criteria

Phase A 完成后，用户应该能：
- 从 queue 拖任务到 timeline
- 拖动已排程 block 到新时间
- 拖 block 底边改变时长
- 在顶部 quick create 里 3 秒内创建一个今天/明天的任务
- 在冲突时收到可见反馈，而不是静默失败
- 看到更清晰的时间轴交互反馈

---

## Execution handoff

Plan complete and saved. Ready to execute as a narrow schedule-only implementation slice. If you want, the next best step is to start with Tasks 1-3 together: add utils/types coverage, extract `timeline-block-card.tsx`, then wire scheduled block drag move.