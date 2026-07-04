English | [中文](./README.zh.md)

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>

<h1 align="center">Chrona</h1>

<p align="center">
  <strong>Turn scheduled work into inspectable AI execution graphs.</strong>
</p>

<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#core-workflow">Workflow</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#local-first-and-safety">Safety</a> ·
  <a href="#project-status">Status</a> ·
  <a href="./docs/en/quick-start.md">Full Guide</a> ·
  <a href="./docs/en/architecture.md">Architecture</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

> [!WARNING]
> Chrona is in fast active development. It is Bun-only, APIs and runtime
> contracts may change, and the main product direction is a schedule-first app
> that can automatically execute due work.

<p align="center">
  <img src="docs/assets/generated/task-workspace.png" width="85%" alt="Chrona task workspace showing an executable AI plan graph" />
  <br />
  <em>Schedule work, review the generated plan, run it through an AI provider, and inspect every checkpoint, branch, approval, and output.</em>
</p>

---

Chrona is a local-first workspace for AI-assisted work. It helps you capture a
task, generate an editable plan, schedule it, run it manually or automatically,
and review what happened later.

Chrona connects four loops that usually live in separate tools:

```text
Task -> Plan -> Schedule -> Inspectable Execution
```

It is for work that should not disappear into chat history: recurring research,
release preparation, maintenance, follow-up tasks, and agent runs that need
state, approvals, recovery, and persisted outputs.

## Project Status

Chrona is usable for local development and product exploration, but it is not
stable software yet. The current codebase already includes task, plan, schedule,
execution, dashboard, settings, external calendar, and AI-client flows. The next
major focus is making the schedule-to-auto-execution loop reliable enough for
daily use.

## Why Chrona

Calendars tell you what should happen. Task apps tell you what is pending. AI
chat can do work, but it usually loses schedule, state, and accountability.
Chrona combines those loops without pretending they are the same thing.

| If you need to...                           | Chrona gives you...                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Plan the day around real work               | tasks with priority, status, due dates, estimates, dependencies, and schedule metadata    |
| Turn a scheduled task into executable steps | AI-generated plan graphs that can be reviewed, patched, accepted, rerun, and traced       |
| Let due work move forward automatically     | schedule blocks, proposals, waiting states, task workspace approvals, and execution actions |
| Keep AI execution accountable               | scoped runtime refs, checkpoints, approvals, tool traces, failures, and persisted outputs |

## Quick Start

Chrona is Bun-only today. The source repository uses Bun as the runtime; npm
package installation is not currently supported for repository development.

### Download a release

Use this path if you want to run Chrona without cloning the repository.

