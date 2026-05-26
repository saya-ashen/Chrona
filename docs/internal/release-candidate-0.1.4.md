# Chrona 0.1.4 First Release Candidate

Date: 2026-05-26
Status: first reviewable MVP release candidate, not a stable public release
Audience: local development, internal dogfood, and friendly-user MVP review

## Release goal

This release candidate packages the current Chrona MVP around a schedule-first loop:

Task -> Plan -> Schedule -> Auto Execution

The build is intended to prove that a user can capture work, generate and accept a plan, place work on the schedule, start or resume execution, review inbox/waiting states, and inspect execution history without relying on raw chat transcripts.

## What is included

### Product surfaces

- Task foundation: create, update, delete, complete/reopen, prioritize, label, relate, and project tasks.
- Plan generation: stream AI-generated plan drafts, review/edit them, accept them, and materialize them into graph nodes.
- Graph execution: run typed `task`, `checkpoint`, `condition`, and `wait` nodes with persisted execution state.
- AI-visible runtime refs: agent workers use scoped refs for completion, branch selection, block/fail, and wait completion instead of backend database IDs.
- Schedule surfaces: timeline/task views, AI insights, conflict/suggestion surfaces, schedule proposal flows, and task creation/configuration entry points.
- Inbox review loops: pending approvals, schedule proposals, waiting inputs, and failed/cancelled run recovery entry points.
- Work page: task details, plan graph, conversation/history context, execution records, right rail/inspector, and bottom composer surface.
- AI clients: database-backed client configuration and feature bindings through Settings / AI Clients.

### RC-focused changes since the readiness review

- README and README.zh now describe Chrona as a local-first schedule app with auto-execution as the primary product direction.
- README now includes an explicit project status warning, schedule-first first-run flow, and roadmap summary.
- Work execution records now use a structured two-column layout: left-side execution stream grouped by run, plus a right-side sticky task cockpit summary.
- Execution timeline keeps milestone prioritization, attention counts, and collapsed background records while making the cockpit separate from the stream.
- Inbox action copy paths were hardened to use the required copy contract rather than optional copy access.
- Focused ExecutionTimeline tests were added for cockpit/stream separation and run-grouped behavior.

## Release notes

### Highlights

- Schedule-first positioning is now explicit in top-level documentation.
- The Work page execution record is more reviewable: users can scan run-grouped execution history without losing the current task cockpit.
- Review and recovery loops are represented as first-class MVP scope through Schedule, Inbox, Work, and Task Workspace surfaces.
- The project remains Bun-only for repository development and runtime execution.

### Developer notes

- Required runtime: Bun >= 1.3.11.
- Main local command: `bun run dev`.
- Static/API server command: `bun run server:start`.
- AI features require Settings -> AI Clients configuration and feature bindings.
- The repository still contains packaged CLI documentation in `docs/en/quick-start.md` and `docs/zh/quick-start.md`; top-level README now emphasizes source and Docker paths because the current repository/runtime is Bun-only.

## Verification summary

### Evidence inspected

- `README.md`
- `README.zh.md`
- `CHANGELOG.md`
- `docs/en/roadmap.md`
- `docs/internal/technical-debt/execution-ui-projection-debt.md`
- `package.json`
- `apps/web/src/components/work/execution-timeline.tsx`
- `apps/web/src/components/work/execution-timeline.test.tsx`
- `apps/web/src/components/inbox/inbox-page-client.tsx`
- Current git diff/stat

### Commands run for this RC preparation

- `git status --short && git diff --stat`
  - Confirmed the working set contains the release documentation updates plus the focused Work/Inbox changes from the critical-fix step.
- `git diff -- README.md README.zh.md CHANGELOG.md`
  - Confirmed README/README.zh changes align the product description, warning, first-run path, and roadmap summary with schedule-first MVP scope.
