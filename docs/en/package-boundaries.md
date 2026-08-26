# Package Boundaries

This document explains where code belongs in Chrona's monorepo.

## Quick map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Browser bootstrap, router, app shell, shared browser infrastructure, and composition of browser-safe feature public entrypoints |
| `apps/server` | HTTP transport: Hono entrypoints, validation, route/SSE wiring, response shaping, and composition of feature server entrypoints |
| `packages/cli` | Packaged Chrona launcher and start/build/check/test command entrypoint |
| `packages/agent-cli` | Agent-facing CLI helpers kept outside the product engine |
| `packages/contracts` | Shared API schemas, AI feature specs, plan/runtime event types, MCP tool schemas |
| `packages/domain` | Pure domain rules with no IO, HTTP, Prisma, provider, or React dependency |
| `packages/db` | Prisma client/bootstrap/repositories and SQLite access |
| `packages/engine` | Application use cases: tasks, plans, execution, scheduling, projections, AI clients |
| `features/goals` | Goal list/workspace UI, Goal browser actions, and browser-safe Goal read models |
| `packages/graph-runtime` | Graph construction, resolution, transitions, and execution-command primitives |
| `packages/providers/*` | External AI/runtime protocol adapters |
| `packages/integrations` | External calendar parsing/normalization and user-approved local/remote integration helpers |
| `packages/ui-protocol` | Declarative UI document schema, builders, and action catalog (json-render) shared by server renderers and the web client |
| `packages/i18n` | Shared localization message infrastructure |
| `packages/logging` | Shared logging setup and logger utilities |
| `shared/http`, `shared/ui` | The only root shared directories: generic HTTP/browser infrastructure and UI primitives, never product workflow logic |
| `packages/skills` | Chrona skill packages used by agent/runtime integrations |
| `external-plugins/*` | Integration plugins outside the core app package graph |


## Feature slices

Root `features/` is the active product architecture. `apps/web` and
`apps/server` are composition/transport layers: they select routes and compose
browser-safe or server feature public APIs, but do not own feature UI or product
workflows. The current slices are `dashboard`, `action-center`,
`task-management`, `task-workspace`, `schedule`, `plan-generation`,
`execution-monitoring`, `ai-clients`, `assistant-surface`, `external-calendar`,
and `mcp-control-plane`.

| Path | Responsibility |
| --- | --- |
| `features/<feature>/index.ts` | The sole public feature entrypoint for sibling features and app composition |
| `features/<feature>/server.ts` | Optional server-only entrypoint, composed by `apps/server`; it MUST NOT enter the Vite browser graph |
| `features/<feature>/ui.ts` | Optional browser-safe convenience entrypoint for app composition; it MUST NOT export server-only code |
| `features/<feature>/test.ts` | Optional feature test entrypoint for its supported test surface |
| `features/<feature>/contract.ts` | Optional feature-owned schemas and public types |
| `features/<feature>/routes/` | Optional route handlers/wiring owned by the feature |
| `features/<feature>/model/` | Pure projections, derived state, and view models |
| `features/<feature>/ui/` | Product-specific, browser-safe feature UI |
| `features/<feature>/tests/` | Feature-local Bun and Playwright specs |
| `shared/http` | Generic HTTP/browser infrastructure such as clients, SSE support, auth helpers, and server transport helpers |
| `shared/ui` | Generic UI primitives only |

Only `index.ts` and its private/public boundary are mandatory. Add `server.ts`,
`ui.ts`, `test.ts`, `contract.ts`, `routes/`, `model/`, `ui/`, or `tests/` only
when the capability needs that layer. Empty layers and pass-through wrappers are
not architecture.

Feature-internal imports should be relative paths inside the same feature.
Sibling features may import only `features/<other>/index.ts`; never import
another feature's `server.ts`, `ui.ts`, `test.ts`, `model/*`, route files, or UI
internals. Apps compose only browser-safe feature exports into `apps/web` and
server-only exports into `apps/server`. `shared/` is infrastructure-only: it
contains only `shared/http` and `shared/ui` and cannot own product workflows or
depend on features, apps, or package internals.

