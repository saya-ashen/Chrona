# Schedule Page Optimization Plan

Goal: turn the schedule page into a real planning cockpit with strong baseline scheduling UX and a second layer of agent-native planning features, while keeping scope focused on the schedule page plus its directly supporting schedule/query/action modules.

Reviewed entry and directly relevant files:
- `src/app/schedule/page.tsx`
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-page-types.ts`
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-panels.tsx`
- `src/components/schedule/schedule-page-utils.ts`
- `src/components/schedule/schedule-page-copy.ts`
- `src/components/schedule/schedule-page-state.ts`
- `src/app/api/schedule/projection/route.ts`
- `src/modules/queries/get-schedule-page.ts`
- `src/app/actions/task-actions.ts`
- supporting command capability checked:
  - `src/modules/commands/propose-schedule.ts`
  - `src/modules/commands/generate-task-plan.ts`
- existing tests checked:
  - `src/modules/queries/__tests__/get-schedule-page.bun.test.ts`
  - `src/modules/queries/__tests__/get-schedule-page-runnable-state.bun.test.ts`

---

## 1. Current state summary

The current schedule page already has a decent skeleton:
- timeline vs list view
- week strip
- unscheduled queue side rail
- risk rail
- AI proposal rail
- drag from queue to timeline
- click-empty-slot to open a create composer
- floating selected-block sheet
- schedule projection refresh via `/api/schedule/projection`

But it is still missing core “calendar-grade” interactions and most of the agent-native features you want.

### Current strengths
1. Data model already separates:
   - `scheduled`
   - `unscheduled`
   - `risks`
   - `proposals`
   - `listItems`
2. Timeline already supports:
   - queue -> timeline drop
   - scheduled block move by drag-start + drop
   - click lane to create a new scheduled task
3. Schedule page already has mutation hooks for:
   - create task from schedule
   - update task config
   - apply schedule
   - accept/reject schedule proposals
4. Query layer already exposes runnability and runtime configuration, so the page can become much more intelligent without a major data reset.

### Main problems
1. “拖动操作” is incomplete
   - you can move a block to a new slot, but cannot resize a block by dragging edges
   - cannot drag across day boundaries in a natural way
   - no overlap/conflict preview during drag
   - no multi-select or batch shifts
   - no keyboard scheduling support
2. “快速创建任务” is still too heavy
   - create flow opens full `TaskConfigForm`
   - creating a simple block requires too much config upfront
   - no inline quick-add in queue or on timeline
   - no slash/preset command UX for common task types
3. UI is structurally solid but not yet polished as a primary work surface
   - hierarchy is still card-heavy and fragmented
   - schedule page lacks a strong top-level planning summary / control bar
   - timeline density, hover affordances, and drag handles are weak
   - side rail tabs are useful but too passive
4. Advanced features are mostly absent from schedule UX
   - no natural-language scheduling command bar
   - no AI-assisted task decomposition from a rough goal
   - no schedule-level automation rules for auto-execution
   - no reminder policy editor
   - no “agent suggests next best arrangement” control loop beyond passive proposals
5. The read model is still too flat
   - `getSchedulePage()` returns lists, but not a higher-level planning state
   - no unified concept of “today health”, “capacity”, “focus load”, “automation candidates”, or “attention-required sections”

---

## 2. Product direction

Refactor the schedule page into 3 explicit layers:

1. Planning command layer
   - quick add
   - natural language command bar
   - planner actions (decompose, auto-arrange, focus today, rebalance)

2. Interactive calendar layer
   - richer timeline interactions
   - faster block creation/editing
   - better day/week switching
   - conflict-aware drag/resize

3. Automation layer
   - execution policy
   - reminder policy
   - AI proposals / decomposition / auto-slotting
   - schedule health and focus recommendations

This lets the page evolve from “a task placement screen” into “the control center for planning and execution.”

---

## 3. Implementation roadmap

## Phase A — Baseline UX fixes first

These are the highest-value improvements because they solve the most obvious shortcomings without requiring heavy backend AI changes.

### A1. Upgrade timeline drag interactions

