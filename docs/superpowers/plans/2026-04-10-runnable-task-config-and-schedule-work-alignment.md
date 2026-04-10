# Runnable Task Config + Schedule/Work Alignment Plan

> **For agentic workers:** Use an execution-oriented workflow. Complete one task at a time, verify after each major step, and keep the product boundary intact: `Schedule` owns planning/configuration, `Work` owns execution/collaboration.

**Goal:** Make tasks actually runnable by adding minimal runtime configuration, move core task creation/configuration into `Schedule`, keep `Work` focused on execution + collaboration, and demote `Task` into a secondary detail surface without rewriting the current app structure.

**Architecture:** Keep the existing `Next.js + Prisma + SQLite` application and current command -> event -> projection flow. Extend the `Task` model with runnable-task configuration (`model`, `prompt`, minimal runtime params), expose that config primarily on `Schedule`, let `Work` consume the resulting task/run context, and keep `Task Page` as a deep-linkable advanced editor / detail surface rather than a primary workflow destination.

**Tech Stack:** `Next.js` App Router, `React 19`, `TypeScript`, `Bun`, `Prisma`, `SQLite`, `Vitest`, `Testing Library`, `Playwright`

---

## Scope Notes

- This plan extends `docs/superpowers/plans/2026-04-09-schedule-first-mvp-alignment.md`; it does not replace the schedule-first direction.
- Do not rewrite the product into a chat-first or admin-first app.
- MVP release quality is gated by two loops:
  - `Schedule`: create task, configure task, arrange task
  - `Work`: run task, observe output, intervene/collaborate
- Keep provider/backend choice out of the main MVP task form unless the backend already requires explicit user choice.
- Templates should start lightweight: starter presets and duplicate-task flows before a full template library.
- Preserve the current `Task` route as a deep link / advanced detail surface even if it is removed from primary navigation.

## Product Boundary To Preserve

### `Schedule`
- Primary planning surface
- Primary task creation surface
- Primary core runtime-config surface
- Supports `Timeline / Queue / List` views over the same task set

### `Work`
- Primary execution surface
- Primary output-observation surface
- Primary AI collaboration / intervention surface
- Must not become a second planning/configuration hub

### `Task`
- Secondary detail surface
- Deep-linkable
- Used for advanced editing, heavy metadata, or low-frequency controls that do not fit inline in `Schedule`

---

## File Structure

### Existing Files To Modify

- `prisma/schema.prisma`: add runnable-task configuration fields and optional lightweight template/preset support.
- `prisma/seed.ts`: seed at least one runnable configured task plus one minimally configured draft task.
- `src/app/actions/task-actions.ts`: expose actions for creating/updating runnable task config from `Schedule`.
- `src/modules/commands/create-task.ts`: align task creation with runnable-config defaults.
- `src/modules/commands/update-task.ts`: support updating runtime-config fields cleanly.
- `src/modules/queries/get-schedule-page.ts`: include runnable-config summary, list-view data, and “ready to run” state.
- `src/modules/queries/get-task-page.ts`: reshape task-detail data so the page can become secondary/advanced.
- `src/modules/queries/get-work-page.ts`: ensure work page gets the task/run config context it needs without owning planning writes.
- `src/app/schedule/page.tsx`: wire Schedule view modes and any additional schedule-level state.
- `src/components/schedule/schedule-page.tsx`: absorb core task creation/configuration UI and list-view switching.
- `src/components/schedule/schedule-editor-form.tsx`: either narrow back to schedule-only concerns or split shared task-config fields out.
- `src/components/tasks/task-page.tsx`: reduce the page to secondary detail / advanced editor semantics.
- `src/components/work/work-page-client.tsx`: reinforce output + collaboration as the dominant workbench flow.
- `src/modules/ui/navigation.ts`: reflect the intended primary navigation if `Tasks` is demoted.
- `src/components/__tests__/control-plane-shell.test.tsx`: cover nav changes if they change.
- `src/components/schedule/__tests__/schedule-page.test.tsx`: cover config UI, list view, and runnable-task affordances.
- `src/components/tasks/__tests__/task-page.test.tsx`: cover the reduced/secondary task-detail semantics.
- `src/components/work/__tests__/work-page.test.tsx`: cover execution/collaboration-first semantics.
- `README.md`: update if the user-facing workflow changes materially during implementation.

