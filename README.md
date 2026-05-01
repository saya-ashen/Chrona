[English](./README.md) | [中文](./README.zh.md)

<p align="center">
  <h1 align="center">Chrona</h1>
  <p align="center">AI-native task control plane — connecting task planning, scheduling, and AI agent execution into one continuous workflow.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@chrona-org/cli"><img src="https://img.shields.io/npm/v/@chrona-org/cli?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@chrona-org/cli"><img src="https://img.shields.io/npm/dt/@chrona-org/cli" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/bun-%3E%3D%201.3.11-black" alt="Bun >= 1.3.11"></a>
</p>

---

Chrona is an AI-native task control plane that turns vague task ideas into
executable plans and connects those plans to your schedule and AI agent runs.

Describe a piece of work, let Chrona generate a step-by-step execution plan,
schedule it on your calendar, and run AI agents when appropriate to help
complete the task. Chrona runs local-first with SQLite, and uses a
provider-agnostic adapter layer to connect different AI runtimes such as
OpenClaw, LLM backends, and future Hermes / Opencode integrations.

## What makes Chrona different

Chrona is not just another Todo List, and it is not an isolated AI Chat window.
It focuses on two core problems:

1. how AI can generate truly executable plans from personal context;
2. how those plans can be connected to schedules and handed off to AI agents at
   the right time.

### 1. AI plan generation based on personal context

Traditional task managers require users to manually break work down. Generic AI
chat tools usually generate one-off checklists based only on the current prompt.
Chrona aims to generate execution plans that fit the way each person actually
works.

Chrona can combine the task description, existing schedule, recent work context,
historical tasks, runtime Skills, agent memory, and available tools to generate
a plan graph with steps, dependencies, checkpoints, and human-in-the-loop
decision points. The result is not a generic checklist, but an execution plan
tailored to the current user, project, and schedule.

### 2. A task system designed for automatic execution

Chrona’s long-term goal is not just to remind users what to do, but to make
planned work executable.

After a task is decomposed and scheduled, Chrona can connect the plan to AI
agent runs. The system distinguishes between steps that are safe to execute
automatically and steps that require user input, confirmation, or approval. In
the future, Chrona will support automatically triggering agent runs according to
the schedule, completing steps that do not require human intervention, and
interrupting the user only when judgment, authorization, or additional
information is needed.

> Automatic execution is still under active development. Today, Chrona focuses
> on plan generation, the scheduling cockpit, human review, and supervised agent
> runs.

## Current capabilities

- **Suggest-first, confirm-later** — AI does not directly mutate tasks, plans,
  or schedules. It creates proposals that users can review and accept.
- **AI plan graph generation** — Break tasks into steps, dependencies,
  checkpoints, user inputs, and executable nodes.
- **Scheduling cockpit** — Arrange tasks in a calendar view, inspect conflicts,
  and receive AI-powered time slot suggestions.
- **Supervised agent runs** — Start AI agent runs inside tasks and inspect
  conversations, tool calls, approval requests, and execution state.
- **Provider-agnostic adapter layer** — Connect LLM backends, OpenClaw, and
  future Hermes / Opencode runtimes through one unified interface.
- **Local-first** — Run with a local SQLite database and minimal setup. No cloud
  service or account required.
- **Event-sourced architecture** — Task lifecycles are recorded as immutable
  events, enabling auditability, replay, and AI-friendly context construction.

## Quick start

```bash
npm install -g @chrona-org/cli    # install via npm (Bun runtime is embedded)
chrona start                       # opens http://localhost:3101 in your browser
```

Chrona runs on **Bun** only as the application runtime. The npm package ships
with an embedded Bun binary — no separate Bun install is required when installing
via npm. For local development, use Bun directly:

```bash
bun install
bun run dev
```

On first launch, Chrona automatically creates the SQLite database and
configuration directory. Configure AI backends in **Settings > AI Clients**:

- **LLM** — Any OpenRouter-compatible API, including OpenRouter or
  OpenAI-compatible proxies
- **OpenClaw** — Dedicated agent execution through the OpenClaw gateway bridge

