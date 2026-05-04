# Package Boundaries

This document explains what each package under `packages/` is for, what it is not for, and how to decide where new code should live.

Use this when `apps/web` and `apps/server` feel clear, but `packages/*` feels abstract or overlapping.

## Quick Mental Model

- `apps/web`: browser UI and page composition
- `apps/server`: HTTP entrypoints and API wiring
- `packages/contracts`: shared schema and payload contracts
- `packages/domain`: pure business rules
- `packages/db`: Prisma, SQLite bootstrap, repositories
- `packages/runtime`: application orchestration and use cases
- `packages/ai-features`, `packages/runtime-core`, `packages/i18n`, `packages/cli`: reusable system support packages
- `packages/providers/*`: external AI/runtime provider integrations

If `apps/*` is where the program starts, `packages/*` is where the reusable system layers live.

## Dependency Direction

Prefer this direction:

```text
apps/web, apps/server
  -> runtime
  -> ai-features, providers/*
  -> contracts, domain, db, runtime-core
```

And at a lower level:

```text
runtime
  -> contracts
  -> domain
  -> db
  -> ai-features
  -> provider integrations

domain
  -> depends on nothing application-specific

contracts
  -> depends only on schema/type utilities like zod
```

The lower the package, the less it should know about transport, frameworks, or specific providers.

## Final Target Structure

This is the target structure future refactors should move toward.

```text
apps/
  web/                  # browser UI entrypoint only
  server/               # HTTP API entrypoint and app wiring only

packages/
  cli/                  # Chrona CLI as an independent client entrypoint
  contracts/            # canonical shared contracts and schemas
  domain/               # pure business rules
  db/                   # Prisma/bootstrap/repositories
  runtime/              # application orchestration and use cases
  runtime-core/         # backend-agnostic runtime adapter contracts
  ai-features/          # provider-neutral AI feature APIs
  providers/
    core/               # provider-facing middle layer Chrona calls
    openclaw/
      integration/      # OpenClaw protocol/transport/runtime integration
      bridge/           # OpenClaw HTTP/SSE bridge server
    hermes/             # future provider, mirroring the same shape when real
  i18n/                 # small shared locale utilities
```

This target means:

- `apps/server` remains an app, not the home of all backend logic.
- `packages/*` is not reserved only for things shared by web and server.
- a package may stay in `packages` even if only `apps/server` currently uses it, as long as it represents a stable system layer.
- `cli` should remain a separate package-level entrypoint, but should be modeled as `packages/cli`, not as a generic helper under `packages/common/cli`.

## Keep Vs Move Vs Rename

### Keep In `packages`

These are real system layers and should not be collapsed back into `apps/server`:

- `packages/contracts`
- `packages/domain`
- `packages/db`
- `packages/runtime`
- `packages/runtime-core`
- `packages/providers/openclaw/*`
- `packages/providers/hermes/*` when it becomes real

Reason:
- they are not just "shared helpers"
- they represent stable layer boundaries
- moving them into `apps/server` would mix entrypoint concerns with orchestration, persistence, and provider integration

### Keep As Package, But Tighten Boundary

These should stay as packages, but need cleanup to match their intended role:

- `packages/ai-features`
  - should expose feature-level APIs only
  - should not drift into provider transport semantics
- `packages/providers/core`
  - should be the provider-facing middle layer Chrona calls
  - should not leak provider wire protocol details upward

### Rename / Re-home For Clarity

These placements are structurally acceptable today, but are not the clearest final form:

- `packages/common/cli` -> `packages/cli`
- `packages/common/runtime-core` -> `packages/runtime-core`
- `packages/common/ai-features` -> `packages/ai-features`
- `packages/common/i18n` -> `packages/i18n`

Reason:
- these are not generic "misc common" utilities
- their current `common/*` location makes them look looser and more incidental than they really are
- moving them to top-level package names makes the architecture easier to read

### Move Out Of Current Package Home

These are the clearest current structural mismatches:

- `packages/contracts/src/hooks/`
  - should not live under `contracts`
  - move to the app layer or a clearly UI-facing package if still needed
- deprecated compatibility re-exports under runtime that only mirror `@chrona/contracts`
  - should be removed after imports are updated

## Final Placement Rules

Use these rules for the large refactor unless there is a strong reason not to.

### `apps/web`

Put here:
- routes/pages/components
- browser state and UI composition
- app-specific frontend helpers

Do not put here:
- server-only orchestration
- provider protocol logic
- Prisma or repository code

### `apps/server`

Put here:
- Hono route registration
- request parsing/validation glue
- auth/context/bootstrap
- API response shaping
- server startup and wiring

