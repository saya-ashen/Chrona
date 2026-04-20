# 🎛️ AgentDashboard

> **AI-Native Task Control Plane** — Plan, schedule, and observe AI-runtime-powered work.

AgentDashboard is a control plane for AI agent workflows. It provides schedule planning, task management, execution collaboration, an inbox, and memory management. Built on CQRS/Event Sourcing architecture, it supports real-time interaction with AI runtimes via OpenClaw, enabling humans and AI agents to collaborate efficiently in a single interface.

[中文文档](#-中文说明)

---

## ✨ Features

| Module | Description |
|--------|-------------|
| **Schedule** | Timeline view for managing schedules and time blocks; AI-assisted timeslot suggestions and conflict detection |
| **Work** | Real-time workbench for AI agent collaboration; conversational interaction, approval workflows, execution timeline |
| **Tasks** | Task creation, decomposition, and state management; AI-driven task decomposition and automation suggestions |
| **Inbox** | Unified notification and message center aggregating action items from all modules |
| **Memory** | Agent memory persistence and retrieval, supporting context-aware AI interactions |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **UI** | React 19 + Tailwind CSS 4 + shadcn/ui + Base UI + Lucide Icons |
| **Language** | TypeScript (strict) |
| **Runtime** | Bun |
| **Database** | SQLite (via better-sqlite3) |
| **ORM** | Prisma 7 (with driver adapters) |
| **Validation** | Zod 4 |
| **Testing** | Vitest + Testing Library + Playwright (E2E) |
| **CLI** | Commander.js + chalk + cli-table3 |
| **i18n** | English + Chinese (built-in) |

---

## 🏗️ Architecture

AgentDashboard uses **CQRS (Command Query Responsibility Segregation)** and **Event Sourcing**:

```
┌─────────────────────────────────────────────────────────┐
│                     AgentDashboard                       │
│                                                         │
│  ┌──────────┐ ┌──────┐ ┌───────┐ ┌──────────────┐    │
│  │ Schedule │ │ Work │ │ Tasks │ │ Inbox/Memory │    │
│  └────┬─────┘ └──┬───┘ └──┬────┘ └──────┬───────┘    │
│       └──────────┴────────┴──────────────┘             │
│                  Next.js API Routes                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │             CQRS / Event Sourcing                 │  │
│  │  Commands ──▶ Events ──▶ Projections ──▶ Queries │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │          Runtime Adapter Abstraction               │  │
│  │  ┌─────────────┐ ┌────────────┐ ┌─────────────┐ │  │
│  │  │ CLI Bridge  │ │  Gateway   │ │    Mock     │ │  │
│  │  │   (HTTP)    │ │ (WebSocket)│ │  (Testing)  │ │  │
│  │  └─────────────┘ └────────────┘ └─────────────┘ │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │            Prisma 7 + SQLite                      │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Design Principles

- **Commands** — Encapsulate all writes, producing domain events
- **Queries** — Pure reads from optimized projections
- **Projections** — Listen to events, maintain read-optimized models
- **Events** — Immutable domain events as the single source of truth
- **Runtime Adapter** — Abstracts AI runtime interaction; supports `bridge` (CLI) and `mock` modes

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0

### Install & Run

```bash
# Clone
git clone https://github.com/your-org/AgentDashboard.git
cd AgentDashboard

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env as needed

# Generate Prisma Client
bunx prisma generate

# Initialize database
bun run db:seed

# Start dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 📁 Project Structure

```
AgentDashboard/
├── prisma/                        # Prisma schema + migrations + seed
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── [lang]/                # i18n page routes (en, zh)
│   │   │   ├── schedule/          # Schedule planning page
│   │   │   ├── workspaces/*/work/ # Execution collaboration page
│   │   │   ├── tasks/             # Task center page
│   │   │   ├── inbox/             # Inbox page
│   │   │   ├── memory/            # Memory management page
│   │   │   └── settings/          # Settings pages
│   │   └── api/                   # REST API routes
│   │       ├── ai/                # AI feature endpoints
│   │       ├── tasks/             # Task CRUD + actions
│   │       ├── work/              # Work projection
│   │       ├── schedule/          # Schedule projection
│   │       ├── inbox/             # Inbox projection
│   │       └── memory/            # Memory projection
│   ├── modules/                   # Business logic (server-side)
│   │   ├── ai/                    # AI service (LLM, decomposition, suggestions)
│   │   ├── commands/              # CQRS write commands
│   │   ├── queries/               # CQRS read queries
│   │   ├── projections/           # Event → read model projections
│   │   ├── events/                # Domain event recording
│   │   ├── runtime/               # Runtime adapter layer
│   │   │   ├── openclaw/          # OpenClaw adapter (bridge + gateway + mock)
│   │   │   └── research/          # Research adapter
│   │   ├── tasks/                 # Task state derivation
│   │   └── workspaces/            # Workspace management
│   ├── components/                # React components
│   │   ├── ui/                    # Base UI primitives
│   │   ├── schedule/              # Schedule module components
│   │   │   ├── panels/            # Side panels & cards
│   │   │   ├── timeline/          # Timeline view
│   │   │   ├── dialogs/           # Dialogs & sheets
│   │   │   ├── forms/             # Input forms
│   │   │   ├── task-plan/         # Task plan components
│   │   │   └── utils/             # Schedule utilities
│   │   ├── work/                  # Work module components
│   │   │   └── work-page/         # Work page sub-components
│   │   ├── tasks/                 # Task module components
│   │   ├── inbox/                 # Inbox components
│   │   ├── memory/                # Memory components
│   │   ├── workspaces/            # Workspace components
│   │   └── i18n/                  # i18n components
│   ├── hooks/                     # React hooks
│   │   └── ai/                    # AI feature hooks
│   ├── services/                  # External service integrations
│   │   └── openclaw-bridge/       # CLI Bridge HTTP server
│   ├── cli/                       # CLI client (agentdash)
│   ├── i18n/                      # i18n config & message files
│   └── lib/                       # Shared utilities
├── docs/                          # Documentation
├── .env.example                   # Environment variable template
└── package.json
```

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `file:./prisma/dev.db` |
| `OPENCLAW_MODE` | Runtime mode: `bridge` or `mock` | `bridge` |
| `OPENCLAW_BRIDGE_URL` | CLI Bridge HTTP URL | `http://localhost:7677` |
| `OPENCLAW_TIMEOUT` | CLI execution timeout (seconds) | `300` |
| `AI_PROVIDER_*` | AI provider config (API keys, model names) | — |
| `NEXT_PUBLIC_WORK_POLL_INTERVAL_MS` | Work page poll interval (ms) | `10000` |

### OpenClaw Modes

- **`bridge`** (recommended) — Uses the CLI Bridge HTTP server wrapping `openclaw agent --local --json`.
- **`mock`** — In-memory mock adapter for development and testing. No external dependencies.

---

## 📦 Commands

```bash
# Development
bun run dev                         # Start dev server
bun run build                       # Production build
bun run start                       # Start production server

# Testing
bun run test                        # Unit tests (Vitest)
bun run test:watch                  # Watch mode
bun run test:e2e                    # E2E tests (Playwright)

# Database
bunx prisma generate                # Generate Prisma Client
bun run db:seed                     # Seed database

# CLI
bun run agentdash --help            # CLI help
bun run agentdash task list         # List tasks
bun run agentdash schedule today    # Today's schedule

# OpenClaw Bridge
bun run services/openclaw-bridge/server.ts  # Start CLI Bridge
```

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [docs/architecture.md](./docs/architecture.md) | System architecture — CQRS, event sourcing, data model |
| [docs/api-reference.md](./docs/api-reference.md) | REST API reference — all endpoints with examples |
| [docs/getting-started.md](./docs/getting-started.md) | Detailed setup guide |
| [docs/data-model.md](./docs/data-model.md) | Database schema and data model |

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

---

---

## 🇨🇳 中文说明

AgentDashboard 是一个面向 AI Agent 工作流的控制面板，提供日程规划、任务管理、执行协作、消息收件箱和记忆管理等核心能力。它采用 CQRS/事件溯源架构，支持通过 OpenClaw 与 AI 运行时进行实时交互，让人类与 AI Agent 在同一界面中高效协作。

### 核心功能

- **Schedule（日程规划）** — 时间轴视图，管理日程安排与时间块；AI 辅助时间段建议与冲突检测
- **Work（执行协作）** — 与 AI Agent 的实时工作台；对话式交互、审批流程、执行时间线追踪
- **Tasks（任务中心）** — 任务的创建、分解、状态管理；支持 AI 驱动的任务自动分解
- **Inbox（收件箱）** — 统一的通知与消息中心
- **Memory（记忆管理）** — Agent 记忆的持久化与检索

### 快速开始

```bash
bun install && cp .env.example .env && bunx prisma generate && bun run db:seed && bun run dev
```

详细文档请参阅上方英文部分。

---

<p align="center">
  <sub>Built with ❤️ using Next.js 16, React 19, and Bun</sub>
</p>