## Dependency direction

Prefer this direction:

```text
apps/web ─┐
          ├─> features/<feature>/index.ts ─┬─> packages/engine ─┬─> packages/domain
apps/server┤                               │                    ├─> packages/db
packages/cli┘                               │                    ├─> packages/contracts
                                              │                    ├─> packages/graph-runtime
                                              │                    └─> packages/providers/*
                                              └─> shared/http or shared/ui
```

Rules:

- Apps compose feature public entrypoints and shared infrastructure.
- Feature internals are private; sibling features use only another feature's `index.ts`.
- Browser composition may import browser-safe feature exports only; server entrypoints must not enter the Vite graph.
- Packages should not depend on apps.
- Contracts may be imported broadly, but should stay schema/type focused.
- Domain should stay pure and IO-free.
- Engine coordinates use cases and may call db/providers/graph runtime.
- Providers adapt external protocols; they do not decide Chrona workflow semantics.
- Web composition must not call Prisma, engine internals, or provider internals directly.

## `apps/web`

- application bootstrap, route tree, locale shell, and page composition
- shared browser infrastructure and hooks that span features
- composition of browser-safe feature public APIs and generic UI primitives
- i18n provider setup and app-wide presentation helpers

Do not put here:

- task execution state machines
- schedule automation policy
- provider protocol code
- server-only secrets
- database calls

## `apps/server`

Put here:

- Hono route definitions and static-app transport
- param/body validation and API key/bind-safety glue
- response/SSE wiring and mapping requests to feature or engine public APIs
- composition of server-only feature entrypoints

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

`packages/engine` is the largest package (~22k LOC) because it is the
application's orchestration core. Internally it is split into
`src/modules/<name>/` — currently `agent-tools`, `ai`, `events`,
`execution-runtime`, `orchestration`, `pages`, `plan-execution`, `plans`,
`projections`, `scheduling`, `tasks`, `workspaces` — and those modules fall
into two kinds with different import rules:

- **Capability ("sink") modules** — `events`, `ai`, `execution-runtime`,
  `workspaces`. These have *zero* outbound dependencies on other engine
  modules. Each exposes a public `index.ts` barrel, and runtime imports from
  outside the module MUST use that barrel rather than internal files;
  type-only imports are exempt. The `engine-sink-modules-via-barrel`
  dependency-cruiser rule enforces this rule for every listed sink module.
  Because a sink has no cross-module dependencies, routing through its barrel
  cannot create an import cycle and its internal files remain movable.
- **Co-recursive / consumer core modules** — `plan-execution`, `plans`,
  `tasks`, `scheduling`, `orchestration`, `projections`, plus the page-readers
  (`pages`) and agent tool use cases (`agent-tools`). These are mutually recursive by
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

See [Provider Boundary](./provider-boundary.md) for the detailed provider rules.

## `packages/ui-protocol`

Put here:

- the declarative UI document schema (`schema.ts`) and document types (`document/`)
- spec builders (`builders/`) the server uses to describe a surface
- the action catalog (`actions/`, `catalog/`) of UI-dispatchable commands

This is the shared contract for "json-render": the server builds a UI document
spec and the web client interprets it, so neither side hard-codes the other's
layout. Keep it schema/builder focused.

Do not put here:

- React components or DOM rendering
- HTTP handlers or provider calls
- engine business orchestration

## `packages/cli`

Put here:

- packaged CLI launcher
- start command argument handling
- runtime/bootstrap setup needed before server start

The CLI is a server launcher, not a second API client surface or shared helper bucket.

## `packages/i18n` and root `shared/`

`packages/i18n` owns localization messages and helpers. Root `shared/` has only
`shared/http` and `shared/ui`: generic transport/browser infrastructure and UI
primitives, respectively. It is not a third product layer and must not hide
domain logic or application orchestration.

## `external-plugins/*`