Do not put here:
- domain rules
- repositories
- plan execution orchestration
- provider protocol parsing

### `packages/cli`

Put here:
- CLI command tree
- terminal UX
- CLI entrypoints and binaries

This is an independent client entrypoint, similar in role to `apps/web`, not a random shared helper bucket.

### `packages/contracts`

Put here:
- canonical DTOs
- shared Zod schemas
- provider-facing business payloads

Do not put here:
- hooks
- React-facing behavior
- runtime orchestration helpers

### `packages/domain`

Put here:
- pure business derivation and validation

### `packages/db`

Put here:
- Prisma bootstrap
- repositories
- persistence implementation details

### `packages/runtime`

Put here:
- command/query handlers
- plan execution orchestration
- use-case coordination across lower layers

This is the main backend application layer. `apps/server` should call into it instead of absorbing its logic.

### `packages/runtime-core`

Put here:
- backend-agnostic runtime adapter contracts and config specs

### `packages/ai-features`

Put here:
- feature-level AI APIs such as `generatePlan`, `suggest`, `dispatchTask`
- normalization from provider-facing payloads to Chrona feature results

Do not put here:
- provider-specific wire parsing
- bridge transport knowledge

### `packages/providers/core`

Put here:
- the middle layer Chrona calls for provider access
- provider-client interfaces
- normalized provider result types

Do not put here:
- app orchestration
- business schema ownership
- logic that requires upper layers to know provider wire format

### `packages/providers/<provider>/...`

Put here:
- anything that exists only because a provider has a specific protocol or transport
- SSE/OpenResponses/tool-call/session quirks
- bridge/server/client adapters for that provider

## Non-negotiable Rules For The Big Refactor

1. Do not move `domain`, `db`, `runtime`, `contracts`, or provider integration code back into `apps/server` just because `apps/server` currently consumes them.
2. Do move thin HTTP glue, route-local helpers, and app-specific startup code into `apps/server`.
3. Do keep CLI as a separate package-level entrypoint.
4. Do treat `packages/providers/core` as the only provider-facing layer upper Chrona code should call.
5. Do keep provider-specific protocol knowledge below `packages/providers/<provider>/...`.
6. Do keep canonical business contracts in `packages/contracts` only.
7. If a package exists only as a compatibility facade, remove it after imports are migrated.

## Target Provider Integration Architecture

Chrona's intended direction is:

- Chrona should not know the concrete calling protocol of OpenClaw, Hermes, or any future provider.
- Chrona should talk to a provider-facing middle layer.
- That middle layer should hide provider-specific details such as:
  - OpenResponses request formatting
  - SSE event parsing
  - function/tool call extraction
  - provider-specific response quirks
- After that middle layer returns a normalized result, Chrona can validate it, store it, and use it.

In practical terms, the target stack is:

```text
runtime / apps
  -> common/ai-features
  -> providers/core
  -> providers/<provider>/integration + bridge
```

With responsibility split like this:

- `packages/runtime`
  - consumes normalized feature results
  - does business orchestration, storage, projections, and execution flow
  - must not parse provider protocol details
- `packages/common/ai-features`
  - exposes feature-level APIs like `generatePlan()` and `dispatchTask()`
  - consumes provider-facing normalized payloads
  - must not become the owner of provider transport semantics
- `packages/providers/core`
  - is the middle layer Chrona talks to
  - should expose provider-client interfaces and normalized provider result shapes
  - should hide provider-specific request/stream/protocol mechanics from upper layers
- `packages/providers/<provider>/...`
  - owns all provider-specific protocol knowledge
  - may know about OpenResponses, function calls, SSE, session mechanics, provider config quirks, and bridge transport details

### What This Means Concretely

Good:
- runtime asks for `generate_plan`
- provider layer returns canonical payload like `AIPlanOutput`
- runtime stores and uses the normalized result

Bad:
- runtime or app routes inspect provider SSE events directly
- runtime or feature layers parse provider-specific function call wire format
- provider packages redefine canonical business schemas instead of consuming `packages/contracts`

### Current Status Vs Target

The current codebase is partway to this design, but not fully there yet.

Already aligned with the target:
- canonical AI plan contract lives in `packages/contracts/src/ai.ts`
- provider-specific bridge logic lives under `packages/providers/openclaw/*`
- runtime usually consumes normalized feature results instead of raw provider responses

Still drifting away from the target:
- `packages/providers/core` is not fully provider-neutral yet
- `packages/common/ai-features` still has some lower-level helper surface that feels too close to provider mechanics
- some package names describe the desired future boundary more cleanly than the current implementation does

