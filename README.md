[English](./README.md) | [中文](./README.zh.md)

# Chrona

AI-native task control plane — plan, schedule, and execute work through AI agents.

## Install

```bash
npm install -g @chrona-org/cli
```

Requirements: **Node.js >= 20**. No Bun, no build tools needed.

## Quick Start

```bash
chrona start
```

Opens the web app at `http://localhost:3101`. The first launch auto-creates the SQLite database and config file — no manual setup.

Configure AI backends on the **Settings > AI Clients** page in the web app. Two backend types are supported:

- **LLM** — any OpenRouter-compatible API (OpenRouter, OpenAI-compatible proxies)
- **OpenClaw** — OpenClaw gateway bridge for agent execution

## CLI

The same `chrona` binary also provides a command-line client targeting the local API server:

```
chrona task list                     List tasks in the default workspace
chrona task create --title "..."    Create a task
chrona task show <id>               Show task details
chrona run start <task-id>          Start an agent run
chrona schedule list                List scheduled tasks
chrona ai suggest --title "..."     Get AI task suggestions
```

Add `--base-url` to point at a different server.

## Features

- **Schedule cockpit** — Calendar view with drag-and-drop time blocks, conflict detection, and AI timeslot suggestions
- **Task workspace** — Editable plan graphs (nodes, edges, dependencies) with AI plan generation and streaming
- **Agent execution** — Run AI agents on tasks with live conversation, tool calls, approvals, and input prompts
- **Persistent memory** — Agents accumulate and query workspace-scoped knowledge
- **Inbox triage** — Pending approvals, schedule proposals, and AI suggestions
- **Multi-language** — English and Chinese UI

## Architecture

CQRS + Event Sourcing over SQLite. Commands write canonical events and rebuild projections; queries read materialized views. AI features follow a suggest-confirm pattern — no direct mutation.

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7 (SPA) via Vite |
| API server | Hono (serves both API and static SPA) |
| Database | SQLite via Prisma 7 |
| Runtime | Node.js (npm) / Bun (dev) |
| AI | LLM providers + OpenClaw bridge |

Full architecture: [docs/architecture.md](./docs/architecture.md)

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start (EN)](./docs/en/quick-start.md) | Setup and first run |
| [快速开始（中文）](./docs/zh/quick-start.md) | Chinese quick start |
| [Architecture](./docs/architecture.md) | System design and data flow |
| [Data Model](./docs/data-model.md) | Database schema reference |
| [API Reference](./docs/api-reference.md) | REST API endpoints |
| [Roadmap (EN)](./docs/en/roadmap.md) / [路线图](./docs/zh/roadmap.md) | Product roadmap |

## Project Structure

```
apps/
  web/          — Vite React SPA
  server/       — Hono API server + static SPA host
packages/
  cli/          — Chrona CLI entry point (npm)
  common/
    cli/        — CLI commands (task, run, schedule, ai)
    ai-features/— AI feature surface
  contracts/    — Shared DTOs, Zod schemas, API contracts
  db/           — Prisma bootstrap, repositories
  domain/       — Pure business rules
  runtime/      — CQRS: commands, queries, projections, events
  providers/
    openclaw/   — OpenClaw bridge & integration
    hermes/     — Hermes provider (future)
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Development uses Bun; the npm build is a compiled artifact.

## License

MIT