- `git diff -- apps/web/src/components/work/execution-timeline.tsx apps/web/src/components/work/execution-timeline.test.tsx apps/web/src/components/inbox/inbox-page-client.tsx`
  - Confirmed the focused UI/code changes are limited to execution timeline layout/tests and inbox copy handling.
- `git diff --check`
  - Result: passed.
- `date +%Y-%m-%d`
  - Confirmed release candidate date: 2026-05-26.
- `bun run typecheck`
  - Result: passed.
- `bunx vitest run apps/web/src/components/inbox/__tests__/inbox-page-client.test.tsx apps/web/src/components/work/execution-timeline.test.tsx apps/web/src/components/work/work-page-client.test.tsx apps/web/src/components/tasks/plan/task-plan-graph.test.tsx --config vitest.config.ts`
  - Result: 4 files passed, 33 tests passed.
- `git diff --check`
  - Result: passed.

### Prior focused verification inherited from the critical-fix step

- `git diff --stat && git diff --name-only`
  - Confirmed focused changed files for Work execution record, ExecutionTimeline tests, and Inbox action copy.
- `bun test apps/web/src/components/work/execution-timeline.test.tsx apps/web/src/components/inbox/__tests__/inbox-list.test.tsx`
  - Result: failed before useful assertions because the local Bun test harness lacks a DOM/jsdom environment for React Testing Library.
  - Primary error: `ReferenceError: document is not defined`.
  - Related user-event setup error: `TypeError: undefined is not an object (evaluating 'document[isPrepared]')`.
  - Resolution for this RC: use the project Vitest runner for React/jsdom tests, not raw `bun test`.

## Known limitations accepted for this RC

### P0 / must be explicit before wider release

- Raw `bun test` is not a valid runner for the React Testing Library UI files because it does not provide the required jsdom/Vitest environment. The focused UI gate should use the project Vitest command above.
- The release is not stable public software. APIs and runtime contracts may still change.
- Schedule-to-auto-execution reliability remains the main next hardening target: due-work automation, task-scoped recovery, and failure/session refresh behavior still need more verification.

### P1 / important friendly-user caveats

- Packaged CLI docs still mention npm-based installation in quick-start docs, while the current top-level README positions the repository and runtime as Bun-only. This should be reconciled before a polished public release.
- Execution UI projection debt remains open: some current-operation semantics and dynamic execution data are still inferred or flattened in frontend paths instead of being fully backend-projected.
- Wait/condition/checkpoint recovery paths exist in the product model, but need more browser-level verification across happy path, blocked path, rejected path, and resume path.
- Work/Schedule/Inbox projections need more task-scoped lightweight verification to avoid unnecessary broad refreshes and to prove stale-state recovery.

### P2 / follow-up hardening

- Production readiness work remains later scope: authentication hardening, backup/restore, deployment docs, migration safety, observability, and operational runbooks.
- Browser E2E evidence across desktop/tablet/mobile was not regenerated in this RC preparation step.
- The release candidate has not been tagged or packaged in this node.

## Release judgment

- Internal dogfood: pass for first MVP review. Core MVP surfaces are present and the focused TypeScript/UI regression gate is green.
- Friendly-user MVP review: conditional pass. Suitable for guided review if reviewers accept Bun-only setup and known execution/schedule recovery caveats.
- Public/stable release: fail. Requires green core-flow verification, reconciled packaged install docs, stronger recovery/session verification, and production-readiness hardening.

## Recommended RC gate

Ship this as a first reviewable RC only if the release announcement includes the known limitations above. Do not present it as stable public software.

Minimum next fixes before promoting beyond RC:

1. Reconcile packaged CLI quick-start docs with the current Bun-only runtime position.
2. Add browser-level verification for the schedule -> inbox approval -> work execution -> recovery loop.
3. Continue moving current-operation and dynamic execution projections out of frontend inference into backend-projected contracts.
4. Run the full formal release gate before promoting this RC beyond friendly-user review.