More backends, including Hermes and Opencode, are planned. Each backend is
wrapped behind the unified `RuntimeExecutionAdapter` interface, so switching
providers does not change your task model or workflow.

## Features

### Scheduling cockpit

View, drag, and adjust scheduled task blocks in a calendar interface. Chrona can
detect scheduling conflicts and suggest time slots based on task duration,
context, and historical habits.

![Schedule](./docs/assets/screenshot-schedule.png)

### Task workspace with plan graph

Chrona decomposes tasks into editable plan graphs, including steps,
dependencies, checkpoints, user inputs, deliverables, and tool actions.
AI-generated plans stream over SSE and can be reviewed, edited, and accepted
before they take effect.

### Supervised agent execution

Start AI agent runs from tasks and inspect real-time conversations, tool calls,
approval requests, in-run user input, and execution state. Chrona’s goal is to
gradually increase the amount of work that can be automated while keeping users
in control.

### Persistent agent memory

Agents can accumulate workspace-level knowledge across runs and reuse that
context in future plan generation and task execution. Memory is queryable,
revocable, and persisted across sessions.

![Memory](./docs/assets/screenshot-memory.png)

### Inbox triage

A central dashboard for pending approvals, AI-generated schedule proposals, and
task suggestions.

![Inbox](./docs/assets/screenshot-inbox.png)

### Multi-backend AI and provider adapters

Chrona is designed to be **provider-agnostic** at the architecture level. AI
runtimes are abstracted through the unified `RuntimeExecutionAdapter` interface,
so the same task model and workflow can work across different backends.

| Backend      | Type                              | Status      |
| ------------ | --------------------------------- | ----------- |
| **LLM**      | Any OpenRouter-compatible API     | ✅ Released |
| **OpenClaw** | Dedicated agent execution gateway | ✅ Released |
| **Hermes**   | Deep agent / tool orchestration   | 📋 Planned  |
| **Opencode** | Opencode agent runtime            | 📋 Planned  |

You can configure multiple AI clients and bind different capabilities, such as
suggestion, decomposition, conflict detection, time slot selection, and chat, to
different backends. For example, you can use OpenClaw to generate plans while
routing conversation to an LLM backend.

![AI Clients](./docs/assets/screenshot-ai-clients.png)

### CLI client

A full command-line interface for the local API server:

```bash
chrona task list                     # list tasks
chrona task create --title "..."     # create a task
chrona run start <task-id>           # start an agent run
chrona schedule list                 # list scheduled tasks
chrona ai suggest --title "..."      # get AI task suggestions
```

### Multilingual interface

English and Chinese interfaces, with locale-based routing and `Accept-Language`
negotiation.

## Architecture

Chrona is built on SQLite with CQRS + event sourcing. Commands write canonical
events and rebuild projections; queries read materialized views. AI features
follow a “suggest-first, confirm-later” pattern and do not directly mutate user
data by default.

| Layer      | Technology                                  |
| ---------- | ------------------------------------------- |
| Frontend   | React 19, React Router 7 SPA, Vite          |
| API Server | Hono, serving both REST API and static SPA  |
| Database   | SQLite, Prisma 7 with Bun SQLite adapter    |
| Runtime    | Bun (application runtime); Node.js (build tools only) |
| AI         | LLM providers + OpenClaw bridge             |
| Language   | TypeScript strict                           |

```text
                  Client Layer
┌──────────────┐  ┌──────────┐  ┌───────────────┐
│ React SPA    │  │ CLI      │  │ OpenClaw      │
│ React Router │  │ chrona   │  │ Bridge        │
└──────┬───────┘  └────┬─────┘  └───────┬───────┘
       └───────────────┼────────────────┘
                       ▼
         ┌─────────────────────────┐
         │    Hono API Server      │
         │  /api/tasks  /api/ai    │
         │  /api/schedule ...      │
         └───────────┬─────────────┘
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
  ┌────────┐   ┌─────────┐   ┌──────────┐
  │Command │   │ Query   │   │ AI Layer │
  └───┬────┘   └────┬────┘   └──────────┘
      ▼             ▼
 ┌────────┐   ┌─────────────┐
 │ Events │──▶│ Projections │
 │immutable│  │materialized │
 └────────┘   └─────────────┘
      │
      ▼
 ┌─────────────┐
 │   SQLite    │
 └─────────────┘
```

