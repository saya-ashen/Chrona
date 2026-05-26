English | [中文](./README.zh.md)

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>

<h1 align="center">Chrona</h1>

<p align="center">
  <strong>Turn AI conversations into durable tasks, editable plans, scheduled work, and observable execution.</strong>
</p>

<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="./docs/en/quick-start.md">Full Guide</a> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./docs/en/roadmap.md">Roadmap</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="docs/assets/CreateTask.png" width="45%" alt="Create a structured Chrona task" />
  <img src="docs/assets/TaskWorkSpace.png" width="45%" alt="Inspect a Chrona task workspace with plan and execution context" />
</p>

---

Chrona is a local-first workbench for AI-native work. It keeps work out of disposable chat threads by connecting four layers that usually live in separate tools:

```text
Task -> Plan -> Schedule -> Execution
```

Use Chrona to capture a rough intent, turn it into an editable plan graph, place it on a schedule, execute it with AI or human checkpoints, and inspect what happened later.

## Why Chrona

AI chat is fast, but work state disappears into transcripts. Chrona makes the state explicit:

| If you need to... | Chrona gives you... |
| --- | --- |
| Save real work instead of prompts | durable tasks with priority, status, tags, dependencies, schedule metadata, and accepted results |
| Turn vague intent into steps | AI-generated plan graphs that can be reviewed, patched, accepted, and rerun |
| Keep time and execution connected | schedule blocks, conflicts, suggestions, waiting states, and inbox review queues |
| Let AI act without losing control | scoped runtime refs, checkpoints, approvals, tool traces, failures, and persisted outputs |

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
5. Create a task, generate a plan, review it, accept it, then start execution from the task workspace or Work page.

See the [full quick start](./docs/en/quick-start.md) for data directories, AI client details, and troubleshooting.

## What You Can Do

### Capture durable tasks

Create, update, complete, reopen, delete, tag, prioritize, estimate, relate, schedule, and accept results for real units of work.

### Generate editable plans

Turn a rough task into a structured plan blueprint. Accepted plans become persisted task plan layers and graph nodes instead of one-off assistant text.

### Execute graph-based work

Run plans as typed graphs with `task`, `checkpoint`, `condition`, and `wait` nodes. Nodes can be manual, assisted, or automatic, and can be assigned to user, AI, or system executors.

### Keep AI execution observable

AI workers receive safe runtime refs instead of internal database IDs. They report progress through Chrona commands such as `chrona.task.complete`, `chrona.condition.select`, `chrona.node.block`, `chrona.node.fail`, and `chrona.wait.complete`.

<p align="center">
  <img src="docs/assets/NodeDetail.png" width="80%" alt="Inspect a Chrona execution node with state, details, and activity" />
</p>

### Manage time and review queues

Use schedule views, AI insights, conflict suggestions, schedule proposals, waiting runs, failed runs, cancelled runs, and inbox approvals to keep work moving.

### Resume with context

Use the Work page, task workspace, memory console, assistant surfaces, conversation history, tool traces, and persisted outputs to understand and continue long-running work.

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
| `DATABASE_URL` | SQLite database URL | source default: `file:./prisma/dev.db`; Docker: `file:/data/chrona.db`; CLI: platform data directory |
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

## Project Status

Chrona is under fast active development. The core task, plan, schedule, execution, and AI-client flows are present, but APIs, runtime contracts, packaging, and deployment paths may still change before a stable release. Bun is the only supported runtime for now.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), run the relevant checks, and keep behavior covered by tests when changing task, schedule, execution, or navigation flows.

## License

MIT
