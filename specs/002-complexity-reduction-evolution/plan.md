# Implementation Plan: Complexity Reduction And Evolution

**Branch**: `[002-complexity-reduction-evolution]` | **Date**: 2026-05-08 | **Spec**: `docs-from-repo-analysis`
**Input**: Current repository structure, task workspace refactor findings, and project-wide complexity analysis performed in this session

## Summary

This plan defines how Chrona should reduce frontend and workflow complexity now without flattening the domain model that the product will need later. The central decision is to simplify by separating concerns more aggressively, not by introducing a large global state layer. The highest-value infrastructure addition is `@tanstack/react-query` for server-state management. After that, the implementation path should continue with vertical-slice refactors, shared view-model mappers, and selective state-machine modeling for long-running workflows.

This is an implementation plan, not a code change. It records the recommended order, scope, constraints, and success criteria for future work.

## Technical Context

**Language/Version**: TypeScript strict, React 19, React Router 7, Hono 4.x, Bun runtime  
**Primary Dependencies**: Hono, Zod, Prisma, `@xyflow/react`, `@microsoft/fetch-event-source`, workspace `@chrona/*` packages  
**Storage**: SQLite via Prisma 7  
**Project Type**: Bun monorepo with SPA frontend, Hono API backend, shared contracts/runtime packages  
**Current Pain Point**: frontend feature slices, especially task workspace, mix server state, UI state, long-running workflow state, and view-model derivation inside the same components/hooks  
**Constraints**: preserve monorepo boundaries; no business logic in React components or Hono routes; shared contracts remain in `packages/contracts`; do not rewrite transport stack; avoid heavy global stores unless proven necessary

## Constitution Check

*GATE: Passed for planning. Re-check before implementation of each phase.*

- **Code Quality**: Passed. The plan reduces responsibility overlap instead of adding parallel abstractions.
- **Testing**: Passed. Each implementation phase below includes validation targets so simplification work does not become behavior drift.
- **User Experience Consistency**: Passed. The plan standardizes data flow and workflow handling without changing product concepts.
- **Performance Budgets**: Passed. The recommended packages and patterns improve caching, invalidation, and async handling rather than adding avoidable runtime overhead.

## Complexity Diagnosis

### Necessary Complexity

This complexity should remain because it reflects real product shape:

1. Task, plan, proposal, approval, runtime, AI generation, and graph are genuinely different concepts.
2. Shared contracts across frontend, backend, and runtime are correct for a monorepo of this shape.
3. Hono route boundaries with Zod validation are already reasonably thin and should stay thin.
4. Plan graph rendering and execution-preview behavior are a real subdomain, not accidental code weight.

### Accidental Complexity

This complexity should be reduced:

1. Components mix server-state fetch/update logic with local presentation state.
2. Polling, invalidation, accept/apply flows, and mutation refresh behavior are hand-managed repeatedly.
3. View-model shaping and state transformation logic are distributed across page files, hooks, and leaf components.
4. Long-running workflow state is modeled as ad hoc booleans instead of explicit flow boundaries.
5. Complex forms rely on manual dirty/default/reset bookkeeping.

### Current Hotspots

1. `apps/web/src/components/tasks/task-workspace-page.tsx` and surrounding task workspace slice.
2. Plan generation / accept / preview / AI workspace flows.
3. Task editing and proposal-application flows.
4. Any future execution-session or review workflow if it continues with boolean-driven state growth.

## Strategy Decisions

### Decision 1: Add `@tanstack/react-query`

This is the best single package to add now.

Why:

1. Chrona's main frontend complexity problem is server-state management, not global client-state sharing.
2. Task, plan, projection, and AI-generation flows all need cache ownership, invalidation, polling, mutation status, and refresh coordination.
3. React Query lets page components stop owning fetch loops and refresh orchestration manually.

What it should own:

1. Task detail queries.
2. Saved plan queries.
3. AI plan generation status polling.
4. Projection / summary refresh after mutations.
5. Mutation lifecycle for accept-plan, save-task, apply-proposal, delete-task, and similar actions.

### Decision 2: Do Not Add A Global Store First

Do not introduce `zustand`, Redux, MobX, or another project-wide client store as the first simplification step.