External plugins bridge Chrona to other hosts such as Hermes Agent. They should use public Chrona APIs/MCP contracts and should not import private server or engine internals unless intentionally developed as in-repo integration code.

## Placement checklist

Ask these questions before adding a file:

1. Is it product UI, browser state, feature route behavior, or a feature-local contract? `features/<feature>/`.
2. Is it app bootstrap, locale routing, app shell, or composition of browser-safe features? `apps/web`.
3. Is it HTTP parsing/routing/SSE transport glue or composition of server feature APIs? `apps/server`.
4. Is it generic HTTP/browser infrastructure or a generic UI primitive? `shared/http` or `shared/ui`.
5. Is it a product use case or workflow decision outside a feature's local boundary? `packages/engine`.
6. Is it canonical cross-layer shape? `packages/contracts`.
7. Is it pure IO-free business derivation? `packages/domain`.
8. Is it persistence access? `packages/db`.
9. Is it graph mechanics independent of Chrona product policy? `packages/graph-runtime`.
10. Is it external provider protocol behavior? `packages/providers/*`.
11. Is it a terminal client feature? `packages/cli`.

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
| `providers-own-no-business` | error | production `packages/providers/*` code importing engine/domain/db/apps |
| `providers-own-no-business-tests` | warn | provider test files importing engine/domain/db/apps (debt; production code remains forbidden) |
| `graph-runtime-owns-no-product` | error | `packages/graph-runtime` importing engine/db/providers/integrations/apps |
| `packages-never-import-apps` | error | production package code importing an app (except the CLI launcher entry) |
| `packages-never-import-apps-tests` | warn | package test files importing app entrypoints for end-to-end coverage (debt; production code remains forbidden) |
| `no-deep-import-engine-internals` | error | runtime (value) imports of `packages/engine/src/modules/*` from outside engine — use the `@chrona/engine` barrel. Type-only imports are allowed as an end-to-end type contract |
| `no-cross-package-prisma-generated` | error | importing `packages/db/src/generated/*` from another package — use the `@chrona/db` barrel |
| `engine-sink-modules-via-barrel` | error | runtime (value) imports into an engine *capability* module's internals (`events`/`ai`/`execution-runtime`/`workspaces`) — use its `modules/<name>/index.ts` barrel. Type-only imports exempt. The co-recursive core modules are deliberately not covered (see [Internal module structure](#internal-module-structure)) |
| `no-deep-import-engine-internals-tests` | warn | test files reaching into engine internals (debt; prefer the barrel) |
| `engine-sink-modules-via-barrel-tests` | warn | tests reaching into capability-module internals (debt; prefer the barrel) |
| `feature-<name>-internals-are-private` | error | sibling features importing anything except `features/<name>/index.ts` |
| `features-do-not-import-apps-or-packages-internals` | warn | production features importing app files or package internals during migration |
| `shared-owns-no-feature-or-app-code` | error | production `shared/http` or `shared/ui` importing features, apps, or product package internals |
| `features-and-shared-never-import-apps-tests` | warn | feature/shared tests importing app internals |
| `no-circular` | warn | circular dependencies |

### Exceptions and existing debt

`.dependency-cruiser-known-violations.json` is the single exception registry.
It is currently empty (`[]`). Keep it empty by fixing imports rather than
weakening rules.

An exceptional entry must be path-specific and include an owner, reason, and
removal condition in the approving change. Wildcards, source-local disables,
and exemptions without a deletion condition are prohibited. Released debt may
be captured only by an explicit architecture review; new work may not regenerate
the baseline to make CI green.

The former engine-to-web scheduling debt is resolved. If scheduling helpers are
needed outside the web app, move pure rules into `packages/domain` or reusable
infrastructure into an appropriate package; never import back into an app.

### Verification

Run:

```bash
bun run check:boundaries
bun run typecheck
bun test scripts/dependency-boundaries.bun.test.ts
```

CI runs `bun run check:boundaries` explicitly before the test suite.
