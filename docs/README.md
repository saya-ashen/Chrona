# Chrona Documentation

Chrona is an open-source, local-first AI schedule app for turning tasks into planned, scheduled, executable, and inspectable work.

Use this directory as the stable product and developer documentation set. Time-point audits, refactor notes, and design-debt records are removed once their lasting content is merged into stable docs.

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
| Understand the frontend (`apps/web`) | [Frontend Structure](./frontend-structure.md) |
| Extend AI/runtime providers | [Provider Boundary](./provider-boundary.md) |
| Understand plan-level output architecture | [Plan-Level Output Architecture](./plan-level-output-architecture.md) |
| Run tests | [中文测试指南](./zh/testing.md) |
| See feature/test coverage map | [Feature + Test Map](./maps/feature-test-map.md) (check/regenerate source: `bun run map:check`) |

## Current product areas

Chrona currently centers on four active product surfaces:

1. Dashboard: review today’s focus, attention items, active work, latest results, and recoverable execution state.
2. Schedule: arrange time blocks, inspect conflicts, accept schedule proposals, and make schedule-driven automation visible.
3. Tasks: create tasks, generate/review/accept plans, execute work, inspect results, and recover blocked or failed runs.
4. Settings: configure AI clients, feature bindings, provider health, schedule automation defaults, and local diagnostics.

Hidden/internal projections include Inbox and Memory. They may still exist as APIs or data sources, but they are not current primary navigation surfaces.

## Runtime shape

Chrona is a Bun/TypeScript monorepo:

| Area | Path | Role |
| --- | --- | --- |
| Web app | `apps/web` | Vite + React 19 + React Router SPA |
| API server | `apps/server` | Hono routes on Bun |
| CLI | `packages/cli` | Packaged entry point for starting Chrona |
| Contracts | `packages/contracts` | API schemas, AI feature specs, runtime event types, MCP tool schemas |
| Engine | `packages/engine` | Business use cases for tasks, plans, execution, scheduling, projections, AI clients |
| Graph runtime | `packages/graph-runtime` | Plan graph build/resolve/transition/command execution primitives |
| Database | `packages/db` + `prisma` | SQLite and Prisma 7 schema/migrations/seed |
| Providers | `packages/providers/*` | External runtime/provider protocol adapters |
| Hermes plugin | `external-plugins/hermes` | Chrona tools exposed to Hermes Agent |

This table is a curated subset. For the complete package list (including
`domain`, `ui-protocol`, `runtime-core`, `i18n`, `shared`) and the placement
rules, see [Package Boundaries](./package-boundaries.md).

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
- Delete dated audits, phase plans, release-candidate notes, and refactor-debt logs once their lasting content is merged into stable docs.