1. Open the
   [latest GitHub release](https://github.com/saya-ashen/Chrona/releases/latest).
2. Download the archive for your platform:

| Platform            | Asset                        |
| ------------------- | ---------------------------- |
| Linux x64           | `chrona-linux-x64.tar.gz`    |
| Linux ARM64         | `chrona-linux-arm64.tar.gz`  |
| macOS Apple Silicon | `chrona-darwin-arm64.tar.gz` |
| Windows x64         | `chrona-windows-x64.tar.gz`  |

3. Extract the archive and start Chrona:

```bash
tar -xzf chrona-linux-x64.tar.gz
cd chrona-linux-x64
./chrona start
```

On Windows, run the packaged executable instead:

```powershell
tar -xzf chrona-windows-x64.tar.gz
cd chrona-windows-x64
.\Chrona.exe start
```

Open `http://localhost:3101` after the server starts.

### Run from source

Use this path if you want to develop Chrona or inspect the codebase.

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

Open `http://localhost:3101`. `bun run dev` starts the Bun/Hono API server and
the Vite web app.

## First Run

You can explore Chrona without connecting a real provider: create tasks, build a
schedule, inspect the dashboard, and open task workspaces. AI plan generation and
agent execution require an AI client.

For the full execution loop:

1. Open `http://localhost:3101`.
2. Go to `Settings -> AI Clients` and add a provider client.
3. Choose `Claude Code` or `Codex` for real local agent execution.
4. Bind the client to features such as `task.plan`, `task.execution`, or
   `dashboard.brief`.
5. Create a task, give it enough context to be executable, and place it on the
   schedule.
6. Generate a plan from the task workspace, review or edit the generated graph,
   then accept it.
7. Start execution manually from the task workspace, or let Chrona move
   scheduled work forward when auto-execution is configured.
8. Review progress, blockers, approvals, tool activity, and outputs from the
   task workspace or Dashboard.

See the [full quick start](./docs/en/quick-start.md) for data directories, AI
client details, and troubleshooting.

## Core Workflow

1. **Capture work** — create a task with priority, estimates, due dates,
   dependencies, and schedule metadata.
2. **Generate a plan** — turn rough context into a structured plan graph.
3. **Review before execution** — patch, accept, or rerun plans before they
   become executable task nodes.
4. **Run with state** — execute `task`, `checkpoint`, `condition`, and `wait`
   nodes manually, with AI assistance, or automatically when configured.
5. **Inspect and recover** — review approvals, tool activity, failures,
   blockers, persisted outputs, and next actions from the workspace.

<p align="center">
  <img src="docs/assets/generated/node-detail.png" width="80%" alt="Inspect a Chrona execution node with state, details, and activity" />
  <br />
  <em>Execution records stay attached to the task, including node state, tool activity, and output.</em>
</p>

## Providers

Chrona separates product workflow from execution providers. You configure
providers as AI clients, then bind those clients to Chrona features.

| Provider type | Status | Use it for | Notes |
| --- | --- | --- | --- |
| `claude_code` | Primary supported provider | Claude Code-backed plan generation and task execution through scoped MCP control tools | Uses the user's Claude Code config by default when no config directory is set |
| `codex` | Primary supported provider | Codex-backed plan generation and task execution through scoped MCP control tools | Uses the user's default `CODEX_HOME` (`~/.codex`) when no config directory is set |
| `hermes` | Pending update | Hermes gateway integrations for local or remote agent execution | Available for existing Hermes setups; provider docs/config flow has not been updated yet |

### Claude Code Setup

Use `Settings -> AI Clients -> Add Client -> Claude Code`.

Common fields:

| Field | Purpose | Default / note |
| --- | --- | --- |
| Model | Claude model passed to Claude Code | Defaults to Chrona's provider default if left empty |
| API key | Anthropic API key for Claude Code | Optional; leave empty to use the user's existing Claude Code auth/config |
| Config directory | Claude Code config/state directory | Optional; empty means Claude Code's default user-level config |
| Working directory | Filesystem scope for the run | Optional; defaults to the Chrona process working directory |
| MCP base URL | Chrona `/api/mcp` server URL | Defaults to the current Chrona server |
| MCP bearer token | Bearer token for Chrona MCP requests | Usually leave empty; use `CHRONA_API_KEY` or `CHRONA_MCP_BEARER_TOKEN` when API auth is enabled |
| Timeout | Maximum provider run time | Optional |

### Codex Setup

Use `Settings -> AI Clients -> Add Client -> Codex`.

Common fields:

| Field | Purpose | Default / note |
| --- | --- | --- |
| Model | Codex model passed through provider config | Optional |
| API key | OpenAI/Codex API key | Optional; also passed as `CODEX_API_KEY` and `OPENAI_API_KEY` for the provider process |
| Base URL | OpenAI-compatible gateway URL | Optional |
| Config directory | Codex home directory | Optional; empty means default user-level `CODEX_HOME` (`~/.codex`) |
| Working directory | Filesystem scope for the run | Optional; defaults to the Chrona process working directory |
| MCP base URL | Chrona `/api/mcp` server URL | Defaults to the current Chrona server |
| MCP bearer token | Bearer token for Chrona MCP requests | Usually leave empty; use `CHRONA_API_KEY` or `CHRONA_MCP_BEARER_TOKEN` when API auth is enabled |
| Timeout | Maximum provider run time | Optional |

For provider troubleshooting, use the [full quick start](./docs/en/quick-start.md).

## Local-first and Safety

Chrona is designed to start local and explicit.

| Area | Default / behavior |
| --- | --- |
| Storage | SQLite. Source development defaults to `file:./prisma/dev.db`; packaged releases use the platform data directory unless overridden. |
| Network binding | `HOST` defaults to local-only `127.0.0.1`. |
| API auth | `API_KEY` is optional for local development; set it before exposing `/api/*` beyond localhost. |
| CORS | `ALLOWED_ORIGINS` can restrict browser origins when web and API are split. |
| Provider scope | AI workers receive scoped runtime refs and Chrona control tools instead of raw internal database IDs. |
| Automatic execution | Requires explicit provider/feature configuration and remains visible through task workspace state, approvals, blockers, and run records. |

## Features

- **Real schedules** — tasks carry priority, estimates, due dates,
  dependencies, and schedule metadata.
- **Editable plan graphs** — generated plans can be reviewed, patched, accepted,
  rerun, and materialized into typed graph nodes.
- **Graph-based execution** — `task`, `checkpoint`, `condition`, and `wait`
  nodes support manual, assisted, and automatic work.
- **Due-work recovery** — schedule views, AI insights, conflict suggestions,
  proposals, waiting runs, failed runs, cancelled runs, and approvals keep the
  next action visible.
- **Observable AI work** — provider runs receive safe runtime refs instead of
  internal database IDs. They report progress through Chrona tools such as
  `chrona_node_complete`, `chrona_condition_select`, `chrona_node_block`,
  `chrona_node_fail`, and `chrona_wait_complete`. Conversation history, tool
  traces, and persisted outputs stay attached to the task.

<p align="center">
  <img src="docs/assets/NodeDetail.png" width="80%" alt="Inspect a Chrona execution node with state, details, and activity" />
</p>

## Roadmap

This is a short maturity summary. See the full
[roadmap](./docs/en/roadmap.md) for the source of truth.

| Area | Availability | Maturity | Notes |
| --- | --- | --- | --- |
| Task foundation | Available | Usable | Task create/update/delete, completion/reopen, status, priority, labels, dependencies, parent/child relationships, and projections. |
| Schedule surfaces | Available | Usable, polishing | Timeline/task views, AI insights, conflicts, schedule proposals, task creation, and configuration surfaces. |
| Plan generation | Available | Experimental | Streaming AI plan generation, persistence, review/edit/accept flows, and materialization into graph nodes. |
| Execution runtime | Available | Experimental | Executable `task`, `checkpoint`, `condition`, and `wait` nodes with AI-visible refs and persisted state. |
| Review loops | Available | Experimental | Dashboard and task workspace surfaces for pending approvals, schedule proposals, waiting inputs, and failed/cancelled runs. |
| External calendars | Available | Early | Read-only calendar subscriptions, imported busy events, source management, refresh status, and schedule context. |
| Polish existing flows | In progress | Active | Make Dashboard, Schedule, Task Workspace, and execution records more reliable and easier to understand. |
| Reliable auto execution | In progress | Not stable | Start due scheduled work only when configured and safe, with clear recovery when execution blocks or fails. |
| More providers | In progress | Experimental | Add provider integrations while keeping provider boundaries explicit. |
| Multi-session execution | Planned | Not available | Add isolation, reuse, recovery, and diagnostics across multiple sessions. |
| Production readiness | Planned | Not ready | Authentication, backup/restore, deployment docs, migration safety, observability, and operational runbooks. |

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

| Area                                 | Path                      |
| ------------------------------------ | ------------------------- |
| Web app                              | `apps/web/`               |
| API server                           | `apps/server/`            |
| CLI and binary entrypoints           | `packages/cli/`           |
| Shared schemas and runtime contracts | `packages/contracts/`     |
| Database layer                       | `packages/db/`            |
| Product engine                       | `packages/engine/`        |
| Plan graph runtime                   | `packages/graph-runtime/` |
| Provider adapters                    | `packages/providers/`     |

Read the [architecture guide](./docs/en/architecture.md),
[data model](./docs/en/data-model.md), and
[backend execution flow](./docs/en/backend-execution-flow.md) for deeper design
notes.

## Configuration

Copy `.env.example` if you want local overrides.

| Variable            | Purpose                                    | Default / note                                                                                              |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | SQLite database URL                        | source default: `file:./prisma/dev.db`; packaged releases use the platform data directory unless overridden |
| `HOST`              | API server bind host                       | defaults to local-only `127.0.0.1`                                                                          |
| `PORT`              | API server port                            | `3101`                                                                                                      |
| `API_KEY`           | Optional bearer token for `/api/*` routes  | omit for local-only development                                                                             |
| `CHRONA_WEB_DIST`   | Built web app directory for static serving | `apps/web/dist`                                                                                             |
| `ALLOWED_ORIGINS`   | Comma-separated CORS allowlist             | omit for local development                                                                                  |
| `VITE_API_BASE_URL` | Frontend API base URL override             | useful when web and API are split                                                                           |

AI clients are configured in the web app under `Settings -> AI Clients`. See
[Providers](#providers) for supported provider types and Claude Code/Codex setup.

## FAQ

### Can I use Chrona without an AI provider?

Yes. You can create tasks, schedule work, inspect the dashboard, and use task
workspaces without an AI provider. Real AI plan generation and agent execution
require a configured AI client. Use Claude Code or Codex for the primary local
agent execution paths.

### Is Chrona production-ready?

No. Chrona is usable for local development and product exploration, but runtime
contracts, provider behavior, and auto-execution flows are still changing.

### Where does Chrona store data?

Source development defaults to `file:./prisma/dev.db`. Packaged releases use the
platform data directory unless `DATABASE_URL` overrides it.

### Does automatic execution run silently?

No. Automatic execution requires provider/feature configuration and remains
visible through task workspace state, approvals, blockers, activity, and run
records.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, code style, boundary rules,
schema-first contract rules, and testing expectations.

## Documentation

| Topic                  | Document                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| Documentation index    | [docs/README.md](./docs/README.md)                                     |
| Quick start            | [English](./docs/en/quick-start.md) / [中文](./docs/zh/quick-start.md) |
| Architecture           | [docs/en/architecture.md](./docs/en/architecture.md)                         |
| API reference          | [docs/en/api-reference.md](./docs/en/api-reference.md)                       |
| Data model             | [docs/en/data-model.md](./docs/en/data-model.md)                             |
| Backend execution flow | [docs/en/backend-execution-flow.md](./docs/en/backend-execution-flow.md)     |
| Provider boundary      | [docs/en/provider-boundary.md](./docs/en/provider-boundary.md)               |
| Package boundaries     | [docs/en/package-boundaries.md](./docs/en/package-boundaries.md)             |
| Roadmap                | [English](./docs/en/roadmap.md) / [中文](./docs/zh/roadmap.md)         |
| Security               | [SECURITY.md](./SECURITY.md)                                           |
| Code of Conduct        | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)                             |

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), run
the relevant checks, and keep behavior covered by tests when changing task,
schedule, execution, or navigation flows.

## License

MIT
