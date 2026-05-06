# Simplification Refactor Plan

## Goal

Reduce project complexity without changing product behavior.

Primary focus:

1. tighten package boundaries
2. remove duplication and dead code
3. isolate generated and legacy compatibility code
4. split oversized files by responsibility
5. reduce architectural naming drift

## Current Findings

### 1. `packages/db` has boundary leakage

`packages/db` currently exposes more than persistence concerns:

- Prisma generated client
- browser-side HTTP client helpers
- logger helpers
- `cn` utility
- task action client consumed by `apps/web`

This makes `db` act like a mixed persistence + frontend utility package.

### 2. Duplicate implementations exist

Confirmed duplicates or near-duplicates:

- `packages/shared/src/modules/task-execution/task-config.ts`
- `packages/engine/src/modules/task-execution/task-config.ts`
- `packages/shared/src/modules/task-execution/registry.ts`
- `packages/engine/src/modules/task-execution/registry.ts`
- `apps/web/src/hooks/ai/logger.ts`
- `packages/db/src/logger.ts`

### 3. Prisma generated types leak upward

Direct usage exists in:

- `packages/engine`
- `apps/server` tests
- `apps/web` schedule/task config types

This couples upper layers to persistence implementation details.

### 4. Large files concentrate multiple concerns

High-value simplification targets:

- `apps/web/src/components/task/plan/task-plan-graph.tsx`
- `apps/web/src/components/schedule/forms/task-config-form.tsx`
- `packages/contracts/src/ai-feature-specs.ts`
- `packages/engine/src/modules/plan-execution/plan-runner.ts`
- `packages/engine/src/modules/queries/work-page/builders.ts`

### 5. Legacy compatibility logic is now core-path logic

Signals include:

- `compat.ts`
- `legacyNodeStatuses`
- `runtimeModel` / `prompt` / `runtimeConfig` compatibility mapping
- `openclaw-legacy-v1`

This increases branching and mental overhead in active code.

### 6. Naming drift adds unnecessary confusion

Docs and specs still frequently refer to `packages/runtime`, while code uses `packages/engine`.

### 7. Existing tooling already shows cleanup opportunities

`knip` identified:

- unused dependency: `@chrona/domain` in `apps/server/package.json`
- unused devDependencies: `@base-ui/react`, `date-fns`
- unused export: `FEATURE_ENDPOINTS`

`dependency-cruiser` identified circular-dependency warnings in:

- `packages/providers/openclaw/src/runtime/*`
- `packages/engine/src/modules/ai/*`

## Refactor Principles

1. preserve runtime behavior
2. move code before rewriting code
3. prefer one authoritative implementation per concern
4. generated code must stay behind stable package APIs
5. frontend must not depend on persistence internals
6. compatibility layers should be explicit, temporary, and isolated
7. split files by responsibility, not by arbitrary line count

## Target Architecture Direction

### Keep package responsibilities explicit

- `apps/web`: UI, browser state, API calling glue
- `apps/server`: route wiring, validation glue, HTTP response shaping
- `packages/contracts`: shared schemas, DTOs, public payload shapes
- `packages/domain`: pure business rules
- `packages/db`: Prisma/bootstrap/repositories only
- `packages/engine`: orchestration, commands, queries, execution flows
- `packages/shared`: only truly cross-app pure utilities
- `packages/providers/*`: provider-specific integration details

### Reduce `packages/db` to a true data layer

Move out of `packages/db`:

- `logger.ts`
- `utils.ts`
- `http-client.ts`
- `task-actions-client.ts`

Preferred destinations:

- browser/API helpers -> `apps/web/src/lib` or a dedicated API client package
- generic logger -> dedicated shared utility location
- UI utility like `cn` -> `apps/web` or shared UI package

### Stop exposing generated Prisma as a general public API

Current `packages/db/src/index.ts` re-exports the generated Prisma client directly. Long term, `@chrona/db` should expose:

- `db`
- repositories
- intentionally curated type facades

not the entire generated client surface.

## Execution Plan

### Phase 0 — Guardrails and inventory

Goal: make simplification safe and measurable.

Tasks:

1. record current validation commands
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test`
   - targeted API/Bun/web tests where affected
2. capture duplicate-file list
3. capture legacy/compatibility inventory
4. capture all imports of:
   - `@chrona/db/*`
   - generated Prisma client
   - `@chrona/shared`

Output:

- simplification checklist
- import migration map

### Phase 1 — Fast cleanup, low risk

Goal: remove code and dependencies with minimal architecture change.

Tasks:

1. remove unused dependencies and exports reported by `knip`
2. remove exact duplicate implementations after choosing canonical source
3. delete compatibility barrels that only re-export renamed locations where safe
4. standardize naming in docs from `runtime` to `engine` or define one canonical term and update all docs/spec references

Success criteria:

- no behavior change
- fewer package exports
- fewer duplicate modules
- docs no longer describe stale paths

### Phase 2 — Boundary repair

Goal: stop layer leakage between web, db, and engine.

Tasks:

1. move browser-only HTTP helpers out of `packages/db`
2. move `cn` out of `packages/db`
3. move logger to a neutral shared location or keep separate web/server loggers
4. replace `apps/web` imports of `@chrona/db/*` with frontend-local or API-client imports
5. reduce `@chrona/db` public exports to persistence-facing APIs only

Success criteria:

- `apps/web` no longer imports frontend helpers from `@chrona/db`
- `packages/db` reads as a persistence package again

### Phase 3 — Prisma type isolation

Goal: prevent generated Prisma surface from becoming an application contract.

Tasks:

1. introduce shared JSON/object aliases in `packages/contracts` or another neutral package
2. replace frontend use of `Prisma.InputJsonObject`
3. replace upper-layer enum/type imports with curated exports where practical
4. keep direct generated Prisma imports limited to db/repository and selected engine persistence adapters

Success criteria:

- frontend no longer imports generated Prisma types
- upper-layer code depends on contracts/domain types first

### Phase 4 — Legacy compatibility containment

Goal: shrink active-path complexity caused by historical compatibility logic.

Tasks:

1. classify compatibility code into:
   - still required at runtime
   - needed only for migration
   - dead compatibility
2. isolate required compatibility adapters behind narrow functions
3. remove dead compatibility branches
4. define deletion criteria for remaining compatibility code

Priority areas:

- plan execution compat layer
- task runtime config compatibility mapping
- old plan memory formats

Success criteria:

- fewer compat branches in core flows
- clear sunset plan for remaining legacy code

### Phase 5 — Large-file decomposition

Goal: reduce cognitive load in high-churn files.

Tasks by file:

#### `task-plan-graph.tsx`

Split into:

- graph types
- layout helpers
- node rendering
- edge rendering and legend
- copy/labels

#### `task-config-form.tsx`

Split into:

- runtime input parsing/normalization
- form state derivation
- field renderer helpers
- advanced JSON config editor
- submit payload shaping

#### `ai-feature-specs.ts`

Split by feature:

- suggest
- conflicts
- timeslots
- dispatch
- generate plan
- edit plan

#### `plan-runner.ts`

Split into:

- execution loop
- result strategy map
- work-block/session updates
- runtime layer persistence
- node executor dispatch

Success criteria:

- smaller review units
- easier test targeting
- fewer unrelated reasons to modify same file

### Phase 6 — Circular dependency reduction

Goal: remove avoidable bidirectional dependencies.

Tasks:

1. extract shared interfaces/types used by both sides of circular imports
2. move orchestration-independent helpers to lower-level modules
3. re-run dependency-cruiser until warnings are either resolved or explicitly documented as acceptable debt

## Package Introduction Guidance

New packages are optional, not the default answer.

Only introduce a new package when one of these is true:

1. the code is used by multiple apps/layers
2. the code is pure and stable enough to deserve an API boundary
3. keeping it in the current package would keep an invalid dependency direction

### Packages that may be worth introducing later

#### Option A: `packages/api-client`

Use if browser/server/client request helpers continue to grow.

Would hold:

- request helpers
- task action client
- API result types that are not DB-specific

#### Option B: `packages/ui-utils` or `packages/ui-core`

Use only if UI primitives start being shared beyond `apps/web`.

Would hold:

- `cn`
- shared UI utility helpers

#### Option C: no new package

If usage remains mostly web-only, keep helpers inside `apps/web/src/lib`.

This is likely the simplest short-term choice.

## Recommended Order

1. Phase 1 fast cleanup
2. Phase 2 boundary repair
3. Phase 3 Prisma type isolation
4. Phase 4 compatibility containment
5. Phase 5 large-file decomposition
6. Phase 6 circular dependency cleanup

## Risks

### Risk 1: accidental contract drift

Mitigation:

- move code with tests first
- prefer adapter wrappers before deeper rewrites

### Risk 2: type churn across many files

Mitigation:

- introduce compatibility type aliases temporarily
- migrate imports in batches

### Risk 3: hidden coupling in legacy plan execution paths

Mitigation:

- preserve behavior with snapshot/integration coverage
- isolate plan-execution changes from package-boundary changes when possible

## Validation Strategy

Run after each phase:

1. `bun run typecheck`
2. `bun run lint`
3. `bun run test`
4. `bun run deadcode`
5. `bun run check:boundaries`

Run targeted suites when touching:

- schedule UI
- plan execution
- task runtime config
- API route wiring

## Definition of Done

This simplification effort is successful when:

1. `packages/db` no longer acts as a frontend utility package
2. duplicated implementations are removed
3. frontend no longer depends on Prisma generated types
4. compatibility logic is reduced or isolated
5. large files are split into coherent modules
6. docs and code use consistent architectural naming
7. dead code and unused dependencies are reduced and kept under tooling control