Objective: make the timeline feel like a real scheduler rather than a drop target.

Files:
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-utils.ts`
- `src/components/schedule/schedule-page-types.ts`
- likely new helper: `src/components/schedule/timeline-interactions.ts`

Implement:
1. Block resize handles
   - top and bottom resize grips on scheduled blocks
   - snap to `TIMELINE_SLOT_MINUTES`
   - update `scheduledStartAt` / `scheduledEndAt`
2. Same-day drag with live ghost preview
   - current preview exists, but upgrade visual quality and conflict awareness
3. Drag across days
   - allow dragging block to another day using week strip drop targets or a week mini-grid
4. Conflict detection during drag
   - visually warn when the new slot overlaps another task block
   - allow overlaps only if product wants it; otherwise prevent drop
5. Keyboard support
   - arrow keys to move selected block by 30m
   - shift+arrow to resize block
6. Touch-friendly interaction
   - long press to drag on mobile/tablet

Backend impact:
- no new command required if resize still goes through `applySchedule`
- only need the UI to send updated start/end times

Recommended data additions:
- add derived block metadata in query or selector layer:
  - `durationMinutes`
  - `isConflict`
  - `conflictsWithTaskIds`

### A2. Add a true quick-create flow

Objective: make it possible to create a task in under 10 seconds.

Files:
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-panels.tsx`
- create: `src/components/schedule/quick-task-create.tsx`
- extend: `src/app/actions/task-actions.ts`

Implement two creation modes:

1. Ultra-quick create
   - fields: title, optional duration, priority, due date optional
   - auto-fill runtime config from workspace default preset
   - create as Draft or Ready depending on minimum config
2. Expanded create
   - current `TaskConfigForm`
   - keep for advanced configuration

UX changes:
- top bar quick-add button
- inline “+” between timeline gaps
- queue header “快速创建” button
- keyboard shortcut (`c` or `n`)

Recommended new action:
- `createQuickTaskFromSchedule(input)`
  - wraps `createTask`
  - applies workspace-default runtime preset when needed
  - optionally schedules immediately if start/end is supplied

Why this matters:
The current composer is useful for power users but too heavy for capture-first planning.

### A3. Improve information hierarchy / layout polish

Objective: make the page read like a planning cockpit, not a stack of utility cards.

Files:
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/planning-header.tsx`
- `src/components/schedule/schedule-action-rail.tsx`
- `src/components/schedule/schedule-page-copy.ts`

Change layout into:
1. Top command bar
   - search / NL command input
   - quick create
   - focus today
   - auto-arrange
2. Main planning canvas
   - timeline/list as the main center
3. Right planning rail
   - Queue
   - Risks
   - Proposals
   - Automation
4. Bottom or secondary summary strip
   - week overview, load/capacity summaries

Visual improvements:
- stronger selected-day state
- denser timeline card design
- visible drag handles
- clearer due/priority/runnable indicators
- more opinionated spacing and sticky controls

### A4. Make queue and block editing more operational

Objective: reduce navigation and sheet friction.

Files:
- `src/components/schedule/schedule-page-panels.tsx`
- `src/components/schedule/schedule-editor-form.tsx`
- `src/components/schedule/task-config-form.tsx`

Improvements:
1. Inline queue actions
   - quick schedule today
   - quick schedule tomorrow morning
   - ask AI to place
   - decompose task
2. Inline block actions in selected sheet
   - start now
   - move to next free slot
   - split block
   - duplicate as follow-up
   - mark as reminder-only
3. Add “schedule presets”
   - 30m review
   - 1h deep work
   - 2h build
   - end-of-day wrap-up

---

## Phase B — Upgrade the schedule read model

The current `getSchedulePage()` is good for rendering lists, but not enough for intelligent planning UX.

### B1. Add a normalized schedule dashboard model

Files:
- `src/modules/queries/get-schedule-page.ts`
- `src/components/schedule/schedule-page-types.ts`

Add fields like:

```ts
planningSummary: {
  todayLoadMinutes: number;
  overdueCount: number;
  atRiskCount: number;
  readyToScheduleCount: number;
  autoRunnableCount: number;
  waitingOnUserCount: number;
}

