# Work Page Task-Driven Agent Panel Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Refactor only the work page into a task-driven Agent panel where the task’s schedule context is visible, the current execution step is obvious, and the user collaborates with the Agent from one focused workspace.

Architecture: Keep `src/components/work/work-page-client.tsx` as the page entry, but simplify the page around one core mental model: task brief -> current step -> collaboration thread -> result/review. Avoid reviving any legacy top-level work components not already referenced. Push more task-stage semantics into the work-page projection/query layer so the UI stops inferring workflow from scattered run statuses.

Tech Stack: Next.js app router, client/server React components, server actions in `src/app/actions/task-actions.ts`, read model from `src/modules/queries/get-work-page.ts`.

---

## Current context / findings

Entry point reviewed:
- `src/components/work/work-page-client.tsx`

Directly referenced work-page helpers reviewed:
- `src/components/work/work-page/conversation-feed.tsx`
- `src/components/work/work-page/work-page-copy.ts`
- `src/components/work/work-page/hero-approvals.tsx`
- `src/components/work/work-page/latest-result-closure.tsx`
- `src/components/work/work-page/use-work-page-controller.ts`
- `src/components/work/work-page/work-conversation-workbench.tsx`
- `src/components/work/work-page/workbench-composer-card.tsx`
- `src/components/work/work-page/work-page-formatters.ts`
- `src/components/work/work-page/work-page-selectors.ts`
- `src/components/work/work-page/work-page-types.ts`

Additional directly used components/data sources reviewed because they are imported from the entry flow:
- `src/components/work/execution-timeline.tsx`
- `src/components/work/latest-result-panel.tsx`
- `src/components/work/task-plan-side-panel.tsx`
- `src/modules/queries/get-work-page.ts`
- `src/app/actions/task-actions.ts`
- `src/app/api/work/[taskId]/projection/route.ts`
- `src/app/workspaces/[workspaceId]/work/[taskId]/page.tsx`

Observed current shape:
1. `WorkPageClient` already centers the page on a two-column workbench with:
   - main area: conversation/full-flow tabs
   - bottom composer
   - right rail: task plan
2. The data model already contains useful primitives:
   - `taskShell` with task metadata and schedule window
   - `taskPlan` with steps/current step
   - `currentRun` and `closure`
   - `conversation`, `workstreamItems`, `latestOutput`
3. But the experience is still run-driven, not task-driven:
   - composer mode is mostly derived from raw run status
   - task plan is visually secondary and somewhat generic
   - latest result / closure actions feel like a separate flow instead of part of the task lifecycle
   - schedule context exists in data but is barely surfaced in the main workbench
4. `currentIntervention` is built in `get-work-page.ts`, but the current UI barely uses it beyond composer defaults/passive guidance.
5. There is useful projection data that is currently unused in the page:
   - `workspaceRail`
   - `reliability`
   - parts of `inspector`
6. The current `buildTaskPlan` logic is still too template-like. It collapses all tasks into the same 4-step story (`understand-task`, `gather-context`, `execute-task`, `confirm-next-step`) unless richer plan events exist.

Key gap versus target product:
The page should answer, at a glance:
- What task are we advancing?
- What schedule slot/constraint are we honoring?
- What exact step is the Agent on now?
- What does the Agent need from me now?
- What is the latest useful output?
- What should happen next on this same page?

The current page answers some of these indirectly, but not as the dominant information hierarchy.

---

## Proposed approach

Refactor the work page into 4 explicit layers:

1. Task header / brief
   - Show title, lifecycle, run state, schedule state, and schedule window in a compact task brief.
   - Keep this above the tabs so the page always feels task-centric, not conversation-centric.

2. Current step rail
   - Promote `taskPlan.currentStep` into the primary right-rail object.
   - Make the rest of the plan a secondary progression list.
   - Add “what the Agent is doing / waiting on / next confirmation” language here.

3. Collaboration workspace
   - Make the default main tab the actual collaboration thread.
   - Merge current intervention context + conversation + approvals into the same workspace, instead of scattering them.
   - The composer should be framed as “advance current step” rather than generic “send message”.

4. Result + decision zone
   - Keep latest result, but present it as “latest deliverable for this task step”.
   - Closure actions should read as task decisions (`accept deliverable`, `mark step done`, `spawn follow-up`) not generic post-run cleanup.

This keeps scope fully inside the work page and does not require modifying schedule or other pages.

---

## Recommended data-model changes before UI work

### Task 1: Introduce a page-specific “task progress state” in the read model

Objective: Stop making every UI component infer task stage from raw run status.

Files:
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/components/work/work-page/work-page-types.ts`
- Modify: `src/components/work/work-page/work-page-selectors.ts`

Add a normalized field to returned data, for example:

```ts
progressState: {
  phase:
    | "not_started"
    | "planning"
    | "awaiting_input"
    | "awaiting_approval"
    | "executing"
    | "reviewing_result"
    | "done"
    | "needs_recovery";
  headline: string;
  summary: string;
  primaryActionLabel: string;
}
```

Rules should be centralized in `get-work-page.ts` using:
- `currentRun.status`
- `closure.isDone`
- `taskPlan.currentStepId`
- `blockReason`

Why this matters:
- `getWorkbenchComposer`
- header badges
- plan rail action text
- result CTA copy
can all rely on one stable abstraction.

Validation:
- Review all current branches in `getWorkbenchComposer`, `getTaskSummary`, `getCurrentException`, `getCurrentPlanAction` and ensure they can consume the new normalized state.

### Task 2: Enrich schedule context in the projection payload

Objective: Make schedule visible in the work page without editing the schedule page.

Files:
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/components/work/work-page/work-page-types.ts`

