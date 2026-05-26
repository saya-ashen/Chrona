# Implementation Plan: Harden Execution Kernel

**Branch**: `013-harden-execution-kernel` | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/013-harden-execution-kernel/spec.md`

## Summary

Replace Chrona's unsafe multi-entry execution advancement with a single durable execution authority model. The plan keeps Chrona's task/plan graph product model and provider integration, but removes unpublished legacy execution-state compatibility in favor of one authoritative task-plan-run execution owner, epoch fencing, node attempt idempotency, stable completed-result checkpoints, and scheduler/callback behavior that cannot restart or overwrite stopped, paused, or completed work.

## Technical Context

**Language/Version**: TypeScript strict; Bun runtime  
**Primary Dependencies**: Existing Chrona engine, graph runtime, provider bridge, Hono API server, Prisma data access, structured contracts  
**Storage**: SQLite through existing Prisma/Bun SQLite stack  
**Testing**: Bun test suites plus repository checks: `bun run typecheck`, `bun run lint`, `bun run test`; `bun run test:e2e` required because task execution flow is affected  
**Target Platform**: Local/server Chrona runtime on Linux/macOS-compatible Bun environments  
**Project Type**: Monorepo web application with backend execution engine and frontend task graph UI  
**Performance Goals**: Visible start, pause, stop, and resume state updates complete within 1 second in local single-user operation; execution ownership checks add no user-visible delay  
**Constraints**: No compatibility requirement for unpublished legacy execution data; preserve Chrona task/plan UX; keep provider-side duplicate runs at zero per node attempt; keep serial execution strict by default  
**Scale/Scope**: Single Chrona task plan run at local/single-server scale; one provider-backed node running at a time per task plan run in default serial mode; all current execution entry points covered

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. The design centralizes execution authority in the plan-execution layer, keeps task/plan product data separate from execution ownership and provider-run records, and removes conflicting legacy execution paths instead of layering compatibility shims. Added complexity is justified by the need for durable ownership, fencing, and idempotency around costly provider side effects.
- **Testing**: PASS. Required coverage: narrow unit tests for lease/fencing/idempotency state helpers; integration tests for concurrent triggers, serial DAG branches, pause/stop with late callbacks, completed-node resume, explicit retry replacement, and restart recovery; contract/projection tests for task detail and plan graph state. Required commands: `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e` because task execution flow is affected.
- **Frontend UX Evidence**: PASS with no visual redesign planned. If implementation changes visible task/node status wording or activity history rows, use `agent-browser` before and after those UI changes and verify desktop `1440x900`, tablet `1024x768`, and mobile `390x844` with no horizontal scrolling.
- **Product Behavior & API Scope**: PASS. Task creation, plan display, node result inspection, activity history, manual start, pause, stop, resume, and retry remain product behaviors. Backend task/plan responses may change execution-state fields to reflect the new authoritative model; this is justified by the feature and must remain coherent for existing consumers.
- **UX Clarity & Responsiveness**: PASS. Existing Chrona task graph and activity patterns remain. Any new user-facing strings for stale callbacks, ignored overlapping triggers, retried work, or recovered work must be localizable. Current task, active node, stopped/paused state, and primary action must stay visually clear.
- **Performance Budgets**: PASS. Ownership acquisition and fencing checks must complete without visible delay for normal local operation. Event/projection history queries must remain bounded by existing task detail expectations; large histories should not block start/stop/resume actions.

## Project Structure

### Documentation (this feature)

```text
specs/013-harden-execution-kernel/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── execution-kernel-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/engine/src/modules/plan-execution/
├── persistence/
│   ├── execution-lease-store.ts
│   ├── execution-session-store.ts
│   ├── plan-run-store.ts
│   └── plan-runtime-store.ts
├── runtime/
│   ├── execution-fencing.ts
│   ├── node-attempt-idempotency.ts
│   ├── committed-state.ts
│   └── graph-runtime-callbacks.ts
├── use-cases/
│   ├── sync-runtime-result/
│   └── submit-terminal-node-result.ts
├── ai-runtime-invoker.ts
├── node-ai-capabilities.ts
└── task-plan-execution.ts

packages/engine/src/modules/orchestration/
├── graph-advancement-worker.ts
├── restart-recovery-worker.ts
└── task-orchestrator.ts

packages/graph-runtime/src/
├── commands/
├── execution/
├── execution-state.ts
└── resolve.ts

packages/db/
└── prisma/schema.prisma

packages/contracts/
└── task/plan execution contracts as needed

apps/web/src/components/tasks/plan/
└── existing task graph and inspector consumers, only if status/projection copy changes
```

**Structure Decision**: Keep the feature in the current engine/runtime modules. Add a small execution ownership/fencing/idempotency layer under `plan-execution` and remove or simplify legacy state paths that conflict with it. Do not introduce a workflow runtime dependency or move Chrona's task/plan product model.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Durable execution ownership layer | Provider-side work can be costly and was observed to duplicate under overlapping engine entries | Process-local abort/control maps do not protect against scheduler/callback/manual reentry, restart recovery, or stale writes |
| Epoch/fencing tokens | Late callbacks and stale execution owners can otherwise overwrite newer state | Checking current status only is insufficient when state changes between read and write |
| Node attempt idempotency | Same node attempt must not create multiple provider runs | Relying on provider run IDs makes each duplicate invocation unique and therefore not idempotent |

## Phase 0: Research

See [research.md](./research.md).

Key decisions:

- Use a Chrona-owned durable execution lease instead of adopting an external workflow runtime.
- Use execution epoch/fencing to reject stale writes and late callbacks.
- Use node attempt identity as the idempotency boundary for provider-side runs.
- Treat completed node results as durable checkpoints and remove conflicting unpublished legacy result-state paths.
- Use context segments as the provider-session boundary for long task execution: related nodes may share short-term provider context, while segment transitions summarize and switch sessions under Chrona control.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/execution-kernel-contract.md](./contracts/execution-kernel-contract.md), and [quickstart.md](./quickstart.md).

Post-design constitution re-check:

- **Code Quality**: PASS. Data model separates execution owner, epoch, node attempt, provider run, node result, event, and stale callback concepts. The contract defines one ownership-gated execution transition path.
- **Testing**: PASS. Quickstart lists targeted regression tests and full repo checks, including e2e due task execution flow changes.
- **Frontend UX Evidence**: PASS. No visual redesign required. Browser evidence only required if implementation changes visible status/history UI.
- **Product Behavior & API Scope**: PASS. Product task/plan graph remains; execution-state semantics change by feature intent.
- **UX Clarity & Responsiveness**: PASS. Data model includes stale/ignored/retried states for clear history; performance budget remains 1 second visible state update.
- **Performance Budgets**: PASS. Lease and fencing checks are bounded transactional operations; provider execution remains asynchronous.

## Phase 2: Planning Boundary

This `/speckit.plan` output stops before task generation. `/speckit.tasks` should break the implementation into tests-first slices:

1. Red regression tests for current duplicate execution and stop/pause late callback bugs.
2. Durable execution ownership store and acquisition/release behavior.
3. Epoch/fencing validation on all state mutation paths.
4. Node attempt idempotency and provider run reuse/prevention.
5. Completed-result checkpoint semantics and explicit retry replacement.
6. Scheduler and recovery integration through the ownership gate.
7. Projection/API/history consistency and optional UI wording updates.
8. Full validation commands and browser/e2e evidence where visible flows changed.