focusZones: Array<{
  dayKey: string;
  totalMinutes: number;
  deepWorkMinutes: number;
  fragmentedMinutes: number;
  riskLevel: "low" | "medium" | "high";
}>

automationCandidates: Array<{
  taskId: string;
  reason: string;
  action: "auto_schedule" | "auto_run" | "remind" | "decompose";
}>
```

This powers:
- better top metrics
- automation rail
- focus recommendations
- smarter quick actions

### B2. Add conflict/capacity derivation

Files:
- `src/modules/queries/get-schedule-page.ts`
- maybe new helper: `src/modules/schedule/derive-schedule-health.ts`

Derive:
- overlapping blocks
- fragmented days
- overloaded day minutes
- idle windows
- runnable unscheduled tasks
- due-soon unscheduled tasks

Why this matters:
Advanced schedule features should not depend on the UI manually recomputing planning health.

### B3. Add richer proposal types

Right now proposals are plain schedule proposals.

Extend to support proposal categories:
- `schedule_slot`
- `split_task`
- `decompose_task`
- `auto_run_window`
- `reminder_policy`

Even if backend creation is phased, shape the model now so the page can show more than “accept/reject block placement”.

---

## Phase C — Natural language task and schedule creation

This is the first major advanced feature.

### C1. Add a schedule command bar

Objective: let the user type things like:
- “明天下午帮我安排两个小时做论文答辩PPT”
- “把所有高优先级任务挪到今天”
- “给这个任务拆成三个阶段并安排到本周”

Files:
- create: `src/components/schedule/schedule-command-bar.tsx`
- create: `src/app/api/schedule/interpret/route.ts` or server action wrapper
- create: `src/modules/schedule/interpret-schedule-command.ts`
- update: `src/components/schedule/schedule-page.tsx`
- update: `src/components/schedule/schedule-page-types.ts`

Suggested architecture:
1. User enters NL command
2. Backend parser/LLM converts it into structured intent
3. UI shows a review sheet before commit
4. User confirms -> invoke existing or new actions

Example intent schema:

```ts
{
  action:
    | "create_task"
    | "schedule_existing_task"
    | "reschedule_task"
    | "decompose_and_schedule"
    | "set_reminder"
    | "enable_auto_run";
  confidence: number;
  summary: string;
  targetTaskId?: string;
  taskDraft?: {
    title: string;
    description?: string;
    priority?: string;
  };
  scheduleDraft?: {
    dayKey?: string;
    startAt?: string;
    endAt?: string;
    durationMinutes?: number;
  };
  followUpQuestions?: string[];
}
```

Important UX rule:
NL scheduling should be review-first, not execute-blind.

### C2. Support natural-language quick-create from empty slots

When user clicks an empty slot, allow two tabs:
- Quick form
- 自然语言

Natural language examples:
- “安排明早 9 点写项目总结，1 小时”
- “做一个高优先级代码排查任务”

This should map to the same intent parser.

---

## Phase D — Task intelligent decomposition

This is the second major advanced feature.

### D1. Add “智能细化任务” action from queue and detail sheet

Objective: turn a rough task into a plan that can become scheduleable blocks.

Files:
- `src/components/schedule/schedule-page-panels.tsx`
- `src/app/actions/task-actions.ts`
- create: `src/modules/commands/decompose-task-for-schedule.ts`
- possibly reuse/extend: `src/modules/commands/generate-task-plan.ts`

Current state:
- `generateTaskPlan` exists, but it is mock-like and work-page-oriented.
- It is not enough for schedule planning because it does not generate schedule-ready sub-blocks.

Need a schedule-specific decomposition output:

```ts
{
  taskId: string;
  summary: string;
  subtasks: Array<{
    title: string;
    objective: string;
    estimatedMinutes: number;
    preferredOrder: number;
    preferredWindow?: "morning" | "afternoon" | "evening";
    requiresUserInput: boolean;
  }>;
}
```

Then give the user 3 choices:
1. create as child tasks
2. create as schedule blocks under same task
3. turn into AI proposals for review

### D2. Add “schedule from decomposition” review panel

UI flow:
1. user clicks 智能细化
2. backend returns subtask proposal
3. page shows a decomposition sheet
4. user edits durations/order
5. click “安排到本周”
6. system creates child tasks or schedule proposals

This is where schedule and task structure become truly agent-native.

---

## Phase E — Auto execution

This is the third major advanced feature.

### E1. Add execution policy to tasks from the schedule page

Objective: let the schedule page decide whether a task should auto-run when its block starts.

Files:
- `src/components/schedule/task-config-form.tsx`
- `src/components/schedule/schedule-page-types.ts`
- `src/modules/queries/get-schedule-page.ts`
- create migration / schema support if missing
- create: `src/modules/schedule/execution-policy.ts`

Example policy:

```ts
executionPolicy: {
  mode: "manual" | "suggest" | "auto_run_if_runnable";
  startWindowMinutes: number;
  requireApprovalBeforeRun: boolean;
}
```

Schedule page UX:
- block badge: Auto-run / Suggest / Manual
- bulk filter for auto-runnable blocks today

### E2. Add a scheduler/cron bridge for block start execution

Need a background scheduler that periodically checks:
- tasks scheduled to start soon
- runnability true
- execution policy auto
- no blocking approvals

Then calls existing runtime launch flow, likely via `startRun` or a lower-level command.

This is beyond the page itself, but the schedule page should be the configuration surface.

Important separation:
- schedule page = authoring and review UI
- backend scheduler = enforcement/execution engine

### E3. Add auto-run recommendation rail section

Use derived schedule data to show:
- “3 tasks can auto-run today”
- “2 tasks scheduled soon still need prompt/config”
- “1 task should stay manual because approval is likely”

---

## Phase F — Reminders and proactive planning

### F1. Reminder policy

Objective: support human-facing reminders on top of scheduling.

Files:
- create: `src/components/schedule/reminder-policy-form.tsx`
- update: `src/components/schedule/schedule-page-panels.tsx`
- update query/types as needed

Example reminder policy:

```ts
reminderPolicy: {
  mode: "none" | "before_start" | "at_risk" | "missed_block" | "custom";
  remindMinutesBefore?: number;
  channel?: "inbox" | "email" | "push";
}
```

Use cases:
- remind me 15 minutes before deep-work blocks
- remind me when a high-priority task is still unscheduled by noon
- remind me if an auto-run task is blocked

### F2. Planning nudges

Top-of-page planner suggestions:
- “You have 3 unscheduled runnable tasks due soon.”
- “Tomorrow morning is overloaded by 90 minutes.”
- “This task should be split into two blocks.”

These nudges should be derived first, AI-authored second.

---

## 4. Concrete recommended file-level changes

## Frontend

### `src/components/schedule/schedule-page.tsx`
Make this the orchestration shell for:
- command bar
- planning metrics
- timeline/list canvas
- right rail tabs
- NL intent review sheet
- decomposition review sheet

Add local state for:
- command bar input/result
- selected proposal/review flow
- automation panel visibility
- active drag/resize operation

### `src/components/schedule/schedule-page-timeline.tsx`
This is the biggest UI upgrade target.

Add:
- resize handles
- conflict preview
- better drop zones
- quick-add markers
- richer block actions
- keyboard support

Avoid turning it into a monolith; split into:
- `timeline-grid.tsx`
- `timeline-block.tsx`
- `timeline-draft-overlay.tsx`
- `timeline-create-popover.tsx`

### `src/components/schedule/schedule-page-panels.tsx`
This currently mixes many roles.

Consider splitting into:
- `today-focus-card.tsx`
- `queue-card.tsx`
- `proposal-card.tsx`
- `risk-card.tsx`
- `selected-block-sheet.tsx`
- `automation-card.tsx`

That will make future advanced features much easier to add.

### `src/components/schedule/schedule-page-types.ts`
Add types for:
- planning summary
- schedule health
- automation candidates
- NL command intent
- decomposition proposal
- execution policy
- reminder policy
- richer timeline interactions

### `src/components/schedule/schedule-page-copy.ts`
Will need a substantial copy expansion to support:
- quick create
- NL scheduling
- decomposition
- auto execution
- reminders
- conflict messages
- keyboard hints

## Backend / read model

### `src/modules/queries/get-schedule-page.ts`
Extend from flat list provider into a schedule dashboard assembler.

Add:
- planning summary
- conflict/risk derivation
- automation candidates
- task execution/reminder policy projection
- due-soon grouping
- free-slot summaries if desired

### `src/app/api/schedule/projection/route.ts`
Keep as lightweight projection refresh, but once the query becomes richer, this route becomes even more important because the page depends on near-real-time refresh after drag/create/accept/reject operations.

### `src/app/actions/task-actions.ts`
Likely add wrappers for:
- `createQuickTaskFromSchedule`
- `interpretScheduleCommand`
- `decomposeTaskForSchedule`
- `applyExecutionPolicy`
- `applyReminderPolicy`
- maybe `bulkRescheduleTasks`

---

## 5. Suggested delivery order

## Slice 1 — Must-have schedule usability
Ship first:
1. quick create task
2. resize scheduled block
3. conflict preview and prevention
4. stronger top command bar and layout polish
5. inline queue actions

This alone fixes the biggest current shortcomings.

## Slice 2 — Smarter planning state
Then ship:
1. richer `getSchedulePage()` summary
2. automation candidates
3. better risk/focus derivation
4. schedule health widgets

## Slice 3 — Natural language scheduling
Then ship:
1. NL command bar
2. intent parsing + review sheet
3. NL quick-create inside timeline composer

## Slice 4 — Task decomposition
Then ship:
1. decompose task
2. review decomposition
3. create child tasks or schedule blocks from it

## Slice 5 — Auto-run + reminders
Then ship:
1. execution policy UI
2. reminder policy UI
3. background scheduler integration
4. automation panel on schedule page

This order keeps product value rising while avoiding early backend overreach.

---

## 6. Risks and design choices

1. Do not make NL actions write directly without review
   - always show a review/confirm step
2. Do not require full runtime config for basic capture
   - support lightweight creation first
3. Do not overcouple schedule UX to work-page semantics
   - schedule page should optimize planning and dispatch
   - work page should optimize execution and collaboration
4. Keep automation policy explicit
   - auto execution must always be user-visible and configurable
5. Prefer derived planning intelligence before full LLM intelligence
   - conflict detection, due pressure, focus load, runnable checks should be deterministic
   - LLM features should augment, not replace, deterministic planning logic

---

## 7. Minimum test plan

Existing tests already cover the basic query grouping and runnable-state projection.
Add tests for the new schedule-specific logic.

Recommended tests:

### Query tests
- `get-schedule-page` returns planning summary metrics
- derives conflicts and automation candidates correctly
- surfaces execution/reminder policy fields

### UI/component tests
- resizing a block updates preview times correctly
- conflict preview appears on overlap
- quick create submits minimal valid task
- NL command review sheet renders parsed intent correctly
- decomposition review creates the expected proposals/actions

### Action tests
- quick create uses workspace default runtime fallback
- decomposition returns structured subtasks
- execution policy persists correctly
- reminder policy persists correctly

If you want lightweight verification, prefer focused Bun tests over full builds.

---

## 8. Best immediate first slice

If starting implementation now, the most practical first slice is:

1. Split timeline into smaller components
2. Add block resize handles
3. Add quick-create component with minimal fields
4. Add top command bar UI shell
5. Extend `getSchedulePage()` with planning summary + conflict derivation
6. Add inline queue actions: quick schedule today / tomorrow / ask AI to place

That gets you:
- stronger base UX
- faster task capture
- better planning visibility
- a clean foundation for natural language, decomposition, and automation later

---

## 9. One-sentence product framing

The schedule page should evolve from “where tasks are placed on a timeline” into “the planning and dispatch cockpit where humans and agents decide what should happen, when it should happen, and whether it should execute automatically.”