### New Files To Create

- `src/components/schedule/task-config-form.tsx`: reusable minimal runtime-config form (`model`, `prompt`, minimal runtime params).
- `src/components/schedule/schedule-task-list.tsx`: Schedule list view for bulk scanning and editing.
- `src/modules/tasks/derive-task-runnability.ts`: central rule for whether a task is “ready to run”.
- `src/modules/tasks/__tests__/derive-task-runnability.test.ts`: lock runnability rules.
- `src/modules/commands/__tests__/runnable-task-config.bun.test.ts`: cover create/update config behavior.
- `src/modules/queries/__tests__/get-schedule-page-runnable-state.bun.test.ts`: verify schedule query exposes runnable/config state correctly.
- `src/components/tasks/task-detail-panel.tsx` *(optional extraction)*: if the Task detail UI needs to be shared as drawer/panel and page.

### Generated Files

- `src/generated/prisma/**`: regenerate after schema changes. Do not hand-edit.

---

## Task 1: Add Runnable Task Configuration To The Domain Model

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/commands/create-task.ts`
- Modify: `src/modules/commands/update-task.ts`
- Create: `src/modules/tasks/derive-task-runnability.ts`
- Create: `src/modules/tasks/__tests__/derive-task-runnability.test.ts`
- Create: `src/modules/commands/__tests__/runnable-task-config.bun.test.ts`
- Regenerate: `src/generated/prisma/**`

- [x] Define the minimum runnable-task config contract.
  - Include at least:
    - `model`
    - `prompt / instructions`
    - one minimal runtime-params escape hatch (structured fields or a constrained JSON blob)
  - Do **not** expose provider/backend as a required field unless backend reality forces it.

- [x] Write the failing domain tests for runnability.
  - Cover at minimum:
    - no model => not runnable
    - no prompt => not runnable
    - model + prompt => runnable
    - optional advanced params do not block runnability when absent

- [x] Extend the schema and command layer to persist the config.

- [x] Ensure create/update commands normalize and validate the config.
  - Trim prompt text.
  - Reject empty required values.
  - Keep defaults small and explicit.

- [x] Regenerate Prisma client and run targeted domain tests.

---

## Task 2: Surface Runnable Config On Schedule

**Files:**
- Modify: `src/app/actions/task-actions.ts`
- Modify: `src/modules/queries/get-schedule-page.ts`
- Modify: `src/app/schedule/page.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify or Split: `src/components/schedule/schedule-editor-form.tsx`
- Create: `src/components/schedule/task-config-form.tsx`

- [x] Add server actions for creating/updating task config from `Schedule`.

- [x] Build a reusable Schedule-side config form.
  - Minimum inputs:
    - title
    - priority
    - model
    - prompt / instructions
    - due date (if already part of the flow)
  - Keep advanced fields collapsed.

- [x] Make Schedule the primary place to create a runnable task.
  - A newly created task should be configurable and schedulable without forcing navigation to `Task`.

- [x] Expose a visible runnable-state summary in Schedule.
  - Examples:
    - `Ready to run`
    - `Needs model`
    - `Needs prompt`

- [x] Preserve inline timeline creation flows.
  - If a user creates from the timeline, they should still land in a usable config path without losing placement.

---

## Task 3: Add Schedule List View As The Task-Center Successor

**Files:**
- Modify: `src/modules/queries/get-schedule-page.ts`
- Modify: `src/components/schedule/schedule-page.tsx`
- Create: `src/components/schedule/schedule-task-list.tsx`

- [x] Add a `List` view inside `Schedule`, alongside timeline-oriented planning.

- [x] Ensure the list view supports the most important triage slices:
  - `Running`
  - `WaitingForApproval`
  - `Blocked`
  - `Failed`
  - `Unscheduled`
  - `Overdue`
  - `Not runnable`

- [x] Let users perform lightweight edits from the list view.
  - priority
  - due date
  - runnable-config completeness
  - open detail / open work

- [x] Do not create a second, disconnected task-management paradigm; this list must feel like a view of the same planning system.

---

## Task 4: Demote Task Page To Secondary Detail

**Files:**
- Modify: `src/modules/queries/get-task-page.ts`
- Modify: `src/components/tasks/task-page.tsx`
- Modify: `src/modules/ui/navigation.ts`
- Create (optional): `src/components/tasks/task-detail-panel.tsx`

- [x] Remove any assumption that `Task Page` is the primary place to start work.

- [x] Keep `Task Page` useful for:
  - deep linking
  - advanced metadata
  - low-frequency edits
  - history/context that would clutter Schedule

- [x] If top-level nav still exposes `Tasks`, either:
  - demote it visually/semantically, or
  - replace it with Schedule list view in primary flow

- [x] Keep links from Schedule -> Task Detail and Work -> Task Detail intact.

---

## Task 5: Tighten Work Into An Execution + Collaboration Workbench

**Files:**
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/components/work/work-page-client.tsx`

- [x] Ensure `Work` clearly answers:
  - what is running
  - what just happened
  - what needs human intervention now

- [x] Keep schedule/config editing out of the main Work loop.
  - Work may display task config context.
  - Work may deep-link back to Schedule.
  - Work should not become a second place for broad planning edits.

- [x] Make output and AI collaboration the main visual priority.

- [x] Preserve approvals, input requests, artifacts, and tool activity as supporting execution context.

---

## Task 6: Add Lightweight Templates / Presets

**Files:**
- Modify: `src/app/actions/task-actions.ts`
- Modify: `src/components/schedule/task-config-form.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Optional schema updates if presets are persisted

- [x] Start with the smallest useful version:
  - 2-4 starter presets, or
  - duplicate an existing task

- [x] Ensure presets accelerate creation without introducing a heavy template-management UI.

- [x] Defer full “save as template / template library / template governance” unless MVP is otherwise complete.

---

## Task 7: Verify The Whole Product Boundary

**Files:**
- Modify: `src/components/schedule/__tests__/schedule-page.test.tsx`
- Modify: `src/components/tasks/__tests__/task-page.test.tsx`
- Modify: `src/components/work/__tests__/work-page.test.tsx`
- Modify: `src/components/__tests__/control-plane-shell.test.tsx`
- Optional: `e2e/*.spec.ts`

- [x] Add/component tests for:
  - Schedule creates a runnable task
  - Schedule shows runnability state
  - Schedule list view exposes task triage cleanly
  - Task page behaves like secondary detail
  - Work emphasizes output + collaboration

- [x] Add at least one end-to-end happy path:
  - create task in Schedule
  - configure model/prompt
  - schedule it
  - open Work
  - observe output / collaboration surface

- [x] Run targeted tests and fix regressions before broader polish.

- [x] Handle canonical Task/Work routing after verification.
  - Redirect workspace-mismatch deep links to the canonical Task / Work URL instead of returning `404`.

---

## Suggested Execution Order

1. Task 1 — domain model + runnability rules
2. Task 2 — Schedule config UI
3. Task 3 — Schedule list view
4. Task 4 — Task page demotion
5. Task 5 — Work page tightening
6. Task 6 — lightweight presets
7. Task 7 — verification + e2e

## Done Criteria

This phase is complete when:

- a task can be made runnable without leaving `Schedule`
- `Schedule` clearly owns planning + core config
- `Work` clearly owns execution + collaboration
- `Task` is no longer required as a main navigation step
- users can manage tasks through `Timeline / Queue / List` views in `Schedule`
- the core plan-to-execute flow is covered by tests
