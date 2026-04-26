# Chrona layering analysis and conservative migration plan

## Current project structure summary

Observed live structure today:

- `src/app/`: Next.js app router pages, layouts, API routes, server actions
- `src/components/`: React UI and page-local view-model/helpers
- `src/hooks/`: client hooks, including AI request hooks
- `src/lib/`: misc shared utilities plus Prisma client bootstrap
- `src/modules/`: most backend/application logic, but currently mixed between domain, server logic, db access, runtime integration, and UI-adjacent helpers
- `src/generated/prisma/`: generated Prisma client
- `prisma/schema.prisma`: data model
- `packages/common/runtime-core`: runtime abstraction primitives
- `packages/common/ai-features`: shared AI feature layer
- `packages/common/cli`: CLI package
- `packages/providers/openclaw/integration`: OpenClaw runtime integration
- `packages/providers/openclaw/bridge`: OpenClaw bridge HTTP server

Important reality: this repo is already a partial monorepo, but the main Next app still keeps most application code under `src/`, so architectural boundaries are only partially expressed in package layout.

## Current layer classification

### Frontend / Next entrypoints
- `src/app/**/*.tsx`
- `src/app/api/**/route.ts`
- `src/app/actions/**`
- `src/components/**`
- `src/hooks/**`
- `src/i18n/**`

### Server/application logic
Mostly under `src/modules/commands`, `src/modules/queries`, `src/modules/projections`, parts of `src/modules/ai`, `src/modules/runtime-sync`, `src/modules/task-execution`, `src/modules/workspaces`.

### Domain logic hiding inside app source
Examples:
- `src/modules/tasks/derive-task-state.ts`
- `src/modules/tasks/derive-schedule-state.ts`
- `src/modules/tasks/validate-schedule-window.ts`
- parts of `src/modules/tasks/derive-task-runnability.ts` are domain-like but still depend on runtime registry/task-config, so not pure domain yet

### Shared contracts / DTO-like types
Examples:
- `src/modules/ai/types.ts`
- parts of `src/components/schedule/schedule-page-types.ts`
- request/response shapes embedded inline inside many `src/app/api/**/route.ts`

### DB/data access
Examples:
- `src/lib/db.ts`
- `src/lib/db-url.ts`
- direct Prisma access scattered across API routes, query handlers, commands, projections
- generated Prisma output in `src/generated/prisma/`

### Runtime abstraction / runtime implementations
- `packages/common/runtime-core`
- `src/modules/task-execution/**`
- `src/modules/research-execution/**`
- `packages/providers/openclaw/integration`
- `packages/providers/openclaw/bridge`

## Main boundary problems

### 1. No real `apps/web` boundary yet
The Next app lives at repo root under `src/`, not under `apps/web`. This is not wrong, but it means package-level boundaries are weak and the root TS config sees everything together.

### 2. `src/modules` mixes multiple layers
`src/modules` currently contains:
- pure derivation logic
- command/query handlers
- runtime orchestration
- AI integration
- direct Prisma usage
This makes it hard for humans or AI to tell what is safe to reuse where.

### 3. Query/server layer imports UI-layer helpers and UI-owned types
Confirmed examples:
- `src/modules/queries/get-schedule-page.ts` imports `@/components/schedule/schedule-page-utils`
- `src/modules/queries/get-schedule-page.ts` imports `@/components/schedule/schedule-page-types`
This is an inversion: server/query composition depends on component-owned files.

### 4. Client components import server/business modules directly
Confirmed examples include imports from `@/modules/ai/types` and even algorithmic logic such as:
- `src/components/schedule/panels/timeslot-suggestion-panel.tsx` importing `suggestTimeslots` from `@/modules/ai/timeslot-suggester`
This makes client/server intent blurry and prevents clear boundary enforcement.

### 5. API routes contain direct DB access and inline request validation
Confirmed examples:
- `src/app/api/tasks/route.ts` directly queries `db.task.findMany`
- many routes import `db` directly from `@/lib/db`
This bypasses a clean server/db boundary and spreads persistence concerns into transport entrypoints.

### 6. Shared contracts are embedded in feature/server/UI files instead of a dedicated package
Examples:
- `src/modules/ai/types.ts` is imported by UI, hooks, server, and routes
- `src/components/schedule/schedule-page-types.ts` contains reusable non-visual types but lives inside `components`

### 7. DB access is not centralized
Prisma bootstrap exists in one place, but repositories/data access conventions are absent. Commands, queries, projections, and routes all touch Prisma directly.

### 8. Runtime boundary is only partially expressed
There is already a strong start with:
- `@chrona/runtime-core`
- `@chrona/openclaw-integration`
But app-side runtime-related logic still lives in `src/modules/task-execution` and `src/modules/research-execution`, so the abstraction surface is split.

### 9. Documentation still describes old or partially outdated structure
`docs/architecture.md` mentions package paths that no longer match the real tree exactly and still describes `src/modules/runtime/` even though the repo now uses package-based runtime pieces.

### 10. Automated boundary checks are currently weak
- ESLint config has no import boundary rules
- no dependency-cruiser config
- only one root `tsconfig.json`
- no project references separating app/package responsibilities

## Recommended target structure

Target mental model:

- `apps/web` — Next frontend + BFF/API routes only
- `packages/domain` — pure business derivations, entities, rules, state transitions
- `packages/contracts` — DTOs, zod schemas, API request/response contracts, shared non-React types
- `packages/server` — commands, queries, projections, services
- `packages/db` — Prisma client bootstrap, repositories, DB helpers, generated client location strategy
- `packages/runtime` — provider-agnostic runtime interfaces/facades
- `packages/runtime-openclaw` — OpenClaw implementation surface
- `packages/cli` — CLI
- `packages/ui` — optional shared presentational primitives only

Pragmatic note: do not physically move the whole Next app to `apps/web` in the first batch. First create canonical packages and migrate imports conservatively while keeping existing public behavior.

## Recommended migration steps

### Step 1: Create canonical packages and compatibility phase
Safe, behavior-preserving.

- add `packages/domain`
- add `packages/contracts`
- add `packages/db`
- add thin `packages/runtime` and `packages/runtime-openclaw` facades
- add TS path aliases
- move/copy only obviously pure files first:
  - `derive-task-state`
  - `derive-schedule-state`
  - `validate-schedule-window`
  - shared AI types
  - db URL helper
- keep old source files temporarily or convert them to facades where needed

Validation after step:
- `bunx tsc --noEmit`
- targeted vitest for touched pure modules

### Step 2: Move server-owned schedule/work/task types out of `components`
Goal: remove server/query imports from UI-owned files.

Likely targets:
- move shared schedule page data/types from `src/components/schedule/schedule-page-types.ts` into `packages/contracts`
- move reusable schedule formatting/state helpers needed by queries into `packages/server` or `packages/contracts` depending on purity
- update `src/modules/queries/get-schedule-page.ts` so it no longer imports from `components`

Validation after step:
- targeted schedule query tests
- schedule component tests
- typecheck

### Step 3: Introduce `packages/server` facades and pull API routes behind them
Goal: API routes become transport-only.

- create `packages/server/src/commands`, `queries`, `services`, `projections`
- migrate/copy stable handlers from `src/modules/**` into canonical server package
- convert old `src/modules/**` files into facades or keep app imports pointed to new package aliases
- add request/response zod contracts for high-traffic routes first

Validation after step:
- route tests
- command/query tests
- typecheck

### Step 4: Centralize DB access and reduce direct Prisma spread
Goal: make Prisma an implementation detail of `packages/db`.

- move `src/lib/db.ts` bootstrap into `packages/db`
- decide whether generated Prisma stays under `src/generated/prisma` short-term or moves under `packages/db/generated`
- add repositories for the most reused aggregates first: task, run, projection, AI client binding
- progressively replace direct route/query Prisma reads with db package access

Validation after step:
- projection/query tests
- task lifecycle tests
- typecheck

### Step 5: Hard boundary enforcement and optional `apps/web` move
Goal: prevent regression.

- add ESLint import restriction rules
- add dependency-cruiser config
- add TS project references per package
- optionally move Next app into `apps/web` only after imports are already package-oriented

Validation after step:
- lint
- typecheck with references
- representative unit tests

## Risks

1. Schedule page is currently highly entangled with component-owned types/utilities. That area has the highest import-boundary risk.
2. `src/modules/ai/types.ts` is widely used; moving it requires careful aliasing/facades.
3. `derive-task-runnability.ts` looks domain-like but is not pure because it depends on runtime config registry and runtime-core spec helpers.
4. Root-level Next setup means full `apps/web` migration is structurally larger than the first package extraction.
5. There are already unrelated user changes in the worktree, so edits must avoid overwriting existing modifications.

## First batch suggested file list

Low-risk first batch:
- `packages/domain/package.json`
- `packages/domain/src/index.ts`
- `packages/domain/src/task/derive-task-state.ts`
- `packages/domain/src/task/derive-schedule-state.ts`
- `packages/domain/src/task/validate-schedule-window.ts`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/ai.ts`
- `packages/db/package.json`
- `packages/db/src/index.ts`
- `packages/db/src/sqlite-url.ts`
- `packages/runtime/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime-openclaw/package.json`
- `packages/runtime-openclaw/src/index.ts`
- `tsconfig.json`
- `docs/ai-coding-rules.md`
- `docs/architecture-layering-analysis.md`
- `eslint.config.mjs`
- `CONTRIBUTING.md`

Low-risk import rewires in first batch:
- `src/modules/projections/rebuild-task-projection.ts`
- `src/modules/commands/apply-schedule.ts`
- `src/modules/commands/update-task.ts`
- `src/lib/db.ts`
- a very small number of UI files to consume contracts package instead of `src/modules/ai/types.ts`

## Desired boundary rules to add

- `components/**` cannot import `src/modules/**` except explicitly allowed client-safe contracts/helpers
- `src/app/api/**` should not import `@/lib/db` directly
- `src/modules/queries/**` and `src/modules/commands/**` cannot import `src/components/**`
- `packages/domain` cannot import React, Next, Prisma, `process.env`, fetch, or provider-specific packages
- `packages/contracts` can depend on zod only
- `packages/server` can depend on domain/contracts/db/runtime
- `packages/db` can depend on contracts/domain but not React/Next
- `packages/runtime-openclaw` can depend on runtime/contracts/openclaw integration

This document is the analysis-phase deliverable and the execution baseline for conservative migration.
