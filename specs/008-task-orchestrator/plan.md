# Implementation Plan: Task Orchestrator

**Branch**: `008-task-orchestrator` | **Date**: 2026-05-17 | **Spec**: `specs/008-task-orchestrator/spec.md`
**Input**: Feature specification from `specs/008-task-orchestrator/spec.md`

## Summary

Replace Chrona's partial scheduled-start runner with a complete task orchestrator that owns due scheduled starts, active runtime synchronization, graph advancement, degraded retry, dynamic graph mutation, and authoritative task-state reconciliation. The design uses Chrona-specific orchestration over the existing Bun + Hono + Prisma + SQLite stack rather than a generic scheduler library, because correctness depends on graph execution convergence, versioned graph mutations, and truthful task workspace state. No legacy scheduler state or saved execution projections need compatibility.

## Technical Context

**Language/Version**: TypeScript strict; Bun runtime; Hono API server; Vite + React 19 frontend for task workspace state presentation.  
**Primary Dependencies**: Existing engine modules under `packages/engine`, graph runtime under `packages/graph-runtime`, database package under `packages/db`, contracts under `packages/contracts`, web workspace under `apps/web`, Vitest, Playwright, Testing Library, and `agent-browser`. No external scheduler or queue dependency planned for this phase.  
**Storage**: SQLite via Prisma 7 with Bun SQLite adapter. New persisted orchestration state includes scheduler leases, graph execution versions, graph mutations, reconciliation events, and scheduler run history. Existing development execution data may be reset or rebuilt.  
**Testing**: `bun run typecheck`, `bun run lint`, `bun run test`, targeted unit tests for orchestrator/reconciliation/mutation rules, integration tests for scheduled start and runtime sync, and `bun run test:e2e` because task, schedule, and navigation flows are affected. Frontend-visible changes require `agent-browser` pre/post evidence at `1440x900`, `1024x768`, and `390x844`.  
**Target Platform**: Local Chrona Bun server and Vite web app on Linux development machines, with correctness when one or more server processes attempt orchestration.  
**Project Type**: Vite + React SPA plus Hono/Bun API monorepo with shared domain, contracts, database, engine, and graph runtime packages.  
**Performance Goals**: 95% of external run terminal results appear in the task workspace within 10 seconds under normal local conditions; active/degraded task recovery completes within 30 seconds after server restart; due scheduled work starts once within the configured scheduler interval; reconciliation should process ordinary local active-task sets without visible workspace delay.  
**Constraints**: Keep business logic outside React components and Hono route handlers. Keep shared API schemas in `packages/contracts`, database access in `packages/db`, pure state rules in domain/runtime packages, and orchestration in engine modules. Use Bun-compatible runtime paths only. Remove obsolete partial scheduler paths rather than compatibility adapters. Backend contracts may change because truthful execution state requires a new state contract.  
**Scale/Scope**: One orchestration subsystem spanning scheduled work start, active run sync, graph advancement, degraded retry, task state reconciliation, runtime graph mutation, task workspace state contracts, and migration/reset of old development data.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. The change has justified complexity because orchestration state must coordinate schedule, runtime sync, graph execution, persistence, and UI state. Ownership remains layered: engine orchestrates, graph runtime resolves graph semantics, database package owns persistence, contracts expose read models, and web only presents authoritative state.
- **Testing**: PASS. Required proof includes unit tests for reconciliation invariants, lease ownership, runtime result mapping, graph mutation validation, and impossible-state detection; integration tests for due scheduled start, async node completion, waits, blockers, cancellation, degraded retry, restart recovery, and graph mutation; contract tests for task workspace state shape; `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e`.
- **Frontend UX Evidence**: PASS. Any task workspace visible state changes require `agent-browser` pre-edit observation and screenshots plus post-edit verification at desktop `1440x900`, tablet `1024x768`, and mobile `390x844`, including no horizontal scroll and clear current task, active node, waiting/blocking/degraded state, and primary action.
- **Product Behavior & API Scope**: PASS. Existing user workflows are preserved at the product level: create task, generate/accept plan, start/stop/pause, scheduled start, branch selection, checkpoint/user waits, and task workspace navigation. Backend state contracts are allowed to change because the current contract cannot represent truthful scheduler state.
- **UX Clarity & Responsiveness**: PASS. Existing Chrona task workspace patterns remain baseline, but state copy must explicitly distinguish running, waiting for user, waiting for approval, blocked, failed, degraded, skipped, invalidated, cancelled, and completed. Strings must remain in i18n message files.
- **Performance Budgets**: PASS. Scheduler-result visibility budget is 10 seconds p95 for normal local external completions. Restart recovery budget is 30 seconds. Due-start duplicate rate must be zero in 100 two-owner trials. Graph mutation must be atomic from the user perspective.

