English | [中文](./README.zh.md)

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>

<h1 align="center">Chrona</h1>

<p align="center">
  <strong>A local-first schedule app for planning work and automatically completing scheduled tasks with AI.</strong>
</p>

<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#project-status">Status</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="./docs/en/quick-start.md">Full Guide</a> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

> [!WARNING]
> Chrona is in fast active development. It is Bun-only, APIs and runtime contracts may change, and the main product direction is a schedule-first app that can automatically execute due work.

<p align="center">
  <img src="docs/assets/CreateTask.png" width="45%" alt="Create a structured Chrona task" />
  <img src="docs/assets/TaskWorkSpace.png" width="45%" alt="Inspect a Chrona task workspace with plan and execution context" />
</p>

---

Chrona is a local-first schedule app for AI-assisted work. Its main goal is to help you put work on a schedule, let AI execute scheduled tasks when appropriate, and keep the result inspectable instead of buried in chat history.

Chrona connects four layers that usually live in separate tools:

```text
Task -> Plan -> Schedule -> Auto Execution
```

Use Chrona to capture work, generate an editable plan, place it on the calendar, execute it manually or automatically, and review what happened later.

## Project Status

Chrona is usable for local development and product exploration, but it is not stable software yet. The current codebase already includes task, plan, schedule, execution, inbox, and AI-client flows; the next major focus is making the schedule-to-auto-execution loop reliable enough for daily use.

## Why Chrona

Calendars tell you what should happen. Task apps tell you what is pending. AI chat can do work, but it usually loses schedule, state, and accountability. Chrona combines those loops:

| If you need to... | Chrona gives you... |
| --- | --- |
| Plan the day around real work | tasks with priority, status, due dates, estimates, dependencies, and schedule metadata |
| Turn a scheduled task into executable steps | AI-generated plan graphs that can be reviewed, patched, accepted, and rerun |
| Let due work move forward automatically | schedule blocks, proposals, waiting states, inbox approvals, and execution actions |
| Keep AI execution accountable | scoped runtime refs, checkpoints, approvals, tool traces, failures, and persisted outputs |

## Quick Start

Chrona is Bun-only today. The repository and production server both use Bun as the runtime; npm package installation is not currently supported.

### Run from source

Use this path if you want to develop Chrona or inspect the codebase.

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

Open `http://localhost:3101`. `bun run dev` starts the Bun/Hono API server and the Vite web app.

### Run with Docker

Use this path if you want a containerized local server.

```bash
docker build -t chrona .
docker run --rm -p 3101:3101 -v chrona-data:/data chrona
```

The container stores SQLite data in `/data/chrona.db`. Set `API_KEY` explicitly for stable authenticated access across restarts.

## First Run

1. Open `http://localhost:3101`.
2. Go to `Settings -> AI Clients`.
3. Add an `llm`, `hermes`, or `debug` client.
4. Bind the client to features such as `generate_plan`, `suggest`, `chat`, or `dispatch_task`.
5. Create a task, place it on the schedule, generate a plan, review it, accept it, then start execution from the task workspace or Work page.

See the [full quick start](./docs/en/quick-start.md) for data directories, AI client details, and troubleshooting.

## What You Can Do

### Build a real schedule

Create tasks with priority, estimates, due dates, dependencies, and schedule metadata so the calendar becomes the source of what should happen next.

### Generate editable plans

Turn a rough task into a structured plan blueprint. Accepted plans become persisted task plan layers and graph nodes instead of one-off assistant text.

### Execute graph-based work

Run plans as typed graphs with `task`, `checkpoint`, `condition`, and `wait` nodes. Nodes can be manual, assisted, or automatic, and can be assigned to user, AI, or system executors.

### Move scheduled work forward

Use schedule views, AI insights, conflict suggestions, schedule proposals, waiting runs, failed runs, cancelled runs, and inbox approvals to move due work toward execution.

### Keep AI execution observable

AI workers receive safe runtime refs instead of internal database IDs. They report progress through Chrona commands such as `chrona.task.complete`, `chrona.condition.select`, `chrona.node.block`, `chrona.node.fail`, and `chrona.wait.complete`.

<p align="center">
  <img src="docs/assets/NodeDetail.png" width="80%" alt="Inspect a Chrona execution node with state, details, and activity" />
</p>

### Resume with context

Use the Work page, task workspace, memory console, assistant surfaces, conversation history, tool traces, and persisted outputs to understand and continue long-running work.

## Roadmap

This is a short summary of the project roadmap. See the full [roadmap](./docs/en/roadmap.md) for the source of truth.