### Rule For Future Changes

When changing AI/provider code, prefer this question order:

1. Is this a canonical Chrona contract?
   Put it in `packages/contracts`.
2. Is this feature-level behavior Chrona wants, regardless of provider?
   Put it in `packages/common/ai-features`.
3. Is this the generic provider-client facade Chrona should call?
   Put it in `packages/providers/core`.
4. Does this exist only because OpenClaw/Hermes has a specific protocol?
   Put it in `packages/providers/<provider>/...`.

If upper layers need to understand raw provider protocol details to work, the boundary is probably wrong.

## Package Map

### `packages/contracts`

Responsible for:
- canonical request/response contracts
- shared Zod schemas
- provider-facing AI payload contracts such as `AIPlanOutput`
- DTOs that must be consistent across server, runtime, and integrations

Not responsible for:
- React hooks
- database access
- orchestration logic
- provider transport behavior

Good fit examples:
- `packages/contracts/src/ai.ts`
- enums like `AI_TASK_EXECUTORS`
- validation schemas shared across layers

Current drift to watch:
- `src/hooks/` inside `contracts` is confusing because hooks feel app-facing, not contract-facing

Rule of thumb:
- if a type is the canonical shape exchanged between layers, put it here
- if a type only exists to help one implementation file work internally, do not put it here

### `packages/domain`

Responsible for:
- pure business rules
- derivation logic
- validation that does not require IO

Not responsible for:
- Prisma
- fetch
- React
- provider APIs
- environment variables

Good fit examples:
- task state derivation
- schedule rule evaluation
- invariant checks on business entities

Healthy boundary status:
- this is one of the cleanest packages in the repo today

Rule of thumb:
- if it can run with plain inputs and return plain outputs, `domain` is a strong candidate

### `packages/db`

Responsible for:
- Prisma client bootstrap
- SQLite/Bun database setup
- repositories and persistence helpers
- generated Prisma artifacts

Not responsible for:
- HTTP request handling
- page composition
- high-level workflow orchestration

Good fit examples:
- `db.ts`
- `execution-session-repository.ts`
- `work-block-repository.ts`

Healthy boundary status:
- mostly healthy, though it is naturally infrastructure-heavy

Rule of thumb:
- if the code knows SQL/Prisma/table persistence details, it belongs here

### `packages/runtime`

Responsible for:
- application orchestration
- command handlers
- query handlers
- plan execution flow
- projections and runtime synchronization
- tying together domain, db, AI, and provider capabilities into use cases

Not responsible for:
- serving HTTP directly
- owning canonical cross-layer contracts
- low-level provider protocol details

Good fit examples:
- `modules/commands/*`
- `modules/queries/*`
- `modules/plan-execution/*`

Current drift to watch:
- `src/index.ts` does not describe the real package surface well today
- deprecated compatibility exports from runtime back to contracts increase confusion

Rule of thumb:
- if the code answers “what should the app do next?”, it usually belongs in `runtime`

### `packages/common/runtime-core`

Responsible for:
- backend-agnostic runtime adapter contracts
- config-spec field definitions
- shared runtime interface types

Not responsible for:
- OpenClaw protocol
- transport clients
- orchestration behavior

Healthy boundary status:
- one of the clearest packages in the repo

Rule of thumb:
- if a runtime adapter interface should work for OpenClaw, Hermes, or any future backend, it belongs here

### `packages/ai-features`

Responsible for:
- feature-level AI APIs such as suggest, generate plan, conflicts, and timeslots
- prompt selection and feature normalization
- provider-neutral AI feature facade consumed by higher layers

Not responsible for:
- owning provider protocol contracts
- becoming a second provider transport layer
- redefining canonical schemas already owned by `contracts`

Current drift to watch:
- this package has historically mixed feature API with provider-specific helpers
- some cleanup has already been done, but it is still broader than ideal

Rule of thumb:
- if callers should think in terms of “generate a plan” rather than “call this provider endpoint”, `ai-features` is the right level

### `packages/cli`

Responsible for:
- CLI command wiring
- terminal UX

Not responsible for:
- core business orchestration logic itself

Rule of thumb:
- if it is about parsing command-line input or rendering terminal output, it belongs here

### `packages/i18n`

Responsible for:
- tiny shared locale helpers

Not responsible for:
- app state
- runtime orchestration

Rule of thumb:
- keep this package small; do not let it become a dumping ground for unrelated shared utilities

### `packages/providers/core`

Responsible for:
- provider client abstractions used by the app
- local provider-facing client helpers

Not responsible for:
- becoming OpenClaw-specific in its public mental model