Full docs: [Architecture](./docs/architecture.md) |
[Data Model](./docs/data-model.md) | [API Reference](./docs/api-reference.md)

## Comparison

|                                     | Chrona                                                                                                | Task managers<br/>(Linear, Todoist)      | AI chat apps<br/>(ChatGPT, Claude)             | Autonomous agents<br/>(AutoGPT, crewAI)           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| **Task decomposition and planning** | AI-generated personalized plan graph using agent Skills and memory, editable by the user              | Manual lists / subtasks                  | One-off, no structured plan                    | Agent-generated, low user control                 |
| **Calendar scheduling**             | Drag-and-drop + AI time slot suggestions                                                              | Available, but usually not AI-integrated | None                                           | None                                              |
| **Autonomous execution**            | Planned: schedule-triggered runs with separation between automatic steps and human-intervention steps | None                                     | None                                           | Usually fully autonomous with limited supervision |
| **AI change protection**            | Suggest-confirm proposal mode                                                                         | Not applicable                           | Replies only                                   | Direct actions, limited undo                      |
| **Persistent agent memory**         | Scoped, queryable, revocable                                                                          | None                                     | Usually depends on single conversation context | Often temporary or run-based                      |
| **Architecture**                    | CQRS + event sourcing                                                                                 | CRUD                                     | Stateless                                      | Varies                                            |
| **Deployment**                      | Self-hosted, local SQLite                                                                             | Cloud SaaS                               | Cloud SaaS / API                               | Usually cloud or Docker                           |
| **Open source**                     | MIT                                                                                                   | Proprietary                              | Proprietary                                    | Often open source                                 |
| **Vendor lock-in**                  | Provider-agnostic adapters; freely switch backends                                                    | Not applicable                           | Tied to provider                               | Usually tied to a framework                       |

## Roadmap

| Phase                                             | Focus                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **One — Scheduling cockpit** _(current)_          | Smart task creation, AI plan generation, and scheduling UI as the daily cockpit                                                                                                      |
| **Two — Plan-aware automatic execution** _(next)_ | Schedule-triggered agent runs, live plan progress tracking, automatic plan updates, and separation between automatic steps and steps requiring user input, confirmation, or approval |
| **Three — Multi-runtime**                         | Unified workflows across LLM, OpenClaw, Hermes, and Opencode backends                                                                                                                |

Full roadmap: [English](./docs/en/roadmap.md) | [中文](./docs/zh/roadmap.md)

## Project structure

```text
apps/
  web/          — Vite React SPA
  server/       — Hono API server + static SPA
packages/
  cli/          — Chrona CLI entrypoint for npm
  common/
    cli/        — CLI commands: task, run, schedule, ai
    ai-features/— AI feature layer
  contracts/    — Shared DTOs, Zod schemas, API contracts
  db/           — Prisma bootstrap and repositories
  domain/       — Pure business rules
  runtime/      — CQRS: commands, queries, projections, events
  providers/
    openclaw/   — OpenClaw bridge and integration
    hermes/     — Hermes provider, planned
    opencode/   — Opencode provider, planned
```

## Documentation

| Document                                                              | Description                 |
| --------------------------------------------------------------------- | --------------------------- |
| [Quick Start (EN)](./docs/en/quick-start.md)                          | English quick start         |
| [快速开始（中文）](./docs/zh/quick-start.md)                          | Chinese quick start         |
| [Architecture](./docs/architecture.md)                                | System design and data flow |
| [Data Model](./docs/data-model.md)                                    | Database schema reference   |
| [API Reference](./docs/api-reference.md)                              | REST API reference          |
| [Roadmap (EN)](./docs/en/roadmap.md) / [路线图](./docs/zh/roadmap.md) | Product roadmap             |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Development requires Bun. The npm
package is a compiled binary artifact with an embedded Bun runtime.

## License

MIT
