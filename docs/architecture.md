# System Architecture

> **Pattern:** CQRS + Event Sourcing over SQLite
> **Language:** TypeScript (strict)
> **Runtime:** Bun (application runtime); Node.js (build tools only)

---

## Table of Contents

1. [Architecture at a Glance](#architecture-at-a-glance)
2. [Why CQRS + Event Sourcing](#why-cqrs--event-sourcing)
3. [C4: System Context](#c4-system-context)
4. [C4: Container Diagram](#c4-container-diagram)
5. [Data Flow](#data-flow)
6. [Module Dependency Map](#module-dependency-map)
7. [Suggest-Confirm AI Pattern](#suggest-confirm-ai-pattern)
8. [Schema-First Contracts](#schema-first-contracts)
9. [Server Modes](#server-modes)
10. [Architecture Decision Records](#architecture-decision-records-adrs)
11. [Performance & Scale Characteristics](#performance--scale-characteristics)

---

## Architecture at a Glance

Chrona separates **commands** (writes) from **queries** (reads), using an append-only event log as the canonical source of truth. Materialized **projections** are rebuilt from events for efficient querying. AI features follow a **suggest-confirm** pattern — they produce proposals, never direct mutations.

```mermaid
graph TB
    subgraph Client["Client Layer"]
        SPA["React SPA<br/>Vite + React Router"]
        CLI["Chrona CLI<br/>chrona task|run|ai"]
        BRIDGE["OpenClaw Bridge<br/>HTTP agent gateway"]
    end

    subgraph API["API Layer (Hono)"]
        ROUTES["/api/tasks/*<br/>/api/pages/*<br/>/api/ai/*<br/>/api/workspaces/*"]
        STATIC["Static SPA Host<br/>apps/web/dist"]
    end

    subgraph Engine["Engine Layer"]
        SVC["Services<br/>tasks service<br/>pages service<br/>workspaces service<br/>ai-clients service"]
        MOD["Modules<br/>tasks / plans<br/>plan-execution<br/>scheduling / ai / events"]
    end

    subgraph Data["Data Layer"]
        EVENTS["Events<br/>immutable log<br/>dedupeKey<br/>ingestSequence"]
        PROJ["Projections<br/>materialized views<br/>TaskProjection<br/>SchedulePage"]
        DB["SQLite<br/>Prisma 7<br/>dual adapter"]
    end

    subgraph External["External Runtime"]
        OCB["OpenClaw<br/>CLI Bridge"]
        LLM["LLM Providers<br/>OpenRouter-compatible"]
    end

    SPA -->|"fetch /api/*"| ROUTES
    CLI -->|"fetch /api/*"| ROUTES
    BRIDGE -->|"fetch /api/*"| ROUTES
    ROUTES --> SVC
    ROUTES --> MOD
    SVC --> EVENTS
    SVC --> DB
    MOD --> EVENTS
    MOD --> DB
    EVENTS --> PROJ
    PROJ --> DB
    SVC --> LLM
    MOD --> LLM
    BRIDGE --> OCB
```

---

## Why CQRS + Event Sourcing

| Benefit | What it means for Chrona |
|---------|--------------------------|
| **Complete audit trail** | Every task lifecycle event is immutable and replayable — trace exactly what happened and when |
| **Read/write separation** | Query projections are optimized for UI rendering; command logic is optimized for consistency |
| **Rebuildable state** | Projections can be rebuilt from events at any time — no drift between write and read models |
| **AI-friendly** | Event streams are naturally suited for AI agent consumption — agents reason over structured event history |
| **Workflow transparency** | Multi-step processes (plan generation, agent execution, approvals) remain observable throughout |

---

## C4: System Context

```mermaid
C4Context
    title System Context diagram for Chrona

    Person(user, "User", "Operates Chrona via browser or CLI")
    System(chrona, "Chrona", "AI-native task control plane<br/>Self-hosted, local SQLite")
    System_Ext(openclaw, "OpenClaw", "External agent execution gateway")
    System_Ext(llm, "LLM Providers", "OpenRouter / OpenAI-compatible APIs")

    Rel(user, chrona, "Uses", "HTTPS (localhost)")
    Rel(chrona, openclaw, "Bridges to", "HTTP/JSON")
    Rel(chrona, llm, "Calls when needed", "HTTPS/SSE")
```

---

## C4: Container Diagram

```mermaid
C4Container
    title Container diagram for Chrona

    Person(user, "User", "Browser or terminal")

    Container_Boundary(c1, "Chrona (single machine)") {
        Container(web, "Web SPA", "React 19 + Vite", "Schedule, inbox, task workspace, work execution views")
        Container(api, "API Server", "Hono (Bun)", "REST API + static SPA hosting on :3101")
        Container(db, "Database", "SQLite", "22 models via Prisma 7 with Bun SQLite adapter")
        Container(cli, "CLI", "Bun binary", "chrona task|run|schedule|ai commands")
    }

    System_Ext(openclaw, "OpenClaw Bridge", "Bun HTTP service wrapping openclaw CLI")
    System_Ext(llm, "LLM Providers", "OpenRouter / OpenAI API")

    Rel(user, web, "Visits", "localhost:3101")
    Rel(user, cli, "Runs", "terminal")
    Rel(web, api, "fetch /api/*", "JSON")
    Rel(cli, api, "fetch /api/*", "JSON")
    Rel(api, db, "Prisma queries", "SQL")
    Rel(api, openclaw, "Agent execution", "HTTP/SSE")
    Rel(api, llm, "Plan generation, chat", "SSE stream")
```

---

## Data Flow

### Write Path

Every state mutation flows through the same pipeline:

```mermaid
sequenceDiagram
    participant U as User
    participant API as Hono API
    participant CMD as Command Handler
    participant DB as SQLite
    participant EVT as Event Store
    participant PROJ as Projection Builder

    U->>API: POST /api/tasks
    API->>CMD: createTask(input)
    CMD->>DB: INSERT INTO Task
    CMD->>EVT: appendCanonicalEvent(TaskCreated)
    EVT->>PROJ: rebuildTaskProjection(taskId)
    PROJ->>DB: UPSERT TaskProjection
    API-->>U: 201 Created
```

**Example: Creating a task**

```
POST /api/tasks
  → createTask({ title: "Analyze data", priority: "High" })
    → prisma.task.create({ ... })
    → appendCanonicalEvent({
        eventType: "TaskCreated",
        workspaceId: "default",
        taskId: "cm_abc123",
        actorType: "human",
        payload: { title, priority }
      })
    → rebuildTaskProjection("cm_abc123")
      → prisma.taskProjection.upsert({ displayState: "Draft", ... })
```

### Read Path

All queries go through the same pipeline:

```mermaid
sequenceDiagram
    participant U as User
    participant API as Hono API
    participant QRY as Query Handler
    participant PROJ as Projection (cache)
    participant DB as SQLite

    U->>API: GET /api/schedule?workspaceId=default
    API->>QRY: getSchedulePage(workspaceId)
    QRY->>PROJ: Read TaskProjection (scheduled)
    QRY->>DB: Read related data (workspace, events)
    QRY-->>API: SchedulePageData
    API-->>U: 200 OK
```

**Example: Loading the schedule page**

```
GET /api/schedule?workspaceId=default
  → engine.pages.getSchedule({ workspaceId })
    → Read TaskProjection rows (filtered by scheduleStatus)
    → Compute focus zones (high-priority task clusters)
    → Compute automation candidates (Ready tasks with accepted plans)
    → Aggregate planning summary
    → Return SchedulePageData { scheduled, unscheduled, atRisk, ... }
```

---

## Module Dependency Map

```mermaid
graph TD
    services["services/"] --> events["events/"]
    services --> projections["projections/"]
    services --> runtime-sync["runtime-sync/"]
    services --> tasks["tasks/"]
    tasks["tasks/"] --> runtime-sync
    projections["projections/"] --> tasks
    plans["plans/"] --> ai["ai/"]
    plan-exec["plan-execution/"] --> plans
    plan-exec --> tasks
    ai --> providers["providers/openclaw/"]
    ai --> plans
    events["events/"]
    subgraph External
        providers
    end
    subgraph "Depends on nothing"
        events
    end
```

**Rules:**
- `events/` — bottom layer, no dependencies (canonical event log)
- `services/` — orchestrates across modules (tasks, pages, workspaces, ai-clients)
- `modules/tasks/` → `runtime-sync/`
- `modules/projections/` → `modules/tasks/` (state derivation)
- `modules/ai/` → `modules/plans/`, `providers/openclaw/`
- `modules/plan-execution/` → `modules/plans/`, `modules/tasks/`

---

## Suggest-Confirm AI Pattern

Chrona's core safety mechanism: **AI never writes directly to the data layer.**

```mermaid
sequenceDiagram
    participant U as User
    participant API as /api/tasks/*plan*
    participant AI as AI Feature
    participant LLM as LLM Provider
    participant CMD as Command Handler

    U->>API: POST /tasks/:taskId/plan/generations
    API->>AI: generate task plan
    AI->>LLM: stream plan generation
    LLM-->>AI: SSE: partial nodes, edges, status
    AI-->>API: streaming response
    API-->>U: SSE stream (draft plan)
    Note over U: User reviews draft plan
    U->>API: POST /tasks/:taskId/plan (patch operations)
    API->>CMD: apply plan mutations
    CMD->>CMD: validate, apply mutations
    CMD-->>U: 200 OK (plan updated)
```

**Every AI feature follows this flow:**

1. **Request** — user triggers AI action
2. **Stream** — AI generates a proposal (plan, timeslot, suggestion)
3. **Review** — user inspects the proposal
4. **Confirm** — user accepts → command handler executes the actual mutation

This ensures: no silent data corruption, full auditability, and user remains the final authority.

**Features with rule-engine fallback:**

| Feature | AI Path | Fallback (no LLM needed) |
|---------|---------|---------------------------|
| Conflict detection | LLM analysis | Deterministic time-overlap check |
| Timeslot suggestion | LLM recommendation | Rule-based gap detection |
| Task suggestions | LLM streaming | Keyword matching against existing tasks |
| Plan generation | LLM plan generation | Template-based breakdown |

Core functionality never requires an LLM to be available.

---

## Schema-First Contracts

Chrona uses a schema-first contract model for shared DTOs and AI structured payloads.

The rule is simple: define the contract once in Zod, then derive everything else from that schema.

### Single source of truth

- Zod schema defines runtime shape
- TypeScript types derive from Zod via `z.infer`
- Provider-facing JSON Schema derives from the same Zod schema
- Runtime validation uses the same Zod schema again at the boundary

This removes drift between compile-time types, runtime validation, and AI tool transport.

### Required practices

- Put shared contract schemas in `packages/contracts`
- Prefer exported `...Schema` values over handwritten structural interfaces
- Prefer `export type X = z.infer<typeof xSchema>` over duplicated interface definitions
- Use `.describe(...)` on Zod fields that need to be understood by external providers or other developers
- Generate tool/input JSON Schema from Zod instead of maintaining handwritten JSON schema copies

### What to avoid

Do not maintain parallel versions of the same contract in multiple forms:

- handwritten TypeScript interfaces
- separate handwritten Zod validators
- separate handwritten provider tool parameter schemas

Do not use broad union-like object schemas for discriminated payloads when variants have different fields. If a payload uses `type` to distinguish variants, each variant must stay strict to its own fields.

### Why this matters

Chrona's AI features depend on structured tool payloads. If the schema sent to the model is broader than the schema used for backend validation, the model will learn the broader shape and emit invalid payloads. Schema-first design prevents that failure mode by making provider schema generation and runtime validation come from the same source.

---

## Server Modes

| Mode | Frontend | Backend | Command |
|------|----------|---------|---------|
| **Development** | Vite dev server (HMR) on `:3100` | Hono API on `:3101` | `bun run dev` |
| **Production (Bun)** | Built SPA served by Hono | Hono on `:3101` | `bun run server:start:bun` |
| **Production (npm)** | Built SPA served by Hono | Hono on `:3101` | `chrona start` |

In production mode, a single Hono server hosts both the static SPA (`apps/web/dist/`) and all API routes on the same port.

---

## Architecture Decision Records (ADRs)

### ADR-1: SQLite over PostgreSQL

**Date:** 2024 · **Status:** Accepted

**Context:** Choose the database for a self-hosted, single-user control plane.

**Decision:** SQLite.

**Rationale:**
- Zero operational overhead — single file, no separate service
- Prisma 7 provides type-safe ORM with SQLite adapter
- Sufficient for personal/small-team task volumes
- Simplifies the `npm install -g` distribution model

**Trade-off:** Lacks concurrent writer support. Acceptable because Chrona is a single-user local app with serial command processing.

### ADR-2: Pragmatic Event Sourcing (not pure ES)

**Date:** 2024 · **Status:** Accepted

**Context:** Full event sourcing (replaying _all_ events to build _all_ state) is complex to implement and debug.

**Decision:** Hybrid approach — commands write to both business tables (Task, Run, etc.) and the Event table simultaneously. Projections are rebuilt on event triggers but can also be recomputed from business tables if needed.

**Rationale:**
- Direct business table writes give immediate consistency for simple CRUD
- Event log provides audit trail and AI-consumable history
- Projection tables provide optimized UI reads without replaying full event streams
- If events and business tables diverge, projections are the reconcilable surface

### ADR-3: Dual AI Engine (rule engine + LLM)

**Date:** 2024 · **Status:** Accepted

**Context:** How to ensure core product functionality works even without an LLM configured.

**Decision:** Every AI feature has a deterministic rule-engine implementation. LLM integration is an enhancement, not a requirement.

**Rationale:**
- Users should get basic value before configuring an LLM
- Conflict detection and timeslot suggestion work with pure date math
- Product remains useful at zero AI cost
- LLM adds semantic understanding where the rule engine can't (e.g., "this task sounds like a bug fix, schedule it earlier")

### ADR-4: Provider Adapter Pattern

**Date:** 2025 · **Status:** Accepted

**Context:** Support multiple AI runtimes (OpenClaw, bare LLM) without changing the product model.

**Decision:** Define `RuntimeExecutionAdapter` in `packages/runtime-core/` as the canonical interface. The `packages/providers/foundation/` layer provides the provider-facing contracts Chrona calls through.

**Rationale:**
- Decouples provider-specific code from the engine module
- Tasks, schedules, and plans remain provider-agnostic
- Enables A/B testing and gradual migration between runtimes

---

## Performance & Scale Characteristics

| Dimension | Characteristic |
|-----------|---------------|
| **Target scale** | 1-10 workspaces, 100-1000 tasks per workspace |
| **Database** | SQLite with WAL mode (concurrent reads) |
| **Read path** | Projections pre-computed; single SELECT for most page loads |
| **Write path** | Serial commands via CQRS pattern; typical latency < 50ms |
| **AI operations** | Asynchronous via SSE streaming; non-blocking to API |
| **Agent execution** | Delegated to external runtimes (OpenClaw bridge); Chrona polls for sync |
| **Scheduler** | Configurable polling interval (`AUTO_START_SCHEDULER_INTERVAL_MS`); lightweight DB scan |

---

## Directory Structure

```
apps/
  web/                          — Vite React SPA
    src/
      router.tsx                — React Router routes (locale-prefixed)
      pages.tsx                 — Page component bindings
      components/               — UI components (schedule, work, inbox, memory, tasks, ui)
      i18n/                     — Locale config and message bundles (en.json, zh.json)
      styles/                   — Global styles (Tailwind v4)
  server/                       — Hono API server + static SPA host
    src/
      app.ts                    — Hono app composition (CORS, locale redirect, middleware)
      routes/api.ts             — API route aggregation (tasks, pages, workspaces, ai)
      routes/tasks/             — Task CRUD, plan, execution, lifecycle, result, schedule
      routes/pages/             — Page data endpoints (schedule, inbox, memory, work)
      routes/ai/                — AI client management
      index.bun.ts              — Bun entry (primary)
```