## Project Structure

### Documentation (this feature)

```text
specs/008-task-orchestrator/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── task-orchestrator-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/engine/
├── src/modules/orchestration/       # New orchestrator, workers, leases, reconciliation, mutations
├── src/modules/scheduling/          # Replace or remove partial auto-start runner behavior
├── src/modules/runtime-sync/        # Integrate background active/degraded runtime synchronization
├── src/modules/plan-execution/      # Delegate graph advancement and terminal handling through orchestrator
└── src/services/                    # Runtime service starts/stops orchestrator lifecycle

packages/graph-runtime/
└── src/                             # State resolution updates for waits/blockers/skipped/invalidated nodes

packages/contracts/
└── src/                             # Shared task execution state and mutation contracts

packages/db/
└── prisma/                          # Scheduler leases, graph versions, mutations, reconciliation events

apps/server/
└── src/                             # Bootstrap orchestrator and expose task mutation/recovery endpoints

apps/web/
└── src/components/tasks/            # Present authoritative task state and mutation/recovery actions

e2e/specs/
└── task-orchestrator*.spec.ts        # Scheduled start, running continuation, mutation, recovery flows
```

**Structure Decision**: Add a Chrona-specific orchestration module under `packages/engine/src/modules/orchestration/` and let existing scheduling/runtime-sync/plan-execution modules delegate lifecycle decisions to it. Shared state shapes live in `packages/contracts`, persistence stays in `packages/db`, graph semantics stay in `packages/graph-runtime`, server routes remain thin, and frontend components only render authoritative read models.

## Phase 0: Research

Research output is captured in `research.md`.

Resolved decisions:

- Use a custom Chrona task orchestrator instead of cron, Redis queue, Postgres worker, or Temporal for this phase.
- Use database leases and idempotent workers as the reliability substrate.
- Make reconciliation the authoritative source of task, graph, node, action, and progress state.
- Treat dynamic graph changes as versioned mutations with validation, invalidation, and audit history.
- Remove or replace old partial scheduler state because the feature explicitly has no legacy compatibility requirement.

## Phase 1: Design & Contracts

Design output is captured in `data-model.md`, `contracts/task-orchestrator-contract.md`, and `quickstart.md`.

Key design decisions:

- Introduce `TaskOrchestrator` lifecycle with separate workers for due scheduled starts, active run sync, graph advancement, degraded retry, reconciliation, and graph mutation processing.
- Use per-work leases for due starts, runs, sessions, tasks, and mutations so multiple server processes cannot duplicate starts or syncs.
- Split state semantics so waiting, approval, blocked, failed, degraded, skipped, invalidated, and completed are not collapsed into overloaded blocker fields.
- Persist graph versions and mutation records so running tasks can evolve safely without erasing execution history.
- Add user-safe recovery actions for degraded and inconsistent tasks.
- Update task workspace read models to expose one authoritative execution state, current node, next action, waiting/blocking/degraded reason, and mutation availability.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design isolates orchestration in engine, graph semantics in graph runtime, persistence in db, contracts in shared schemas, and presentation in web. Complexity is justified by durable graph execution and dynamic mutation requirements.
- **Testing**: PASS. Quickstart and contract documents define required unit, integration, contract, e2e, and browser evidence checks, including restart recovery and two-owner duplicate prevention.
- **Frontend UX Evidence**: PASS. Browser evidence is required for changed task workspace states across desktop, tablet, and mobile; no visual implementation may skip `agent-browser` verification.
- **Product Behavior & API Scope**: PASS. Product workflows are preserved, but backend API/read-model changes are explicitly approved to make state truthful.
- **UX Clarity & Responsiveness**: PASS. Data model and contract require single authoritative state, current node, primary action, and clear waiting/blocking/degraded copy.
- **Performance Budgets**: PASS. Design includes measurable 10-second p95 external completion visibility, 30-second restart recovery, and duplicate-start prevention budgets.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New orchestration subsystem | The current code only starts due work and does not durably sync active runs, advance graphs, reconcile state, or validate graph mutations. | Extending the old interval starter would preserve the root defect: no single owner for execution convergence. |
| New persisted scheduler leases and graph mutation records | Multi-process safety, restart recovery, and dynamic graph edits require durable ownership and audit history. | In-memory flags and microtasks fail after restart and cannot prevent duplicate starts across server processes. |
| Backend state contract changes | The current read model can show running, ready, blocked, and completed contradictions because states are derived from different sources. | Frontend-only fixes would mask backend inconsistency and cannot repair scheduler convergence. |
