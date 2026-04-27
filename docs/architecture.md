# System Architecture

## Architecture Pattern: CQRS + Event Sourcing

Chrona uses **CQRS (Command Query Responsibility Segregation)** combined with **Event Sourcing**. All state changes are triggered by commands, which produce canonical events persisted to the event store, then rebuild materialized projections for the query layer.

### Why this architecture?

1. **Complete audit trail** — every operation is recorded as an immutable event, tracing the full task lifecycle
2. **Read/write separation** — write path (commands) and read path (queries) are independently optimizable
3. **Rebuildable state** — projections can be rebuilt from the event sequence at any time, ensuring data consistency
4. **AI-friendly** — event streams are naturally suited for AI agent decision-making and analysis

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        Client Layer                           │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Vite React SPA   │  │ Chrona CLI   │  │ AI Agent /     │  │
│  │ React Router     │  │ chrona       │  │ OpenClaw Bridge│  │
│  └────────┬─────────┘  └──────┬───────┘  └────────┬───────┘  │
└───────────┼───────────────────┼────────────────────┼──────────┘
            │                   │                    │
            ▼                   ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│                Local API / Static Host (Hono)                 │
│  /api/tasks/*   /api/ai/*   /api/schedule/*                  │
│  /api/inbox/*   /api/memory/*  /api/work/*                   │
│  production: serves apps/web/dist as static SPA              │
└──────────────────────────────┬───────────────────────────────┘
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
┌──────────────┐ ┌─────────┐ ┌──────────┐
│  Command      │ │ Query   │ │  AI     │
│  handlers     │ │handlers │ │ features│
└──────┬───────┘ └────┬─────┘ └──────────┘
       │              │
       ▼              ▼
┌──────────────┐ ┌──────────────┐
│   Events     │ │ Projections  │
│   (immutable)│ │ (materialized│
│              │ │  views)      │
└──────┬───────┘ └──────────────┘
       │
       ▼
┌──────────────────────────────────┐
│        Data Storage              │
│   SQLite + Prisma ORM            │
│   15 models / event log /        │
│   projection tables              │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│      External Runtime Layer      │
│   OpenClaw CLI Bridge (HTTP)     │
│   Runtime adapters / Agent exec  │
└──────────────────────────────────┘
```

## Data Flow

### Write Path (Command Path)

```
User action → Hono API route → Command handler → DB mutation → Append canonical event → Rebuild projection
```

Example: Create a task

```
POST /api/tasks
  → createTask(input)
    → db.task.create(...)
    → appendCanonicalEvent({
        eventType: "TaskCreated",
        payload: { title, priority, ... }
      })
    → rebuildTaskProjection(taskId)
```

### Read Path (Query Path)

```
User request → Hono API / SPA loader → Query handler → Read projection + related data → Assemble page data
```

Example: Load schedule page

```
GET /schedule
  → getSchedulePage(workspaceId, selectedDay)
    → Read TaskProjection (scheduled/unscheduled/at-risk)
    → Compute focus zones
    → Compute automation candidates
    → Run analyzeConflicts()
    → Aggregate planning summary
    → Return SchedulePageData
```

### AI Enhancement Path

```
User input → AI API route → Rule engine / LLM / OpenClaw → Structured suggestion → User confirmation → Command execution
```

Design principle: all AI suggestions are "suggest-confirm" — they never directly mutate data.

## Module Dependencies

```
commands/  ──────────▶  events/
    │                      │
    │                      ▼
    ├──────────────▶  projections/
    │                      ▲
    ├──────────────▶  tasks/  ◀─── queries/
    │                                │
    └──────────────▶  runtime-sync/  │
                           │         │
                           ▼         ▼
                      openclaw/    ai/ (conflict, suggest, decompose)
```

**Dependency rules:**
- `commands/` may depend on `events/`, `projections/`, `runtime-sync/`, `tasks/`
- `queries/` may depend on `projections/`, `tasks/`, `runtime-sync/`, `ai/`
- `tasks/` depends only on `runtime-sync/` (to get config specs)
- `projections/` depends only on `tasks/` (state derivation)
- `events/` has no dependencies (bottom layer)
- `ai/` may depend on `queries/` (plugin tools need to read data)

## Directory Structure

```
apps/
  web/                          — Vite React SPA entry
    src/
      router.tsx                — React Router SPA routes
      pages.tsx                 — Page bindings
      components/               — UI components
        schedule/               — Schedule cockpit
        work/                   — Work/task execution view
        inbox/                  — Inbox triage
        memory/                 — Memory console
        tasks/                  — Task center
        ui/                     — Shared UI primitives
      i18n/                     — Locale config and message bundles
      styles/                   — Global styles
  server/                       — Local Hono API server + static host
    src/
      app.ts                    — Hono app composition
      routes/api.ts             — API routes
      index.ts                  — Node.js entry point
      index.bun.ts              — Bun entry point (dev)
      static/spa.ts             — SPA static file middleware

packages/
  cli/                          — Chrona npm entry point
  common/
    cli/                        — CLI commands (task, run, schedule, ai)
    ai-features/                — Shared AI feature surface
  contracts/                    — Shared DTOs, Zod schemas, API contracts
  db/                           — Prisma bootstrap, repositories, generated client
  domain/                       — Pure business rules, state derivations
  runtime/                      — Provider-agnostic runtime
    src/modules/
      commands/                 — Command handlers (write)
      queries/                  — Query handlers (read)
      projections/              — Projection rebuilders
      events/                   — Canonical event store
      tasks/                    — Task domain logic
      task-execution/           — Task session & execution registry
      runtime-sync/             — Runtime sync & freshness
      scheduler/                — Auto-start scheduled runs
      ai/                       — AI feature handlers
      workspaces/               — Workspace logic
  providers/
    openclaw/                   — OpenClaw bridge, integration, plugin
    hermes/                     — Hermes provider (future)
```

## Page Architecture

All routes are locale-prefixed (e.g. `/en/schedule`, `/zh/workspaces/...`):

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/:lang` | Workspace overview, recent activity |
| Schedule | `/:lang/schedule` | Calendar-style scheduling cockpit |
| Inbox | `/:lang/inbox` | Pending approvals, inputs, suggestions |
| Memory | `/:lang/memory` | AI agent persistent knowledge base |
| Workspaces | `/:lang/workspaces` | Workspace list |
| Workspace Overview | `/:lang/workspaces/:id` | Workspace dashboard |
| Task Detail | `/:lang/workspaces/:id/tasks/:taskId` | Task detail & plan graph |
| Work | `/:lang/workspaces/:id/work/:taskId` | Task execution view |
| Settings | `/:lang/settings` | System & AI client configuration |

Each page follows the same data loading pattern:
1. React Router loader / API call fetches the corresponding query data
2. Query functions assemble full page data from projections and the database
3. SPA client components render and issue subsequent mutation requests through the local API server

## Key Design Decisions

### 1. SQLite over PostgreSQL
- Simplified deployment: single-file database, no extra service
- Sufficient performance for personal/small team use
- Prisma ORM provides type-safe data access

### 2. Event Sourcing (pragmatic, not pure ES)
- Commands write to both business tables and event tables simultaneously
- Events are used for auditing, workflow tracking, and UI timelines
- Projection tables serve as optimized read views, rebuilt on event triggers

### 3. Dual AI engine strategy
- **Rule engine** — deterministic logic (conflict detection, time suggestions) without LLM
- **LLM enhancement** — calls LLM when semantic understanding is needed (task decomposition, auto-suggest)
- Every AI feature has a rule engine fallback; core functionality is never blocked by LLM availability

### 4. OpenClaw runtime
- Communicates with local OpenClaw CLI via HTTP bridge
- Frontend SPA, CLI, and runtime client share the semantic endpoints on the independent API server
- Supports session management and run polling; approval handling is simplified in bridge mode
- Runtime adapter pattern enables extending to other AI execution engines

## Server Modes

### Development
- Vite dev server for SPA on `http://localhost:3100`
- Hono API server on `http://localhost:3101`
- Run with: `bun run dev`

### Production (npm)
- Single Hono server on `http://localhost:3101` (or `$PORT`)
- Serves both static SPA files and API routes
- Run with: `chrona start`
- First launch auto-creates database and config files
