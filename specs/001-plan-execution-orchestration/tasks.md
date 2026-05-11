---

description: "Task list for plan execution orchestration implementation"
---

# Tasks: Plan Execution Orchestration

**Input**: Design documents from `/specs/001-plan-execution-orchestration/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/current-api-surfaces.md`, `quickstart.md`

**Tests**: Automated coverage is required by the spec for plan generation/editing, work-block scheduling and start, automatic step advancement, missing-input pause and resume, review outcomes, and continuation across later work blocks.

## Format: `[ID] [P?] [Area] Description`

- **[P]**: Can run in parallel after dependencies are satisfied
- **[Area]**: Delivery area for traceability (`[Archive]`, `[Execution]`, `[Scheduling]`, `[Planning]`, `[Polish]`)
- Every task includes an exact repo path when the target is already known

## Calibration Notes (2026-05-11)

- This file was recalibrated against the current monorepo layout.
- The original checklist mixed real gaps with stale bookkeeping from old `packages/runtime/...` paths.
- Clear completed work is now archived instead of left inline with unfinished items.
- The active plan below is the source of truth for remaining implementation work.

---

## Archive: Completed Work

**Purpose**: Preserve what is already shipped or clearly implemented so future work only tracks open gaps.

### Foundation Archived

- [X] T001 [Archive] Added shared execution-orchestration sample fixtures in `apps/server/src/__tests__/api/plan-execution-fixtures.ts`
- [X] T002 [P] [Archive] Exported feature contract entry points from `packages/contracts/src/index.ts`
- [X] T003 [P] [Archive] Centralized work-state terminology for the UI in `apps/web/src/components/work/work-page/work-page-copy.ts`
- [X] T004 [Archive] Extended execution-layer persistence for `WorkBlock`, `ExecutionSession`, and step review metadata in `prisma/schema.prisma`
- [X] T005 [Archive] Regenerated Prisma exports for the new execution-layer models in `packages/db/src/generated/prisma/models.ts`
- [X] T006 [P] [Archive] Added provider-neutral work-block and execution-session contracts in `packages/contracts/src/ai.ts`
- [X] T007 [Archive] Added execution-layer repository exports in `packages/db/src/index.ts`
- [X] T008 [Archive] Established shared task/work projection state mapping in `packages/engine/src/modules/projections/rebuild-task-projection.ts`

### User Story 1 Archived

- [X] T010 [P] [Archive] Extended structured plan generation coverage in `packages/engine/src/modules/plans/generate-task-plan-for-task.bun.test.ts`
- [X] T015 [P] [Archive] Supported structured plan editing and save operations in `apps/server/src/routes/tasks/plan.routes.ts`
- [X] T018 [P] [Archive] Showed readiness, dependency, and execution-type detail in `apps/web/src/components/task/plan/task-plan-graph/inspector-details.tsx`

### User Story 2 Archived

- [X] T020 [P] [Archive] Extended scheduled auto-start coverage in `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts`
- [X] T022 [Archive] Added first-class `WorkBlock` schema and task/plan linkage in `prisma/schema.prisma`
- [X] T023 [Archive] Implemented work-block persistence helpers in `packages/db/src/work-block-repository.ts`
- [X] T025 [Archive] Evaluated scheduled work-block starts from the next eligible plan step in `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.ts`
- [X] T026 [Archive] Continued consecutive automatic steps and stopped on provider-neutral blocking conditions in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T027 [Archive] Exposed work-block scheduling and manual-start APIs in `apps/server/src/routes/tasks/execution.routes.ts`
- [X] T030 [P] [Archive] Surfaced active execution state and manual-start entry points in `apps/web/src/components/work/work-page-client.tsx`

### User Story 3 Archived

