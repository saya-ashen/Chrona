# Task Workspace Mission Control Implementation Plan

## Scope

Implement the mission-control and trust UX in small PRs. Keep each PR reviewable, independently testable, and safe against execution-engine regressions.

Do not change database schema in this plan. Do not change provider protocol semantics. State derivation and UI copy can change; execution behavior changes must stay within existing contracts unless a later approved plan says otherwise.

## PR 1 — Shared work-state view model

### Goal

Create one page-independent state contract for task/work execution labels, tones, stages, primary actions, and disabled reasons.

### Files

- `features/task-workspace/model/task-workspace-interaction.ts`
- `features/task-workspace/model/task-workspace-operation-machine.ts`
- `packages/domain/src/task/derive-task-execution-state.ts`
- `packages/engine/src/modules/tasks/get-task-header.ts`
- `packages/ui-protocol/src/builders/build-task-header-spec.ts`
- `apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.ts`
- tests under `features/task-workspace/tests/`, `packages/domain/src/task/`, `packages/engine/src/modules/tasks/`, and adapter tests.

### Change

- Add `WorkStateView` or equivalent pure model.
- Map backend facts to canonical product states:
  - `no_plan`, `planning`, `plan_review`, `ready_to_run`, `queued`, `running`, `waiting_for_input`, `waiting_for_approval`, `blocked`, `failed`, `cancelled`, `result_ready`, `done`.
- Route header, assistant sidebar, stage bar, and operation card through this model.
- Keep `Completed` and `Done` separate:
  - completed run -> `result_ready`;
  - accepted/closed task -> `done`.
- Keep waiting-for-input distinct from waiting-for-approval.

### Acceptance criteria

- Same task facts produce same label, tone, next action, and disabled reason in header, sidebar, and workspace stage bar.
- No raw `No action available` appears for result-ready tasks.
- No generic `Needs handling` appears for approval/input/failure states.

### Tests

- Table-driven model tests for all canonical states.
- Header builder tests for result-ready, done, waiting input, waiting approval, failed, blocked, cancelled.
- Sidebar adapter tests for the same states.
- Existing targeted command:
  - `bunx vitest run features/task-workspace/tests/task-workspace-interaction.test.ts apps/web/src/components/tasks/workspace/adapters/task-ai-sidebar-adapter.test.ts`
- Engine/domain tests:
  - `bun test packages/engine/src/modules/tasks/get-task-header.bun.test.ts packages/domain/src/task/*.bun.test.ts`
- `bun run typecheck`.

## PR 2 — Mission-control layout and golden states

### Goal

Refactor the task workspace into a clear mission-control layout: header, lifecycle stage, current operation, focused graph/details, result review, grouped activity.

### Files

- `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx`
- `apps/web/src/components/tasks/workspace/sections/task-workspace-operation-panel.tsx`
- `features/task-workspace/ui/task-workspace-page.tsx`
- `features/task-workspace/ui/task-workspace-header-card.tsx`
- `features/execution-monitoring/ui/task-workspace-inspector.tsx`
- `features/execution-monitoring/ui/task-workspace-execution-overview.tsx`
- related tests in `apps/web/src/components/tasks/workspace/sections/` and `features/execution-monitoring/tests/`.

### Change

- Put current operation and primary action above graph/log detail.
- Add explicit empty/loading/error/stale states.
- Add result-focused layout for result-ready/done.
- Make graph subordinate to current operation and selected node details.
- Ensure disabled primary actions always show a reason.
- Keep product-owned runtime controls outside AI-authored result surfaces.

### Acceptance criteria

- Golden states render with visible state label, explanation, primary action, and secondary action when applicable.
- Mobile `390x844` has no horizontal overflow.
- Result-ready layout shows result review actions and hides the full workbench by default.
- Running/waiting/blocked states show current node or blocker scope when available.

### Tests

- Component tests for no plan, planning, plan review, ready-to-run, running, waiting input, waiting approval, blocked, failed, cancelled, result-ready, done.
- Accessibility assertions: landmark/region labels, button names, disabled reasons.
- Browser smoke for desktop/tablet/mobile.
- Commands:
  - `bunx vitest run apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.test.tsx features/execution-monitoring/tests/task-workspace-execution-overview.test.tsx`
  - `bun run check:ui-foundation`
  - `bun run typecheck`.

## PR 3 — Run contract preview and automation readiness

### Goal

Make manual and scheduled execution understandable before it starts.

### Files

- `features/task-workspace/model/task-workspace-interaction.ts`
- `packages/engine/src/modules/scheduling/derive-auto-start-eligibility.ts`
- `packages/engine/src/modules/scheduling/auto-start-scheduled-plan.ts`
- `packages/engine/src/modules/scheduling/auto-generate-scheduled-plan.ts`
- `packages/engine/src/modules/pages/` schedule/dashboard projection builders as needed.
- `features/schedule/ui/schedule-page.tsx`
- `apps/web/src/components/dashboard/dashboard-page.tsx`
- task workspace components/tests.

### Change

- Add run contract preview model:
  - plan version;
  - trigger;
  - runtime/provider;
  - work block/schedule;
  - node/checkpoint counts;
  - expected input/approval stops;
  - cancel/retry/resume capability;
  - result review policy.
- Surface auto-plan/auto-run readiness on workspace and schedule cards.
- Convert auto-start skip reasons into user-facing disabled reasons.
- Keep automation logic in engine/domain/model, not React components.

### Acceptance criteria

- Ready-to-run workspace shows contract preview before start.
- Scheduled tasks show whether auto-plan/auto-run can happen and why not when blocked.
- Manual start and scheduled start use equivalent readiness reasons.
- Provider/runtime missing state names the missing configuration.

