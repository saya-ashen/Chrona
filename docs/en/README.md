# Chrona Documentation — English

Chrona is a local-first AI task control plane. It helps you turn intent into tasks, generate editable graph plans, schedule work, run execution nodes through AI/runtime providers, and observe the result from a task-focused Work page.

## What you can do today

- Manage tasks: create, edit, complete, reopen, delete, prioritize, tag, nest, and relate tasks.
- Generate plans: ask AI for a PlanBlueprint, stream generation progress, review the plan, edit it, and accept it.
- Execute graph plans: run task/checkpoint/condition/wait nodes, pause for input or approval, retry, block, fail, or complete nodes.
- Use the Work page: inspect latest result, plan graph, execution records, task metadata, conversation context, and command composer in one place.
- Use the Schedule page: view time blocks, inspect conflicts, create schedule proposals, accept proposals, and auto-start due work.
- Triage operational state: Inbox aggregates approvals, schedule proposals, waiting inputs, failed runs, and cancelled runs.
- Configure AI: Settings / AI Clients stores clients and feature bindings in the database.
- Integrate agents: the Hermes plugin exposes Chrona MCP tools using AI-visible refs, not backend IDs.

## Start here

| Goal | Document |
| --- | --- |
| Install and run Chrona | [Quick Start](./quick-start.md) |
| See current product direction | [Roadmap](./roadmap.md) |
| Integrate over HTTP or MCP | [API Reference](../api-reference.md) |
| Understand the architecture | [Architecture](../architecture.md) |
| Trace execution internals | [Backend Execution Flow](../backend-execution-flow.md) |
| Understand persistence | [Data Model](../data-model.md) |
| Place code in the right package | [Package Boundaries](../package-boundaries.md) |
| Extend AI/runtime providers | [Provider Boundary](../provider-boundary.md) |

## Main user workflows

### 1. Task → plan → execution

1. Create or update a task.
2. Generate an AI plan from the task workspace or Work page.
3. Review and optionally edit the generated graph.
4. Accept the plan.
5. Start execution manually or let the scheduler trigger it.
6. Respond to checkpoints, inputs, approvals, blocks, or failures when needed.
7. Review the latest result and execution record in the Work page.

### 2. Schedule-driven execution

1. Create a task and optional due time.
2. Add a concrete schedule or ask AI for schedule proposals.
3. Accept or reject proposals from Schedule or Inbox.
4. The scheduler can start due work blocks.
5. Execution state and task projection updates flow back into Schedule, Inbox, and Work.

### 3. Agent integration

External agents call Chrona through MCP tools such as `chrona_plan_generate`, `chrona_task_complete`, `chrona_node_block`, and `chrona_condition_select`. Agents receive AI-visible node and branch refs from Chrona and must submit results through those refs instead of inventing backend IDs.

## Developer map

| Area | Path | Role |
| --- | --- | --- |
| Web app | `apps/web` | Vite + React 19 + React Router UI |
| Server | `apps/server` | Hono API routes and static app serving on Bun |
| CLI | `packages/cli` | Thin command-line client for the API |
| Engine | `packages/engine` | Tasks, plans, execution, scheduling, projections, AI client use cases |
| Contracts | `packages/contracts` | API schemas, AI feature specs, runtime events, MCP tool schemas |
| Graph runtime | `packages/graph-runtime` | Plan graph resolve/transition/command primitives |
| Database | `packages/db` + `prisma` | SQLite + Prisma 7 schema, migrations, seed |
| Providers | `packages/providers/*` | Runtime/provider protocol adapters |
| Hermes plugin | `external-plugins/hermes` | Chrona MCP tools for Hermes Agent |

## Repository commands

Run from the repository root when developing Chrona itself:

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run check:ui-foundation
bun run check:boundaries
```

Long-lived server only:

```bash
bun run server:start
```

Web dev server only:

```bash
bun run dev:web
```