- [X] T034 [Archive] Added first-class `ExecutionSession` persistence and review-state fields in `prisma/schema.prisma`
- [X] T035 [Archive] Implemented execution-session persistence helpers in `packages/db/src/execution-session-repository.ts`
- [X] T037 [P] [Archive] Resumed paused execution from provided step input in `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- [X] T039 [Archive] Exposed execution-session resume and step-review APIs in `apps/server/src/routes/tasks/execution.routes.ts`

**Archived Result**: core graph runtime, execution persistence, scheduler auto-start, plan save flow, and basic work-page execution entry points are already in place.

---

## Active Plan: Remaining Work

**Purpose**: Deliver the missing product loop on top of the existing execution engine, instead of redoing already-shipped infrastructure.

**Recommended Delivery Order**:
1. Close execution review and continuation flow first.
2. Close schedule/work surface gaps second.
3. Finish plan metadata and plan-page closure third.
4. End with end-to-end validation and polish.

### Phase A: Execution Review And Continuation

**Goal**: Make paused, blocked, and review-required runs recoverable and understandable from API through UI.

**Independent Test**: Run a mixed auto/manual plan, pause on missing input or review, resume it later, and verify timeline and current-node state stay consistent.

- [ ] R001 [P] [Execution] Add API coverage for pause, review, and continuation flows in `apps/server/src/__tests__/api/plan-execution-review-workflow.bun.test.ts`
Old refs: `T031`
- [ ] R002 [P] [Execution] Extend resumable execution-session coverage around session policy, current node, and later-session restore in `packages/engine/src/modules/plan-execution/`
Old refs: `T032`, `T036`, `T040`
- [ ] R003 [Execution] Standardize final review outcomes for accept, reject, and request-changes in the execution settlement path under `packages/engine/src/modules/plan-execution/`
Old refs: `T038`
- [ ] R004 [P] [Execution] Add work-inspector UI coverage plus missing-input, review, and resume controls in `apps/web/src/components/work/work-inspector.test.tsx` and `apps/web/src/components/work/work-inspector.tsx`
Old refs: `T033`, `T041`
- [ ] R005 [P] [Execution] Restore later-session progress, next-action history, and continuation context in `apps/web/src/components/work/execution-timeline.tsx`
Old refs: `T042`

**Exit Criteria**:
- Paused reason and current node are stable across reloads.
- Review-required outputs can be accepted, rejected, or sent back for changes.
- Work inspector exposes the next action without requiring graph-panel-only interaction.

### Phase B: Scheduling And Work Surface Closure

**Goal**: Make schedule-driven work blocks a first-class operational surface, not only an engine capability.

**Independent Test**: Schedule a plan-backed task, observe an actionable work block in schedule/work views, start it manually or let auto-start pick it up, and see explicit blocking reasons when it cannot advance.

- [ ] R006 [P] [Scheduling] Add API coverage for work-block scheduling and intelligent start in `apps/server/src/__tests__/api/work-block-execution-workflow.bun.test.ts`
Old refs: `T019`
- [ ] R007 [Scheduling] Replace remaining task-window-oriented scheduling writes with work-block creation in `packages/engine/src/modules/scheduling/apply-schedule.ts`
Old refs: `T024`
- [ ] R008 [Scheduling] Distinguish actionable work blocks from normal calendar events in `packages/engine/src/modules/scheduling/get-schedule-page.ts`
Old refs: `T028`
- [ ] R009 [P] [Scheduling] Add schedule-page coverage for actionable work blocks in `apps/web/src/components/schedule/schedule-page.test.tsx`
Old refs: `T021`
- [ ] R010 [Scheduling] Show work-block status, blocking reason, and start controls in `apps/web/src/components/schedule/schedule-page-timeline.tsx`
Old refs: `T029`

**Exit Criteria**:
- Schedule API and UI clearly separate actionable work blocks from ordinary events.
- Users can see why a start is blocked before opening deep task details.
- Manual start and scheduler start behave consistently against the same work-block model.

### Phase C: Plan Metadata And Plan Surface Closure

**Goal**: Finish the structured-plan product surface so saved plans fully expose the metadata already partially present in runtime and graph views.

**Independent Test**: Generate a plan, review and edit its metadata from the main task surface, save it, reload it, and confirm the same enriched fields drive later execution decisions.

- [ ] R011 [P] [Planning] Extend plan lifecycle API coverage in `apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts`
Old refs: `T009`
- [ ] R012 [Planning] Add required-information, dependency, execution classification, and next-action fields to the authoritative plan contracts in `packages/contracts/src/ai.ts` or the current equivalent plan-runtime contract file
Old refs: `T012`
- [ ] R013 [Planning] Normalize and persist enriched plan-node metadata in the current plan graph persistence layer under `packages/engine/src/modules/plans/`
Old refs: `T013`
- [ ] R014 [Planning] Update plan generation output shaping in the current plan generation pipeline under `packages/engine/src/modules/plans/`
Old refs: `T014`
- [ ] R015 [Planning] Expose enriched plan-state reads from the task plan routes in `apps/server/src/routes/tasks/`
Old refs: `T016`
- [ ] R016 [P] [Planning] Add plan review and editing UI coverage in the current task-page test surface under `apps/web/src/components/task/`
Old refs: `T011`
- [ ] R017 [Planning] Render editable plan-step metadata and recommended next actions on the main task plan surface under `apps/web/src/components/task/`
Old refs: `T017`

**Exit Criteria**:
- The main task plan surface, not only the graph inspector, exposes the saved enriched plan metadata.
- Plan metadata returned by API matches the persisted graph/runtime source of truth.
- Generation, edit, save, and reload use the same field model.

### Phase D: Validation And Cross-Cutting Polish

**Goal**: Lock the feature down with scenario coverage, consistent state display, and final validation notes.

- [ ] R018 [Polish] Update implementation guidance and follow-up docs in `specs/001-plan-execution-orchestration/quickstart.md`
Old refs: `T043`
- [ ] R019 [Polish] Add end-to-end curated scenario coverage for product launch and competitor research in `apps/server/src/__tests__/api/plan-execution-sample-scenarios.bun.test.ts`
Old refs: `T044`
- [ ] R020 [P] [Polish] Align execution-state badge rendering across plan, schedule, and work surfaces in `apps/web/src/components/ui/status-badge.tsx`
Old refs: `T045`
- [ ] R021 [P] [Polish] Add regression coverage for unavailable execution capability blocking in `apps/server/src/routes/__tests__/task-execution-runtime.bun.test.ts`
Old refs: `T046`
- [ ] R022 [Polish] Run `bun run typecheck`, `bun run lint`, and `bun run test`, then record validation notes in `specs/001-plan-execution-orchestration/quickstart.md`
Old refs: `T047`

**Exit Criteria**:
- One end-to-end scenario proves the full loop from plan to execution continuation.
- Status rendering is consistent across task, schedule, and work surfaces.
- Final validation commands and known caveats are recorded.

---

## Dependency Graph

- `Phase A -> Phase B -> Phase D`
- `Phase A -> Phase C -> Phase D`
- Phase B depends on the execution state model from Phase A for clear blocking/review messaging.
- Phase C can start in parallel with late Phase A backend work, but should not close before the execution state contract settles.

## Parallel Opportunities

- Phase A: `R001`, `R002`, and `R004` can run in parallel once the target execution-state contract is agreed.
- Phase B: `R006` and `R009` can run in parallel; `R007` and `R008` can run in parallel before `R010`.
- Phase C: `R011` and `R016` can run in parallel; `R012`, `R013`, and `R014` can run in parallel after the field model is agreed.
- Phase D: `R018`, `R020`, and `R021` can run in parallel.

## Recommended Next Slice

1. Start `R001` and `R002` together to lock down the real execution-state contract.
2. Implement `R003` next so review outcomes stop being fragmented.
3. Finish `R004` and `R005` to expose the continuation loop in the work UI.
4. Only then move to schedule/work surface closure in Phase B.

## Notes

- Do not reopen archived items unless new evidence shows a regression.
- For any remaining item that still points at a moved implementation area, update the path when the work starts instead of reintroducing `packages/runtime/...` placeholders.
- This file now functions as an active delivery plan, not a historical dump of every originally proposed task.
