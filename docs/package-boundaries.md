# Package Boundaries

This document explains where code belongs in Chrona's monorepo.

## Quick map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Browser UI, routing, page composition, frontend hooks/components |
| `apps/server` | Hono HTTP entrypoints, validation, route wiring, SSE streaming, response shape |
| `packages/cli` | Thin command-line API client |
| `packages/contracts` | Shared API schemas, AI feature specs, plan/runtime event types, MCP tool schemas |
| `packages/domain` | Pure domain rules with no IO, HTTP, Prisma, provider, or React dependency |
| `packages/db` | Prisma client/bootstrap/repositories and SQLite access |
| `packages/engine` | Application use cases: tasks, plans, execution, scheduling, projections, AI clients |
| `packages/graph-runtime` | Graph construction, resolution, transitions, and execution-command primitives |
| `packages/providers/*` | External AI/runtime protocol adapters |
| `packages/runtime-core` | Runtime support types/utilities shared by engine/providers |
| `packages/i18n` | Shared localization message infrastructure |
| `packages/shared` | Small cross-cutting utilities that are not domain/application logic |
| `external-plugins/*` | Integration plugins outside the core app package graph |

## Dependency direction

Prefer this direction:

```text
apps/web ─┐
apps/server ─┬─> packages/engine ─┬─> packages/domain
packages/cli ┘                    ├─> packages/db
                                   ├─> packages/contracts
                                   ├─> packages/graph-runtime
                                   └─> packages/providers/*
```

Rules:

- Apps may depend on packages.
- Packages should not depend on apps.
- Contracts may be imported broadly, but should stay schema/type focused.
- Domain should stay pure and IO-free.
- Engine coordinates use cases and may call db/providers/graph runtime.
- Providers adapt external protocols; they do not decide Chrona workflow semantics.
- Web components should not call Prisma, engine internals, or provider internals directly.

## `apps/web`

Put here:

- route components and page shells
- Schedule, Inbox, task workspace, Work page, Settings UI
- frontend hooks for API/page projections
- client-side formatting and presentation helpers
- i18n usage and UI composition

Do not put here:

- task execution state machines
- schedule automation policy
- provider protocol code
- server-only secrets
- database calls

## `apps/server`

Put here:

- Hono route definitions
- param/body validation glue
- API key/bind-safety checks
- response helpers
- SSE route wiring
- mapping HTTP requests to engine calls

Do not put here:

- long business workflows
- graph progression algorithms
- provider protocol semantics beyond request boundary wiring
- database queries that belong in engine/db modules

If a route grows complex, move use-case logic into `packages/engine`.

## `packages/engine`

Put here:

- task CRUD/lifecycle use cases
- plan generation, patching, acceptance, and materialization orchestration
- plan execution runner/progression
- checkpoint, wait, block, fail, retry, cancel handling
- schedule proposal and WorkBlock orchestration
- page projection builders
- AI client and feature binding loading
- assistant surface use cases

Do not put here:

- Hono request/response code
- React components/hooks
- raw provider wire parsing
- canonical cross-layer schema definitions

## `packages/contracts`

Put here:

- Zod schemas
- request/response DTOs
- PlanBlueprint and plan runtime types
- SSE event payload types
- AI feature specs
- MCP tool schemas and public payload contracts

Do not put here:

- DB queries
- HTTP handlers
- provider calls
- React components
- business orchestration

## `packages/domain`

Put here:

- pure business derivation
- validation that can run with plain inputs and outputs
- state/status helpers with no IO

Do not put here:

- Prisma
- fetch
- React
- provider APIs
- environment variables

## `packages/db`

Put here:

- Prisma bootstrap
- SQLite/Bun database setup
- repositories and persistence helpers
- generated Prisma artifacts

Do not put here:

- HTTP request handling
- page composition
- provider transport behavior
- high-level workflow orchestration

## `packages/graph-runtime`

Put here:

- graph validation/building
- effective graph resolution
- node transition primitives
- graph command execution primitives

Do not put here:

- product UI assumptions
- provider transport calls
- persistence-specific logic
- task/schedule policy that belongs in engine

## `packages/providers/*`

Put here:

- provider-neutral adapter contracts in `foundation`
- provider-specific transport code in each provider package
- session/run/response adaptation
- SSE or streaming event normalization
- tool-call/approval parsing
- provider config validation

Do not put here:

- Chrona task lifecycle decisions
- retry/block/fail policy
- projection derivation
- HTTP route handlers

See `docs/provider-boundary.md` for the detailed provider rules.

## `packages/runtime-core`

Put here:

- backend-agnostic runtime support types and utilities
- config specs shared by engine/providers

Keep it small. If code answers “what should Chrona do next?”, it belongs in engine.

## `packages/cli`

Put here:

- command tree
- terminal UX
- API client calls
- output formatting

The CLI is a separate client entrypoint, like `apps/web`, not a shared helper bucket.

## `packages/i18n` and `packages/shared`

`packages/i18n` owns localization messages and helpers. `packages/shared` is for small cross-cutting utilities, not a place to hide domain logic or application orchestration.

## `external-plugins/*`

External plugins bridge Chrona to other hosts such as Hermes Agent. They should use public Chrona APIs/MCP contracts and should not import private server or engine internals unless intentionally developed as in-repo integration code.

## Placement checklist

Ask these questions before adding a file:

1. Is it UI or browser state? `apps/web`.
2. Is it HTTP parsing/routing/SSE glue? `apps/server`.
3. Is it a product use case or workflow decision? `packages/engine`.
4. Is it canonical cross-layer shape? `packages/contracts`.
5. Is it pure IO-free business derivation? `packages/domain`.
6. Is it persistence access? `packages/db`.
7. Is it graph mechanics independent of Chrona product policy? `packages/graph-runtime`.
8. Is it external provider protocol behavior? `packages/providers/*`.
9. Is it a terminal client feature? `packages/cli`.
