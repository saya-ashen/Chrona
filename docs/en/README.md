# Chrona Documentation — English

Chrona is a proactive personal steward: Today / Affairs / Schedule / Delegations / Connections over a durable event loop. Read [current direction and implementation](personal-steward.md), with the [canonical Chinese direction](../zh/personal-steward.md) authoritative since 2026-10-13. The local rebuild is not deployed; real user data was not migrated.

## Current steward surface

- Review decisions, changes, commitments, suggestions and health in Today.
- Manage affairs, scoped delegations and source connections; distinguish proposed authority from grants.
- Use declarative tools and in-app notifications. Reddit is not authorized, external-Agent assessment is not wired, and no real external delivery channel exists.
- See [how the loop works and what remains](personal-steward.md).

## Retained task/result and managed-execution capabilities

- Manage tasks: create, edit, complete, reopen, delete, prioritize, tag, nest, and relate tasks.
- Generate plans: ask AI for a PlanBlueprint, stream generation progress, review the plan, edit it, and accept it.
- Execute graph plans: run task/checkpoint/condition/wait nodes, pause for input or approval, retry, block, fail, or complete nodes.
- Use the task workspace: inspect latest result, plan graph, execution records, task metadata, conversation context, and command center in one place.
- Use the Schedule page: view time blocks, inspect conflicts, create schedule proposals, accept proposals, and auto-start due work.
- Triage operational state: Dashboard and the task workspace surface approvals, schedule proposals, waiting inputs, failed runs, and cancelled runs.
- Configure AI: Settings / AI Clients stores clients and feature bindings in the database.
- Integrate agents: the Hermes plugin exposes Chrona MCP tools using AI-visible refs, not backend IDs.

## Start here

| Goal | Document |
| --- | --- |
| Install and run Chrona | [Quick Start](./quick-start.md) |
| Back up, restore, and operate locally | [Local Operations](./operations.md) |
| See current product direction | [Personal steward](./personal-steward.md) |
| Integrate over HTTP or MCP | [API Reference](./api-reference.md) |
| Understand the architecture | [Architecture](./architecture.md) |
| Trace execution internals | [Backend Execution Flow](./backend-execution-flow.md) |
| Understand persistence | [Data Model](./data-model.md) |
| Place code in the right package | [Package Boundaries](./package-boundaries.md) |
| Extend AI/runtime providers | [Provider Boundary](./provider-boundary.md) |
| Understand the accepted Goal, trigger, and occurrence target design | [Long-Horizon Goals and Triggers](./long-horizon-goals-and-triggers.md) |

## Retained managed-execution workflows (secondary)

### 1. Task → plan → execution

1. Create or update a task.
2. Generate an AI plan from the task workspace.
3. Review and optionally edit the generated graph.
4. Accept the plan.
5. Start execution manually or let the scheduler trigger it.
6. Respond to checkpoints, inputs, approvals, blocks, or failures when needed.
7. Review the latest result and execution record in the task workspace.

### 2. Schedule-driven execution

1. Create a task and optional due time.
2. Add a concrete schedule or ask AI for schedule proposals.
3. Accept or reject proposals from Schedule.
4. The scheduler can start due work blocks when auto-execution is explicitly configured.
5. Execution state and task projection updates flow back into Schedule, Dashboard, and the task workspace.

### 3. Agent integration

External agents call Chrona through MCP tools such as `chrona_plan_read`, `chrona_plan_mutate`, `chrona_node_complete`, `chrona_node_block`, and `chrona_condition_select`. Agents receive AI-visible node and branch refs from Chrona and must submit results through those refs instead of inventing backend IDs.

## Developer map

| Area | Path | Role |
| --- | --- | --- |
| Steward UI | `features/steward` | Primary pages and browser models |
| Steward use cases | `packages/engine/src/modules/steward` | Durable event loop |
| Steward domain | `packages/domain/src/steward` | Pure rules |
| Steward adapters | `packages/integrations/src/steward` | Sources, rule assessor and delivery |
| Web app | `apps/web` | Vite + React 19 + React Router UI |
| Server | `apps/server` | Hono API routes and static app serving on Bun |
| CLI | `packages/cli` | Packaged entry point for starting Chrona |
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