| Status | Area | Scope |
| --- | --- | --- |
| Done | Task foundation | Task create/update/delete, completion/reopen, status, priority, labels, dependencies, parent/child relationships, and task projections. |
| Done | Schedule surfaces | Timeline/task views, AI insights, conflicts, schedule proposals, task creation, and configuration surfaces. |
| Done | Plan generation | Streaming AI plan generation, plan persistence, review/edit/accept flows, and materialization into graph nodes. |
| Done | Execution runtime | Executable `task`, `checkpoint`, `condition`, and `wait` nodes with AI-visible refs and persisted execution state. |
| Done | Review loops | Inbox surfaces for pending approvals, schedule proposals, waiting inputs, and failed/cancelled runs. |
| Next | Polish existing flows | Make Work, Schedule, Inbox, Task Workspace, and execution records more reliable and easier to understand. |
| Next | Reliable auto execution | Start due scheduled work only when configured and safe, with clear recovery when execution blocks or fails. |
| Next | More providers | Add more execution/provider integrations beyond the current provider set while keeping provider boundaries explicit. |
| Next | Multi-session execution | Let task execution use multiple sessions where needed, with clear isolation, reuse, recovery, and diagnostics. |
| Next | External calendars | Connect external calendar software so Chrona can coordinate scheduled work with existing calendar systems. |
| Later | Production readiness | Improve authentication, backup/restore, deployment docs, migration safety, observability, and operational runbooks. |

## Architecture

Chrona is a Vite + Hono monorepo running on Bun with SQLite persistence.

```text
React SPA
  -> Hono API server
  -> Chrona engine
      -> task / plan / schedule / projection modules
      -> graph-runtime execution state
      -> Prisma + SQLite persistence
      -> AI clients and provider adapters
```

| Area | Path |
| --- | --- |
| Web app | `apps/web/` |
| API server | `apps/server/` |
| CLI and binary entrypoints | `packages/cli/` |
| Shared schemas and runtime contracts | `packages/contracts/` |
| Database layer | `packages/db/` |
| Product engine | `packages/engine/` |
| Plan graph runtime | `packages/graph-runtime/` |
| Provider adapters | `packages/providers/` |

Read the [architecture guide](./docs/architecture.md), [data model](./docs/data-model.md), and [backend execution flow](./docs/backend-execution-flow.md) for deeper design notes.

## Configuration

Copy `.env.example` if you want local overrides.

| Variable | Purpose | Default / note |
| --- | --- | --- |
| `DATABASE_URL` | SQLite database URL | source default: `file:./prisma/dev.db`; Docker: `file:/data/chrona.db` |
| `HOST` | API server bind host | defaults to local-only `127.0.0.1` |
| `PORT` | API server port | `3101` |
| `API_KEY` | Optional bearer token for `/api/*` routes | Docker generates one when omitted |
| `CHRONA_WEB_DIST` | Built web app directory for static serving | `apps/web/dist` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist | omit for local development |
| `VITE_API_BASE_URL` | Frontend API base URL override | useful when web and API are split |

AI clients are configured in the web app under `Settings -> AI Clients`. Supported types are `llm` for OpenAI/OpenRouter-compatible APIs, `hermes` for Hermes-backed agent execution, and `debug` for local development/test flows.

## Development

Chrona requires Bun `>=1.3.11` for repository development.

```bash
bun install
bun run dev              # full development stack
bun run typecheck        # TypeScript
bun run lint             # ESLint
bun run test             # Vitest
bun run test:bun         # Bun-native tests
bun run test:api         # API tests
bun run test:e2e         # Playwright E2E tests
```

Before larger changes, also run:

```bash
bun run check:ui-foundation
bun run check:boundaries
bun run analyze
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, code style, boundary rules, schema-first contract rules, and testing expectations.

## Documentation

| Topic | Document |
| --- | --- |
| Documentation index | [docs/README.md](./docs/README.md) |
| Quick start | [English](./docs/en/quick-start.md) / [中文](./docs/zh/quick-start.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| API reference | [docs/api-reference.md](./docs/api-reference.md) |
| Data model | [docs/data-model.md](./docs/data-model.md) |
| Backend execution flow | [docs/backend-execution-flow.md](./docs/backend-execution-flow.md) |
| Provider boundary | [docs/provider-boundary.md](./docs/provider-boundary.md) |
| Package boundaries | [docs/package-boundaries.md](./docs/package-boundaries.md) |
| Roadmap | [English](./docs/en/roadmap.md) / [中文](./docs/zh/roadmap.md) |

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), run the relevant checks, and keep behavior covered by tests when changing task, schedule, execution, or navigation flows.

## License

MIT