Reason:

1. The dominant pain is not cross-page client-state sharing.
2. A global store would centralize mixed concerns instead of separating them.
3. It would likely hide server-state problems rather than solve them.

### Decision 3: Add `react-hook-form` Later, Not First

`react-hook-form` is a good second-stage package, especially for task config and other complex forms.

Reason:

1. Manual form state currently adds noise around dirty tracking, defaults, and reset behavior.
2. It is valuable, but the bigger complexity payoff still comes from fixing server-state flow first.

### Decision 4: Use `xstate` Only For Real Workflow Engines

`xstate` should be introduced only for a few high-value workflows, not as a general state solution.

Good candidates:

1. AI plan generation and acceptance flow.
2. Proposal review/apply/cancel flow.
3. Future execution-session or human-review workflow.

Bad candidates:

1. Basic page-local UI toggles.
2. Simple edit forms.
3. Generic query/mutation state that React Query already handles well.

## Target Design Principles

### 1. Separate Server State From Client State

Server state:

- fetched task data
- plan data
- generation status
- projections
- mutation lifecycle

Client state:

- disclosure toggles
- selected graph node
- draft-only unsaved local input before submit
- transient layout state

Rule:

- If data can become stale because of API activity, it should move toward a query/mutation layer.
- If data exists only to drive the current screen interaction, it should stay local.

### 2. Continue Vertical-Slice Refactors

Prefer feature-local organization around task workspace and similar slices.

Recommended slice structure direction:

```text
apps/web/src/components/tasks/
|-- task-workspace-page.tsx
|-- task-workspace-plan-section.tsx
|-- task-workspace-header-card.tsx
|-- task-workspace-edit-section.tsx
|-- task-workspace-types.ts
|-- task-workspace-helpers.ts
|-- hooks/
|   |-- use-task-workspace-query.ts
|   |-- use-task-workspace-editor-state.ts
|   |-- use-task-workspace-plan-flow.ts
|   `-- use-task-workspace-proposal-flow.ts
`-- mappers/
    |-- task-workspace-view-model.ts
    `-- task-plan-view-model.ts