Add a small task-brief schedule object, for example:

```ts
taskBrief: {
  dueLabel: string | null;
  scheduledWindowLabel: string | null;
  scheduleRiskLabel: string | null;
}
```

Use already-available fields:
- `task.dueAt`
- `task.scheduledStartAt`
- `task.scheduledEndAt`
- `task.scheduleStatus`

Reason:
Current schedule data exists but lives too deep and is only translated into a badge/summary.

### Task 3: Make task plan explicitly support “current step card” semantics

Objective: Turn the plan rail into a strong current-step navigator.

Files:
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/components/work/work-page/work-page-types.ts`
- Modify: `src/components/work/task-plan-side-panel.tsx`

Extend each plan step with fields like:

```ts
{
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: ...;
  needsUserInput: boolean;
  guidance?: string | null;
  recommendedActionLabel?: string | null;
}
```

And compute a top-level shape such as:

```ts
taskPlan.currentStep: {
  id: string;
  title: string;
  objective: string;
  status: ...;
  whyNow: string;
  recommendedActionLabel: string | null;
}
```

Reason:
Today the side panel reconstructs too much on the fly and still feels like a static checklist.

---

## Recommended UI refactor

### Task 4: Replace the current workbench header with a real task brief card

Objective: Make the page read like “this task’s cockpit”, not “a chat app with a sidebar”.

Files:
- Modify: `src/components/work/work-page-client.tsx`
- Modify: `src/components/work/work-page/work-conversation-workbench.tsx`
- Create: `src/components/work/work-page/task-brief-card.tsx`

The card should show:
- task title
- task summary/headline
- lifecycle badge
- run badge
- schedule badge
- due date / scheduled window / runtime model if useful

Keep it compact and above the tabs.

### Task 5: Reframe the default tab as “协作推进” and merge intervention context into it

Objective: The main tab should help the user advance the current step immediately.

Files:
- Modify: `src/components/work/work-page-client.tsx`
- Create: `src/components/work/work-page/current-step-callout.tsx`
- Potentially reuse: `src/components/work/work-page/hero-approvals.tsx`

Inside the collaboration tab, top-to-bottom:
1. current-step/intervention callout
2. pending approvals if any
3. conversation feed

The current-step callout should surface:
- `currentIntervention.title`
- `currentIntervention.description`
- `currentIntervention.whyNow`
- evidence chips/list from `currentIntervention.evidence`

This uses data already returned but currently underutilized.

### Task 6: Tighten composer framing around current step advancement

Objective: Make input semantics task-step-centric.

Files:
- Modify: `src/components/work/work-page/workbench-composer-card.tsx`
- Modify: `src/components/work/work-page/work-page-selectors.ts`
- Modify: `src/components/work/work-page/work-page-copy.ts`

Changes:
- input label should reflect the current phase:
  - “补充执行要求”
  - “回复 Agent 所需信息”
  - “说明如何恢复任务”
  - “确认下一步推进方式”
- quick prompts should be tied to phase/current step instead of only run status
- passive mode should still show the next recommended action even when composer is hidden

### Task 7: Rework the right rail into “当前步骤 + 任务路径”

Objective: Make the plan rail feel active and operational.

Files:
- Modify: `src/components/work/task-plan-side-panel.tsx`
- Modify: `src/components/work/work-page/work-page-copy.ts`

Hierarchy in rail:
1. Current Step card (large, highlighted)
2. Blocking reason / why waiting
3. Primary action anchor
4. Remaining steps timeline

Current issues in the existing rail:
- “计划整体状态” is generic and not very actionable
- “重新规划后继续” is vague
- empty state says “占位计划”, which feels temporary rather than intentional

Replace with task-driven language like:
- 当前步骤
- Agent 正在处理
- 等待你补充
- 建议动作
- 后续步骤

### Task 8: Reframe latest result as a deliverable for the current task

Objective: Keep output review inside the same task loop.

Files:
- Modify: `src/components/work/latest-result-panel.tsx`
- Modify: `src/components/work/work-page/latest-result-closure.tsx`
- Modify: `src/components/work/work-page/work-page-copy.ts`

Changes:
- rename/retitle copy around “latest result” toward “latest deliverable / latest output for this step” if product language agrees
- show artifact/message source more clearly
- group actions into decisions:
  - accept deliverable
  - continue with refinements
  - mark task done
  - split follow-up

The current closure component is functionally useful but visually reads like a postscript.

### Task 9: Demote or simplify the “完整流程” tab

Objective: Keep the page focused on collaboration first.

Files:
- Modify: `src/components/work/work-page-client.tsx`
- Potentially modify: `src/components/work/execution-timeline.tsx`

Recommendation:
- Keep a second tab for execution history if needed, but rename it to something like “执行记录” instead of “完整流程”.
- This tab should contain:
  - result history / latest result section
  - execution timeline
- Avoid duplicating conversation and result context across tabs.

---

## Suggested implementation order

### Task 10: First pass — solve information hierarchy without changing actions

Objective: Re-layout existing data before changing behavior.

Files likely to change:
- `src/components/work/work-page-client.tsx`
- `src/components/work/work-page/work-conversation-workbench.tsx`
- `src/components/work/task-plan-side-panel.tsx`
- `src/components/work/work-page/workbench-composer-card.tsx`

Do first:
- add task brief card
- add current-step callout in main tab
- keep existing actions/server calls intact
- relabel tabs and sections

This gives a fast product win with low backend risk.

### Task 11: Second pass — normalize task-phase semantics in selectors/query

Objective: Remove brittle UI logic.

Files likely to change:
- `src/modules/queries/get-work-page.ts`
- `src/components/work/work-page/work-page-types.ts`
- `src/components/work/work-page/work-page-selectors.ts`

Do after the layout pass so you can clearly see duplicated condition logic.

### Task 12: Third pass — improve plan generation/read model quality

Objective: Make the plan rail truly useful.

Files likely to change:
- `src/modules/queries/get-work-page.ts`
- any command/projection builders that emit `task.plan_generated` / `task.plan_updated`

Current risk:
If emitted plan payloads remain generic, the rail will still feel placeholder-like even after UI improvements.

---

## Concrete component-level recommendations

### `WorkPageClient`

Keep:
- controller wiring
- action wiring
- one page-level orchestration component

Change:
- stop making “conversation/full-flow” the top-level conceptual split
- render a task brief above tabs
- collaboration tab should include current-step callout + approvals + conversation
- history tab should include result + timeline

### `useWorkPageController`

Keep:
- polling
- refresh strategy
- scoped action errors

Change later if needed:
- return a phase-aware submit helper name, but this is optional

### `work-page-selectors.ts`

This file should become the place for:
- normalized page phase
- task brief formatting
- composer framing
- quick prompt generation by step/phase

It should stop encoding product copy based mostly on raw run status.

### `task-plan-side-panel.tsx`

This is the most important UI to refactor after the header.

Keep:
- current step highlighting
- step status badges

Change:
- reduce generic meta text
- add clearer “what to do now” language
- align button labels with main workspace action

### `latest-result-closure.tsx`

Keep the existing actions because they map to real workflow needs.

Change:
- action grouping
- labels/copy
- visual hierarchy
- relation to current step

### `hero-approvals.tsx`

It is currently isolated and strong enough to reuse.

Use it inside the collaboration tab’s current-step block when waiting for approval.

---

## Tests / validation

No dedicated work-page component tests were found from the quick targeted search. Add focused tests for the refactor.

Recommended targets:
- `src/app/workspaces/[workspaceId]/work/[taskId]/page.test.tsx` for server page rendering smoke
- new component tests near work-page components, for example:
  - `src/components/work/work-page/__tests__/work-page-client.test.tsx`
  - `src/components/work/__tests__/task-plan-side-panel.test.tsx`
  - `src/components/work/work-page/__tests__/workbench-composer-card.test.tsx`

Minimum scenarios to cover:
1. no run yet -> task brief + start composer + empty conversation
2. waiting for input -> current-step callout + response composer
3. waiting for approval -> approval block rendered in collaboration tab
4. running -> observe/progress framing + notes composer
5. completed -> result review actions visible
6. done task -> reopen path still visible, composer passive/hidden as intended

If lightweight validation is needed, target only the relevant tests rather than a full repo build.

---

## Risks / tradeoffs

1. Query/UI coupling
   - If too much presentation logic stays in `get-work-page.ts`, iteration may slow.
   - If too little moves there, the UI will keep duplicating state derivation.
   - Recommended balance: return normalized task-phase data from query, keep display formatting in selectors.

2. Plan quality dependency
   - The better the plan event payload, the better the task rail.
   - If plan payloads remain shallow, the UI can only polish a weak model.

3. Tab duplication
   - The current structure duplicates “what matters now” across composer, plan rail, and result section.
   - Refactor must intentionally assign one owner per concern.

4. Scope creep into schedule/tasks pages
   - Avoid changing cross-page navigation or schedule editing flows now.
   - Only surface schedule context already present in work-page data.

---

## Recommended immediate first implementation slice

If you want the highest-leverage first change with minimal risk, do this slice first:

1. Create `task-brief-card.tsx`
2. Create `current-step-callout.tsx`
3. Update `WorkPageClient` to use:
   - task brief at top
   - collaboration tab = current step + approvals + conversation
   - history tab = latest result + execution timeline
4. Refactor `TaskPlanSidePanel` copy/structure to “当前步骤 + 任务路径”
5. Adjust `getWorkbenchComposer` and quick prompts so the composer language matches the current task phase

This will make the page feel task-driven immediately, even before deeper projection changes.
