# Chrona Roadmap

Current version: 0.1.4

Chrona is evolving into a task control plane for AI-assisted work. The product connects four loops that should stay visible and recoverable: task capture, graph planning, schedule placement, and runtime execution.

This roadmap separates shipped capability from intended direction. It is not a commitment to ship every item in order; near-term items are the current product focus, while mid- and long-term items describe likely evolution after the execution and schedule foundations stabilize.

## Current product pillars

1. Task control: capture work, structure it, prioritize it, and keep status clear.
2. Plan control: generate, edit, accept, and execute graph plans.
3. Execution control: run AI/runtime-backed nodes with human checkpoints, explicit actions, and recoverable state.
4. Schedule control: turn plans into time-bound work and surface conflicts, proposals, and due-work automation.
5. Agent integration: let external agents create, plan, schedule, and advance Chrona work through safe tool contracts.

## Completed / available capabilities

These capabilities exist in the current codebase and should be treated as product baseline.

| Area | Current capability |
| --- | --- |
| Tasks | Task create/update/delete, completion/reopen, priority, status, labels, dependencies, parent/child relationships, and task projection rebuilds. |
| AI planning | Streaming plan generation, generated-plan persistence, plan review/edit/accept flows, and materialization into task plan layers. |
| Graph plans | Executable `task`, `checkpoint`, `condition`, and `wait` nodes with graph state resolution. |
| AI node runtime | AI-visible refs for node completion, condition selection, block/fail, and wait completion; backend IDs stay behind server-side mapping. |
| Work page | Latest result, plan graph, execution records, task details, right rail/inspector, and bottom composer surface. |
| Task Workspace | Task editing, plan generation/acceptance, execution overview, and node detail inspection. |
| Schedule page | Timeline, task list, AI insights, conflicts, schedule proposals, task creation, and configuration surfaces. |
| Inbox | Pending approvals, schedule proposals, waiting inputs, and failed/cancelled run surfaces. |
| Memory console | Workspace/task memory display surfaces. |
| AI clients | Database-backed AI clients and feature bindings through Settings / AI Clients. |
| Backend API | Task CRUD/lifecycle routes, plan generation/acceptance routes, task-scoped execution routes, work/schedule page projections, runtime provider routes, and AI client routes. |
| MCP / Hermes | Streamable HTTP MCP tools for Chrona execution/plan/node operations and Hermes provider/plugin integration for agent-style execution. |

## Near-term priorities

Near-term work should make the existing product dependable and understandable rather than adding unrelated surfaces.

### 1. Make the Work page execution record practical

- Keep the composer fixed at the bottom and the middle record area scrollable.
- Keep conversation history across all task runs, not only the latest run.
- In the collaboration/conversation view, show conversation messages without tool-call and task-event clutter.
- Simplify message cards so speaker labels are not duplicated.
- Rework the execution record into a usable layout: left-side stream grouped by run, right-side fixed task cockpit with current state, active node, blockers, and primary actions.
- Distinguish final outputs, checkpoints, runtime events, tool calls, and assistant/user conversation instead of mixing everything into a raw linear dump.

### 2. Harden task-scoped execution APIs

- Prefer lightweight task-scoped status and action endpoints for execution state checks.
- Keep execution endpoints explicit instead of routing feature calls and task execution through generic chat semantics.
- Preserve AI-visible refs as the external contract for agent workers.
- Make per-task session reuse, isolation, refresh-after-error, and recovery behavior explicit.
- Use tool inputs/results as execution source of truth instead of relying on ad-hoc structured-result submission paths.

### 3. Stabilize schedule-to-execution behavior

- Ensure accepted schedule proposals reliably create or update WorkBlocks.
- Start due work through the scheduler only when configured and safe.
- Surface conflicts and automation suggestions without forcing full schedule projection refreshes for lightweight status checks.
- Keep schedule UI polish focused on the P0 interaction path: find work, understand conflicts, accept proposals, and start due execution.

### 4. Keep provider and package boundaries clean

- Keep AI client selection database-driven.
- Keep feature-specific contracts such as `generate_plan`, `edit_plan`, `dispatch_task`, and `execute_task_node` explicit.
- Keep provider protocol parsing below `packages/providers/*`.
- Keep orchestration, plan execution, scheduling, and task lifecycle policy in `packages/engine`.
- Keep shared schemas and API contracts in `packages/contracts`.

### 5. Bring docs in line with the product

- Keep README and quick-start pages focused on the current Vite + Hono + Bun app.
- Remove or archive stale refactor/audit plans after their content is merged into current docs.
- Keep API, architecture, data model, provider boundary, and package boundary docs aligned with real routes and schemas.

## Mid-term evolution

Mid-term work should extend the current loops once Work, execution, and schedule behavior are stable.

| Theme | Direction |
| --- | --- |
| Dynamic replanning | Let running tasks request plan changes, route them through review/acceptance, and resume safely after approval. |
| Execution recovery | Improve retry, resume, cancellation, blocked-state recovery, and run/session diagnostics. |
| Runtime abstraction | Support additional execution backends without changing the core task/plan/schedule workflow. |
| Richer memory | Use task and workspace memory more deliberately in planning, node execution, and summaries. |
| Better projections | Make page projections fast, task-scoped where possible, and consistent across Work, Schedule, Inbox, and Task Workspace. |
| Test coverage | Add focused tests for plan generation, graph execution, task-scoped execution actions, MCP tools, Work projections, and schedule proposal decisions. |

## Long-term direction

Long-term work should be treated as strategic direction, not near-term promise.

| Theme | Direction |
| --- | --- |
| External ingestion | Turn conversations, email, notes, and external systems into structured Chrona tasks that can be planned and scheduled. |
| Collaboration | Add stronger multi-user review, approvals, audit trails, and shared execution context. |
| Production readiness | Improve authentication, deployment docs, backup/restore, observability, migration safety, and operational runbooks. |
| Agent ecosystem | Let more agents and tools participate through explicit, inspectable contracts while Chrona remains the control plane. |
| Organization-scale planning | Connect individual tasks, schedules, dependencies, and execution history into portfolio-level visibility. |

## Contribution focus

Good areas to improve now:

- Keep documentation and examples aligned with actual route/schema behavior.
- Add narrow tests around task plans, execution actions, Work page projections, schedule decisions, and MCP tools.
- Improve UI clarity in Work, Schedule, Inbox, Task Workspace, and Settings / AI Clients.
- Tighten package boundaries when code drifts into the wrong layer.
- Prefer small, verifiable changes over broad rewrites.
