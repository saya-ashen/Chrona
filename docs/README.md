# Chrona Documentation

Chrona is an AI-native task control plane for turning work intent into scheduled tasks, executable plans, agent runs, and observable results.

Use this directory as the stable product and developer documentation set. Time-point audits, refactor notes, and design-debt records live under `docs/internal/` so public navigation stays evergreen.

## Start here

| Need | Document |
| --- | --- |
| Install and run Chrona | [Quick Start (English)](./en/quick-start.md) / [快速开始（中文）](./zh/quick-start.md) |
| Understand the product surface | [English guide](./en/README.md) / [中文指南](./zh/README.md) |
| See shipped and planned product areas | [Roadmap (English)](./en/roadmap.md) / [路线图（中文）](./zh/roadmap.md) |
| Integrate over HTTP or MCP | [API Reference](./api-reference.md) |
| Understand system architecture | [Architecture](./architecture.md) |
| Trace execution internals | [Backend Execution Flow](./backend-execution-flow.md) |
| Understand persistence | [Data Model](./data-model.md) |
| Place code in the right package | [Package Boundaries](./package-boundaries.md) |
| Extend AI/runtime providers | [Provider Boundary](./provider-boundary.md) |
| Run tests | [中文测试指南](./zh/testing.md) |

## Current product areas

Chrona currently centers on five workflows:

1. Task management: create, edit, complete, reopen, delete, prioritize, tag, nest, and relate tasks.
2. Plan generation: ask AI to draft a graph plan, then review, edit, accept, and materialize it.
3. Plan execution: run task/checkpoint/condition/wait nodes with human checkpoints and AI-visible refs.
4. Schedule cockpit: arrange time blocks, inspect conflicts, accept schedule proposals, and auto-start due work.
5. Work page: observe latest results, plan graph, execution records, task details, and conversation/input context in one task-focused surface.

Supporting surfaces include Inbox, Memory Console, Global AI Sidebar, Assistant Surface, Settings / AI Clients, and runtime/provider status.

## Runtime shape

Chrona is a Bun/TypeScript monorepo:

| Area | Path | Role |
| --- | --- | --- |
| Web app | `apps/web` | Vite + React 19 + React Router SPA |
| API server | `apps/server` | Hono routes on Bun |
| CLI | `packages/cli` | Thin client for the API |
| Contracts | `packages/contracts` | API schemas, AI feature specs, runtime event types, MCP tool schemas |
| Engine | `packages/engine` | Business use cases for tasks, plans, execution, scheduling, projections, AI clients |
| Graph runtime | `packages/graph-runtime` | Plan graph build/resolve/transition/command execution primitives |
| Database | `packages/db` + `prisma` | SQLite and Prisma 7 schema/migrations/seed |
| Providers | `packages/providers/*` | External runtime/provider protocol adapters |
| Hermes plugin | `external-plugins/hermes` | Chrona tools exposed to Hermes Agent |

## Common commands for repository development

Run from the repository root:

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

## Documentation maintenance rules

- Keep install/run commands aligned with root `package.json`.
- Keep API reference aligned with `apps/server/src/routes/**`.
- Keep MCP tool docs aligned with `packages/contracts` and `apps/server/src/routes/mcp`.
- Keep package boundary docs aligned with actual package directories.
- Move dated audits, phase plans, and refactor-debt logs to `docs/internal/` instead of linking them as public guides.