Current drift to watch:
- it currently contains both abstraction (`ProviderClient`) and a concrete `OpenClawClient`
- it also depends on OpenClaw bridge/integration contracts, so it is not fully provider-neutral yet

Rule of thumb:
- this package should describe how Chrona talks to a provider client, not the entire OpenClaw protocol model

### `packages/providers/openclaw`

Responsible for:
- OpenClaw-specific protocol types
- transport clients
- runtime adapter/orchestration integration
- gateway request/response mapping helpers

Not responsible for:
- generic app orchestration
- canonical domain/business rules

Why it feels heavy:
- it is intentionally a full provider package, not just a small adapter shim
- it contains several sublayers: `protocol`, `transport`, `runtime`, `config`, `execution`, `features`, `parse`, and `shared`

Current drift to watch:
- `execution/gateway.ts` remains a complexity hotspot and still carries too many responsibilities

Rule of thumb:
- if the concept only exists because OpenClaw exists, it belongs here

### `packages/providers/hermes`

Responsible for:
- future Hermes provider support

Current status:
- mostly scaffolding mirroring OpenClaw layout
- do not treat it as an active implementation yet

## Healthy Vs Drifting Boundaries

Healthier boundaries today:
- `domain`
- `runtime-core`
- much of `db`
- the `apps/web` and `apps/server` split

Boundaries that still drift and therefore feel confusing:
- `common/ai-features` vs `providers/openclaw/*`
- `ai-features` vs `providers/openclaw/*`
- `providers/core` abstraction vs concrete OpenClaw implementation
- `runtime` public barrel vs actual package scope
- `contracts` because of `src/hooks/`

This means your confusion is not just inexperience. Some of the repo is genuinely mid-cleanup.

## When Code Should Stay In `apps/*`

Keep code in `apps/web` or `apps/server` when it is mainly entrypoint wiring:
- route registration
- HTTP parsing/response formatting
- page composition
- request auth/context plumbing
- app startup/bootstrap

Move code into `packages/*` when it becomes a reusable layer:
- shared contract
- pure domain rule
- repository
- use-case orchestration
- provider integration

Do not move code into `packages/*` just because it feels “important”.
Move it only when its responsibility is stable and cross-cutting.

## Placement Checklist

Before adding a new file, ask in order:

1. Is this UI composition or HTTP wiring?
   If yes, keep it in `apps/web` or `apps/server`.
2. Is this a canonical schema or DTO shared across layers?
   If yes, put it in `packages/contracts`.
3. Is this a pure business rule with no IO?
   If yes, put it in `packages/domain`.
4. Is this persistence or Prisma-specific?
   If yes, put it in `packages/db`.
5. Is this orchestrating a use case across multiple lower layers?
   If yes, put it in `packages/runtime`.
6. Is this feature-level AI behavior that should feel provider-neutral to callers?
   If yes, put it in `packages/ai-features`.
7. Does this concept only exist because of one external provider?
   If yes, put it in `packages/providers/<provider>/...`.

## Smells That Usually Mean The Boundary Is Wrong

- a package named `contracts` starts owning hooks or framework behavior
- a package named `core` depends on one concrete provider everywhere
- feature facades export transport helpers and protocol parsing details
- runtime packages re-export compatibility aliases for lower packages for too long
- app routes contain business decisions or direct DB logic
- provider packages start inventing canonical business schemas instead of consuming `contracts`

## Practical Rules For Avoiding Future Confusion

1. Keep one canonical owner for each concept.
   Example: AI plan payload contract belongs to `packages/contracts/src/ai.ts`.

2. Prefer a thin app layer and a clear runtime layer.
   `apps/server` should wire requests to runtime, not absorb orchestration logic.

3. Name packages by responsibility, then enforce that responsibility.
   A good name with a leaky boundary is more confusing than a less elegant but honest package.

4. Avoid compatibility barrels unless they are temporary and clearly marked.
   If you add one, leave a removal note.

5. When in doubt, optimize for dependency direction.
   Lower layers should know less, not more.

6. If a file needs React, Prisma, HTTP, and provider protocol knowledge all at once, it is probably in the wrong place.

## Recommended Next Cleanup Targets

If you want to reduce package confusion further, the highest-value cleanup targets are:

1. remove or relocate `packages/contracts/src/hooks/`
2. make `packages/providers/core` truly middle-layer oriented and less OpenClaw-shaped
3. narrow the public surface of `packages/ai-features` to feature APIs, not transport helpers
4. replace deprecated runtime compatibility exports with direct imports from `@chrona/contracts`
5. make `packages/runtime/src/index.ts` reflect the package's real role more honestly
