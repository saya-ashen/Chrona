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

### Internal module structure

`packages/engine` is the largest package (~21k LOC) because it is the
application's orchestration core. Internally it is split into
`src/modules/<name>/`, and those modules fall into two kinds with different
import rules:

- **Capability ("sink") modules** — `events`, `ai`, `task-execution`,
  `workspaces`. These have *zero* outbound dependencies on other engine
  modules. Each exposes a public `index.ts` barrel, and everything outside the
  module MUST import through that barrel, never its internal files. Because a
  sink has no cross-module dependencies, routing through its barrel can never
  create an import cycle, and its internal files stay free to move. This is
  enforced by the `engine-sink-modules-via-barrel` dependency-cruiser rule
  (type-only imports are exempt, mirroring the package-level policy).
- **Co-recursive core modules** — `plan-execution`, `plans`, `tasks`,
  `scheduling`, `orchestration`, `projections`. These are mutually recursive by
  domain necessity: creating a task starts plan generation, planning validates
  the task, plan execution writes projections, projection rebuild reads
  plan-execution scope, scheduling starts plans, and so on. They reference each
  other with **direct (deep) imports on purpose**. Forcing them through fat
  barrels collapses file-level resolution to the module level and manufactures
  real runtime import cycles (verified: doing so created four cross-module
  cycles that deep imports avoid). The core is therefore intentionally *not*
  barrel-enforced; its files stay acyclic at the file-graph level instead.

The package's single public entry to the outside world remains
`@chrona/engine` (`src/index.ts` + `createChronaEngine`); the module barrels
above govern only engine-internal imports. When a sink module needs to expose a
new symbol, add it to that module's `index.ts` rather than deep-importing.

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

- packaged CLI launcher
- start command argument handling
- runtime/bootstrap setup needed before server start

The CLI is a server launcher, not a second API client surface or shared helper bucket.

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

## Enforcement

These boundaries are enforced, not just documented. Two gates run in
`bun run chrona check` (and the standalone `bun run check:boundaries`):

- **ESLint** keeps `packages/domain` pure (`no-restricted-imports` bans react,
  Prisma, `@/lib/db`, and provider imports there).
- **dependency-cruiser** (`.dependency-cruiser.cjs`) enforces the cross-package
  rules above against the resolved import graph. `error`-level rules fail the
  build; a new violation of any of them is a regression.

### Rules (severity)

| Rule | Severity | What it forbids |
| --- | --- | --- |
| `domain-stays-pure` | error | `packages/domain` importing db/engine/providers/integrations/apps/react/prisma |
| `contracts-stay-schema-only` | error | `packages/contracts` importing engine/db/providers/integrations/apps |
| `providers-own-no-business` | error | `packages/providers/*` importing engine/domain/db/apps |
| `graph-runtime-owns-no-product` | error | `packages/graph-runtime` importing engine/db/providers/integrations/apps |
| `packages-never-import-apps` | error | any package importing an app (except the CLI launcher entry) |
| `no-deep-import-engine-internals` | error | runtime (value) imports of `packages/engine/src/modules/*` from outside engine — use the `@chrona/engine` barrel. Type-only imports are allowed as an end-to-end type contract |
| `no-cross-package-prisma-generated` | error | importing `packages/db/src/generated/*` from another package — use the `@chrona/db` barrel |
| `engine-sink-modules-via-barrel` | error | runtime (value) imports into an engine *capability* module's internals (`events`/`ai`/`task-execution`/`workspaces`) — use its `modules/<name>/index.ts` barrel. Type-only imports exempt. The co-recursive core modules are deliberately not covered (see [Internal module structure](#internal-module-structure)) |
| `no-deep-import-engine-internals-tests` | warn | test files reaching into engine internals (debt; prefer the barrel) |
| `engine-sink-modules-via-barrel-tests` | warn | test files reaching into capability-module internals (debt; prefer the barrel) |
| `no-circular` | warn | circular dependencies (remaining ones are intra-package type-only debt) |

### Known violations (debt)

`.dependency-cruiser-known-violations.json` freezes the pre-existing
`error`-level violations so the gate can run green while still catching new
ones. It currently holds a single entry:

- `packages/engine/src/modules/scheduling/get-schedule-page.ts` imports
  `buildPlanningSummary` / `formatDateKey` / `startOfDay` from
  `apps/web/src/components/schedule/`. These are pure aggregation/date helpers
  that belong in a shared layer (`packages/domain` or `packages/shared`);
  migrating them (and flipping the ~16 web consumers) clears the entry. Do not
  add new entries to work around the rule — fix the import instead.

Regenerate the baseline only when intentionally clearing or re-snapshotting
debt: `bunx dependency-cruiser --config .dependency-cruiser.cjs --output-type baseline apps packages`, then keep only the `error`-severity entries.