### Tests

- Unit tests for eligibility reason mapping.
- Projection tests for schedule/dashboard readiness fields.
- Component tests for contract preview.
- E2E golden path includes run contract preview after task creation/plan acceptance.
- Commands:
  - `bun test packages/engine/src/modules/scheduling/derive-auto-start-eligibility.bun.test.ts packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts`
  - `bunx vitest run` targeted workspace/schedule tests.
  - `bun run typecheck`.

## PR 4 — Approval, input, failure, and recovery cards

### Goal

Replace generic handling states with specific decision and recovery UX.

### Files

- `apps/web/src/components/tasks/workspace/sections/task-workspace-operation-panel.tsx`
- `packages/engine/src/modules/plan-execution/task-plan-execution.ts`
- `packages/domain/src/task/derive-task-state.ts`
- `packages/domain/src/task/derive-task-execution-state.ts`
- `apps/web/src/components/action-center/action-center-list.tsx`
- Action Center projection code under `packages/engine/src/modules/pages/` or current projection owner.
- Tests for operation panel, Action Center, domain state.

### Change

- Add standard decision card data for:
  - input needed;
  - approval needed;
  - provider approval;
  - replan required;
  - result ready.
- Add standard recovery card data for:
  - failed;
  - blocked;
  - cancelled;
  - stale/recovering.
- Include reason, scope, node/run/session refs, evidence/diff, and recovery actions.
- Ensure plan generation failure remains stopped until explicit user action.

### Acceptance criteria

- Waiting input card asks for input and resumes with explicit payload.
- Waiting approval card offers approve/reject/request changes with reason.
- Failure card shows human-readable error and retry/stop/replan options.
- Action Center items use same labels/actions as workspace.
- No state falls back to generic `Needs handling`.

### Tests

- Domain state tests for waiting, failed, blocked, cancelled, stale.
- Operation panel component tests for decision/recovery cards.
- Action Center projection and component tests.
- E2E:
  - approval wait and approve;
  - failure reason and retry/stop.
- Commands:
  - `bunx vitest run apps/web/src/components/action-center/__tests__/action-center-list.test.tsx apps/web/src/components/tasks/workspace/sections/task-workspace-operation-panel.test.tsx`
  - `bun run test:e2e:desktop` for affected flows if route/navigation changes.
  - `bun run typecheck`.

## PR 5 — Evidence, artifacts, and result review audit

### Goal

Make completed work reviewable and trustworthy.

### Files

- `features/execution-monitoring/ui/task-workspace-execution-overview.tsx`
- `features/execution-monitoring/ui/build-execution-overview-spec.ts`
- `packages/ui-protocol` builders/catalog tests if result spec changes.
- `apps/server/src/routes/tasks/result.routes.ts`
- `packages/engine/src/modules/tasks/accept-task-result.ts`
- task result/action tests.

### Change

- Group activity trail into plan generation, run lifecycle, node attempts, provider/tool activity, approvals, artifacts/results, failures/retries.
- Show result artifact validation state and fallback state.
- Keep accept/request-change/create-follow-up controls product-authored.
- After accept result, update visible state to `done` and keep audit trail accessible.

### Acceptance criteria

- Result-ready view shows result, artifact list, audit summary, and accept/request-change actions.
- Accepted result view shows task done and follow-up/new-task actions.
- Invalid AI-authored specs do not break controls.
- Audit grouping makes provider/tool/failure evidence discoverable without raw-log overload.

### Tests

- UI protocol validation tests for result specs/fallbacks.
- Execution overview component tests for grouped activity and result actions.
- Result accept backend test.
- E2E:
  - completion with results, artifacts, audit summary;
  - accept result.
- Commands:
  - `bun run test:bun` when ui-protocol changes.
  - targeted Vitest for execution overview.
  - `bun run typecheck`.

## PR 6 — Cross-page consistency and final golden-path hardening

### Goal

Ensure Dashboard, Schedule, Task Workspace, and Action Center all speak the same state language.

### Files

- `apps/web/src/components/dashboard/dashboard-page.tsx`
- `features/schedule/ui/schedule-page.tsx`
- `apps/web/src/components/action-center/`
- `apps/web/src/components/tasks/`
- shared model/projection files introduced by earlier PRs.
- E2E specs under `e2e/specs/`.

### Change

- Wire shared state labels/actions into Dashboard, Schedule, Task list, Action Center, and Workspace.
- Remove page-local status copy where it duplicates shared model.
- Add final golden-path E2E coverage.
- Verify responsive states at desktop/tablet/mobile.

### Acceptance criteria

- Same task shows same state label and primary action on every page.
- User can navigate from Dashboard/Schedule/Action Center directly to the relevant workspace state/action.
- Golden paths pass:
  - Run Contract Preview after task creation;
  - current step and next step after start;
  - approval wait with understandable reason and approve action;
  - failure reason and retry/stop;
  - completion with results, artifacts, audit summary.

### Tests

- Cross-page component/projection tests.
- E2E golden path suite.
- Required final checks:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run test`
  - `bun run test:e2e` when navigation/task flow changed.
  - `bun run check:ui-foundation` if primitives/surfaces changed.

## Release notes for reviewers

- Review PRs in order. Later PRs assume shared state contract from PR 1.
- Do not merge UI branches that add page-specific status logic instead of using shared derivation.
- Treat copy changes as product behavior: labels/actions are part of the trust contract.
- Verify no secrets/raw provider payloads leak into UI logs, result specs, or tests.