```

### 3. Centralize View-Model Mappers

Domain/read models should be adapted in a small number of known places.

Examples:

1. task read model -> page view model
2. task plan read model -> graph plan model
3. proposal payload -> diff preview view model

Benefits:

1. fewer repeated transformations
2. easier testing
3. easier API evolution when contracts change

### 4. Model Long-Running Flows Explicitly

Not every state transition needs a machine. But any flow with polling, retries, approval, cancellation, or resumability should stop being boolean soup.

Preferred progression:

1. first: isolate the flow into a dedicated hook/module
2. second: define explicit states/events in TypeScript
3. third: if still complex, move that flow to `xstate`

## Phased Implementation Plan

## Phase 1: Introduce React Query Foundation

**Status**: Completed in task workspace slice

Goal: move server-state ownership out of page components.

Tasks:

1. [x] Add `@tanstack/react-query` and app-level provider wiring in `apps/web/`.
2. [x] Define query key conventions for task, plan, projections, and AI generation status.
3. [x] Create feature-local query/mutation hooks for task workspace.
4. [x] Replace manual fetch/polling/invalidation logic in the task workspace slice.

Completed scope:

- `@tanstack/react-query` installed in `apps/web/`
- app-level `QueryClientProvider` wired in `apps/web/src/main.tsx`
- query client module added at `apps/web/src/lib/query-client.ts`
- task workspace query layer added at `apps/web/src/components/tasks/task-workspace-query.ts`
- task workspace editor and plan hooks migrated to query/mutation-backed server-state ownership
- task detail and plan-state caches synchronized to avoid drift after accept/update flows

Deliverables:

1. shared query client setup
2. task workspace query hooks
3. mutation hooks for save/accept/apply/delete flows

Validation:

1. `bun run typecheck`
2. targeted task workspace tests
3. manual verification of polling, refresh, and optimistic/non-optimistic mutation behavior

Expected payoff:

1. less duplicated fetch logic
2. fewer manual loading/error booleans
3. cleaner page-level components

## Phase 2: Finish Task Workspace Vertical Slice Cleanup

**Status**: Completed

Goal: shrink `task-workspace-page.tsx` into a composition shell.

Tasks:

1. [x] Extract `TaskWorkspaceHeaderCard`.
2. [x] Extract `TaskWorkspaceEditSection`.
3. [x] Extract proposal flow into its own hook/module.
4. [x] Extract delete flow into its own hook/module if it remains non-trivial.
5. [x] Move mapper logic into dedicated `mappers/` modules.

Completed scope:

- `TaskWorkspaceHeaderCard` extracted and now owns its local more-menu UI state
- `TaskWorkspaceEditSection` extracted from page-level inline JSX
- proposal apply/cancel flow extracted to `use-task-workspace-proposal-flow.ts`
- delete flow extracted to `use-task-workspace-delete-flow.ts`
- floating AI workspace mount/button extracted to `task-workspace-ai-section.tsx`
- editor-side view-model adaptation extracted to `apps/web/src/components/tasks/mappers/task-workspace-editor-view-model.ts`
- `task-workspace-helpers.ts` removed after mapper migration
- `TaskWorkspacePlanSection` layout measurement and node-selection state extracted to `use-task-workspace-plan-section-state.ts`
- graph/empty-state presentation extracted to `apps/web/src/components/tasks/task-workspace-plan-content.tsx`
- `task-workspace-page.tsx` reduced to a composition/orchestration shell of roughly 200 lines

Current next step:

- choose the next adoption target for the same slice pattern outside task workspace
- start Phase 3 only if repeated manual form lifecycle noise still blocks further cleanup

Target end state:

- `task-workspace-page.tsx` composes sections and hooks.
- business transitions live in hooks/query modules.
- presentational components stay mostly stateless.

Validation:

1. `bun run typecheck`
2. UI smoke verification on task workspace
3. targeted tests for extracted helper and mapper functions

Validation notes:

- task workspace smoke pass covered graph render, node selection + inspector sync, edit section expand/collapse, and AI workspace open/close
- smoke pass surfaced a pre-existing `404` on `/api/tasks/:taskId/assistant/messages` when opening AI workspace; not caused by the Phase 2 presentation refactor

## Phase 3: Standardize Complex Forms

**Status**: Completed

Goal: remove manual form lifecycle noise where it is repeated.

Tasks:

1. Add `react-hook-form` if task config and similar forms still carry manual dirty/reset/default complexity.
2. Migrate task config form first.
3. Define a consistent adapter pattern for Chrona forms that need runtime-driven fields.

Decision checkpoint:

- If existing form complexity remains manageable after Phase 1 and 2, this phase can be deferred.

Completed scope:

- confirmed `apps/web/src/components/schedule/forms/task-config-form.tsx` remained a major hotspot with repeated manual `useState` / reset / dirty tracking / runtime field update logic, so this phase was not deferred
- added `react-hook-form`
- migrated `TaskConfigForm` ownership of default values, reset behavior, submit wiring, and dirty-state tracking to RHF
- kept runtime-driven field rendering intact while moving field updates onto RHF `setValue(...)`
- standardized the adapter pattern around existing helpers:
  - `toFormState(...)` for server/input -> form defaults
  - `applyRuntimeAdapterChange(...)` for adapter-driven field transitions
  - `buildTaskConfigFormInput(...)` for form state -> submission payload

Validation notes:

- `bunx tsc --noEmit --pretty false` reported no new `task-config-form.tsx` errors after the RHF migration
- repo still contains unrelated existing failures outside this slice

Validation:

1. form reset/default behavior
2. dirty-state correctness
3. runtime-config nested field behavior

## Phase 4: Formalize Workflow Modules

**Status**: Completed

Goal: isolate long-lived business flows from generic page logic.

Tasks:

1. Define flow modules for AI plan generation and proposal application.
2. Represent states and transitions explicitly in TypeScript first.
3. Introduce `xstate` only if one of those flows still has high branch complexity after isolation.

Machine-first candidates:

1. AI plan generation: `idle -> generating -> waiting_acceptance -> accepted | failed`
2. proposal flow: `idle -> previewing -> applying | cancelling -> settled | failed`
3. future execution review flow with resume/pause/approval states

Completed scope:

- formalized task workspace proposal flow into `apps/web/src/components/tasks/task-workspace-proposal-flow-machine.ts`
- made proposal flow states explicit in TypeScript before introducing any external state-machine package:
  - `idle`
  - `previewing`
  - `applying`
  - `failed`
  - `settled`
- migrated `use-task-workspace-proposal-flow.ts` to drive transitions through the typed flow module while preserving page-level API compatibility
- formalized task workspace AI plan lifecycle into `apps/web/src/components/tasks/task-workspace-plan-flow-machine.ts`
- made AI plan states explicit in TypeScript while keeping the server-facing `TaskPlanGenerationStatus` contract stable:
  - `idle`
  - `generating`
  - `waiting_acceptance`
  - frontend-local `accepting`
  - `accepted`
  - frontend-local `failed`
- migrated `use-task-workspace-plan-state.ts` to drive accept/retry/error handling through the typed flow module while preserving page-level API compatibility
- confirmed `xstate` is still unnecessary at this stage because both proposal flow and AI plan flow are now isolated without extra package overhead

Result:

- no remaining Phase 4 branch pressure currently justifies `xstate`
- future execution review flow remains a candidate only if its branching grows beyond typed-hook/module boundaries

Validation notes:

- `bunx tsc --noEmit --pretty false` reported no new errors in `use-task-workspace-proposal-flow.ts` or `task-workspace-proposal-flow-machine.ts`
- `bunx tsc --noEmit --pretty false` also reported no new errors in `use-task-workspace-plan-state.ts` or `task-workspace-plan-flow-machine.ts`
- repo still contains unrelated existing failures outside this slice

Validation:

1. branch coverage on flow transitions
2. retry/failure path verification
3. reduced boolean count in consuming components

## Phase 5: Broader Adoption Across Other Slices

**Status**: Completed

Goal: reuse proven patterns instead of inventing per-screen conventions.

Apply successful patterns from task workspace to:

1. schedule pages
2. work panels / side panels
3. projections and run-status views

Only scale patterns that proved simpler in task workspace first.

Current adoption focus:

- `apps/web/src/components/work/*`
- `apps/web/src/components/schedule/*`

Completed scope:

- extracted shared card shell to `apps/web/src/components/work/work-page/work-page-section-frame.tsx`
- extracted workbench header presentation to `apps/web/src/components/work/work-page/work-page-header-card.tsx`
- extracted tabbed main-area presentation to `apps/web/src/components/work/work-page/work-page-main-tabs.tsx`
- extracted right-rail presentation to `apps/web/src/components/work/work-page/work-page-right-rail.tsx`
- extracted bottom composer dock and execution prompt banner to `apps/web/src/components/work/work-page/work-page-composer-dock.tsx`
- reduced `apps/web/src/components/work/work-page-client.tsx` to roughly 190 lines as orchestration shell over controller/selectors/presentational sections
- extracted projection refresh/polling/composer-reset responsibilities from `apps/web/src/components/work/work-page/use-work-page-controller.ts` into `apps/web/src/components/work/work-page/use-work-page-projection-state.ts`
- reduced `use-work-page-controller.ts` to action orchestration and workbench submit logic over the extracted projection hook
- extracted hero/result action orchestration from `apps/web/src/components/work/work-page/use-work-page-controller.ts` into `apps/web/src/components/work/work-page/use-work-page-actions.ts`
- kept pending/error state ownership in `use-work-page-controller.ts` so polling pause semantics remain aligned with `use-work-page-projection-state.ts`
- reduced `use-work-page-controller.ts` to a composition hook over projection state plus action orchestration
- extracted `WorkInspector` section rendering from `apps/web/src/components/work/work-inspector.tsx` into `apps/web/src/components/work/work-inspector-sections.tsx`
- reduced `work-inspector.tsx` to tab state, keyboard focus management, and panel shell rendering
- extracted hydrated projection, refresh orchestration, and local schedule UI state from `apps/web/src/components/schedule/schedule-page.tsx` into `apps/web/src/components/schedule/use-schedule-page-state.ts`
- reduced `schedule-page.tsx` to view-model composition plus action wiring over the extracted state hook, shrinking it to roughly 370 lines
- extracted schedule drag/drop, task mutation, and queue interaction wiring from `apps/web/src/components/schedule/schedule-page.tsx` into `apps/web/src/components/schedule/use-schedule-page-actions.ts`
- reduced `schedule-page.tsx` further to roughly 250 lines as a composition shell over state, view-model, and action hooks

Result:

- broad-adoption goal is satisfied across both `work/*` and `schedule/*` slices without introducing a new general-purpose state layer
- remaining candidates such as deeper `schedule-page-main-panel.tsx` / `schedule-page-sidebar.tsx` splitting and a dedicated `submitWorkbenchInput(...)` flow helper are intentionally skipped for now because payoff is lower than the complexity already removed in the completed slices

Validation notes:

- `bunx tsc --noEmit --pretty false` still reports existing repo failures, but no new runtime-component errors were introduced by the work-page slice extraction
- remaining `work-page` typecheck output is from existing test fixtures and pre-existing controller typing, not from the new presentation split
- `bunx tsc --noEmit --pretty false` also reported no new errors in `use-work-page-controller.ts` or `use-work-page-projection-state.ts` after the projection-hook extraction
- `bunx tsc --noEmit --pretty false` also reported no new errors in `use-work-page-controller.ts` or `use-work-page-actions.ts` after the action-hook extraction
- `bunx tsc --noEmit --pretty false` also reported no new errors in `work-inspector.tsx` or `work-inspector-sections.tsx` after the section extraction
- `bunx tsc --noEmit --pretty false` also reported no new errors in `schedule-page.tsx` or `use-schedule-page-state.ts` after the schedule state-hook extraction
- `bunx tsc --noEmit --pretty false` also reported no new errors in `schedule-page.tsx`, `use-schedule-page-state.ts`, or `use-schedule-page-actions.ts` after the schedule action-hook extraction

## Package Adoption Guidance

### Add Now

1. `@tanstack/react-query`

### Add Later If Needed

1. `react-hook-form`
2. `xstate`

### Do Not Add As First Response

1. `zustand`
2. Redux Toolkit
3. MobX
4. transport-stack rewrites such as replacing current API usage wholesale

## Success Metrics

Track simplification by outcome, not package count.

### Structural Metrics

1. `task-workspace-page.tsx` becomes primarily composition and routing glue.
2. server-state logic moves into query/mutation hooks.
3. mapper modules become the primary place for read-model adaptation.
4. long-running workflows stop expanding through scattered booleans.

### Developer Experience Metrics

1. adding a new mutation requires fewer manual refresh steps
2. polling behavior is configured centrally rather than hand-coded repeatedly
3. feature changes touch fewer unrelated files
4. tests target hooks/mappers/flows more directly

### Risk Metrics

1. fewer stale-data bugs after mutation
2. fewer regressions from duplicated transformation logic
3. fewer layout bugs caused by unrelated state ownership in large page files

## Risks And Mitigations

### Risk: Adding React Query But Keeping Old Patterns

Mitigation:

1. migrate one vertical slice completely before partial adoption elsewhere
2. define query-key and invalidation conventions early

### Risk: Over-modeling With State Machines

Mitigation:

1. start with explicit flow hooks and typed transitions
2. add `xstate` only when a flow has real branching pressure

### Risk: Refactor Churn Without Product Gain

Mitigation:

1. tie each phase to one hotspot
2. require measurable reduction in file responsibility overlap
3. keep changes incremental and shippable

## Recommended Execution Order

1. [x] Add `@tanstack/react-query` and migrate task workspace server state.
2. [x] Finish splitting task workspace into composition shell + focused hooks/components.
3. [x] Evaluate whether task config form still justifies `react-hook-form`.
4. [x] Promote one or two long-running workflows to explicit flow modules.
5. [x] Only then expand the pattern to other slices.

## Artifact Location

This plan lives at:

- `specs/002-complexity-reduction-evolution/plan.md`

## Complexity Tracking

This plan intentionally avoids adding a general-purpose state layer as a reflex. The simplification strategy is:

1. remove responsibility overlap first
2. add server-state infrastructure second
3. introduce specialized workflow/form tools only where complexity is proven
