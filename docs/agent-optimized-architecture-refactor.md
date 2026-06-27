# AI-Agent-Optimized Architecture Refactor Execution Guide

## Purpose

Chrona current architecture is clean for human maintainers: layered packages, explicit responsibilities, mature frontend tooling. It is less friendly for AI coding agents because one product change often crosses many directories, test commands are not feature-local, and runtime/build concerns leak through several tools.

This document defines problems, target solutions, and execution steps for refactoring Chrona toward an AI-agent-optimized architecture.

Non-goal: rewrite Chrona for purity. Bun-only runtime is useful, but agent maintainability is the goal: fast location, local edits, local tests, clear contracts, and deterministic failures.

## Target architecture

Use a Bun-first vertical-slice monorepo:

```text
Bun runtime
├─ scripts/                 # Bun.$, Bun.file, Bun.Glob orchestration
├─ apps/
│  └─ server/
│     └─ index.bun.ts       # Bun.serve boundary only
├─ features/
│  ├─ task-workspace/
│  │  ├─ contract.ts
│  │  ├─ routes.ts
│  │  ├─ service.ts
│  │  ├─ repository.ts
│  │  ├─ model/
│  │  ├─ ui/
│  │  └─ tests/
│  ├─ plan-generation/
│  ├─ execution-monitoring/
│  ├─ schedule/
│  ├─ external-calendar/
│  └─ ai-clients/
├─ shared/
│  ├─ db/                   # Prisma client, migrations, db helpers
│  ├─ http/                 # Hono helpers, auth, CORS, error helpers
│  ├─ i18n/
│  ├─ logging/
│  ├─ ui/                   # shadcn primitives and truly shared UI
│  └─ test/
└─ build/
   ├─ manifest.ts           # release resource source of truth
   └─ release-smoke.ts
```

Core rule:

```text
Feature code lives with feature code.
Shared code only exists when two or more features genuinely need the same stable primitive.
```

## Technology stance

### Keep

- Bun as only runtime and script/build orchestrator.
- Hono as API route/middleware organization layer.
- Prisma for typed business persistence.
- Vite as frontend compiler if it remains the most stable React/Tailwind/shadcn build path.
- Playwright for real browser E2E.

### Prefer

- `Bun.$` for linear command orchestration.
- `Bun.file`, `Bun.write` for file payload reads/writes.
- `Bun.Glob` for script-side globbing.
- `Bun.serve` only at server boundary.
- `bun test` for Bun-only domain/service/db/API tests.

### Avoid

- Runtime compatibility branches for Node vs Bun.
- Replacing Hono with raw Bun routes unless route organization becomes simpler.
- Replacing Prisma with direct SQL unless a feature explicitly benefits from direct SQL.
- Moving React component tests to Bun unless DOM behavior and failure output are at least as clear as current Vitest/jsdom.
- Generic UI wrappers that hide product state.

## Current problems and solutions

### Problem 1: Feature changes span too many directories

Current pattern often forces one change across:

```text
apps/web/src/...
apps/server/src/...
packages/contracts/src/...
packages/domain/src/...
packages/db/src/...
packages/engine/src/...
e2e/specs/...
```

Agent cost:

- Harder to locate authoritative code.
- Higher chance of missing a callsite.
- Tests are far from changed behavior.
- Context retrieval requires many file reads.

Solution:

Move feature-owned contracts, services, routes, UI state derivation, and tests into `features/<feature>/`.

Target per feature:

```text
features/<feature>/
├─ contract.ts              # Zod schemas and public types
├─ routes.ts                # Hono route mount for this feature
├─ service.ts               # use-case orchestration
├─ repository.ts            # feature db access wrapper, Prisma-backed
├─ events.ts                # SSE/domain event shapes if needed
├─ model/
│  ├─ projection.ts         # raw projection types and mappers
│  ├─ view-model.ts         # pure derived UI state
│  └─ view-model.test.ts
├─ ui/
│  ├─ <Feature>Page.tsx
│  └─ product-specific child components
├─ tests/
│  ├─ service.bun.test.ts
│  ├─ routes.bun.test.ts
│  ├─ ui.test.tsx
│  └─ e2e.spec.ts
└─ index.ts                 # public feature exports only
```

Acceptance:

- One product behavior change should usually touch one feature directory plus shared primitives only when needed.
- Feature internals are not imported by sibling features.
- Public imports go through `features/<feature>/index.ts`.

---

### Problem 2: Layer-first packages optimize human architecture diagrams, not agent edits

Layer-first structure is conceptually clean:

```text
contracts -> domain -> db -> server -> web
```

But an agent fixing one feature must assemble the vertical path manually.

Solution:

Keep layer separation inside each feature, not across the whole repo.

Use:

```text
features/task-workspace/contract.ts
features/task-workspace/service.ts
features/task-workspace/routes.ts
features/task-workspace/ui/...
```

Instead of scattering all contracts globally, all routes globally, all UI globally.

Shared packages become infrastructure only:

```text
shared/db
shared/http
shared/i18n
shared/logging
shared/ui
shared/test
```

Acceptance:

- Feature `README.md` or `index.ts` lists all entry points.
- `shared/` does not contain product-specific task/plan/execution logic.
- No `shared/components/StatusBadge.tsx` unless it has real Chrona-wide semantics.

---

### Problem 3: State derivation is easy to duplicate in UI components

Current risk:

```ts
if (task.status === "blocked" && execution?.status === "waiting") {
  // UI decision inside component
}
```

Agent cost:

- Same condition appears in header, graph, activity feed, command center.
- Fixing one state bug misses another surface.
- Tests often assert rendered text instead of the state invariant.

Solution:

Each feature owns pure state derivation helpers.

Pattern:

```text
features/task-workspace/model/
├─ projection.ts
├─ derived-state.ts
├─ view-model.ts
└─ view-model.test.ts
```

UI consumes derived model only:

```ts
const vm = deriveTaskWorkspaceViewModel(projection);

vm.headerBadge
vm.primaryAction
vm.disabledReason
vm.graphNodeTone
vm.activityTone
vm.nextAction
```

Rules:

- UI components render `vm`; they do not reinterpret raw task/execution statuses.
- Waiting for input and waiting for approval remain distinct derived states.
- Cancelled, completed, and done are not collapsed unless test name documents product decision.
- Blocked/failed states make next action more prominent than metadata.

Acceptance:

- State derivation changes have table-driven tests.
- Header badge, command center status, graph node tone, activity tone, and disabled reason share the same derived source where possible.

---

### Problem 4: Contracts are not always feature-local single sources of truth

Agent cost:

- Hard to find request/response/event schema for a feature.
- Backend and frontend may drift.
- SSE payloads and HTTP payloads may be documented separately.

Solution:

Each feature has `contract.ts` as public schema source.

Example:

```ts
export const StartPlanGenerationRequest = z.object({ ... });
export const PlanProjection = z.object({ ... });
export const PlanEvent = z.discriminatedUnion("type", [ ... ]);

export type StartPlanGenerationRequest = z.infer<typeof StartPlanGenerationRequest>;
export type PlanProjection = z.infer<typeof PlanProjection>;
export type PlanEvent = z.infer<typeof PlanEvent>;
```

Use contract in:

- Hono route validation.
- Client API helpers.
- SSE parser.
- UI projection tests.
- Fixtures.

Acceptance:

- No duplicate hand-written request/response types outside feature contract.
- Feature public contract exports through `features/<feature>/index.ts`.
- Tests validate fallback specs/projections with schema where applicable.

---

### Problem 5: Test commands are not feature-local enough

Current command matrix is correct but broad:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run test:e2e:desktop
```

Agent cost:

- After a local change, agent may not know smallest meaningful check.
- Large output obscures relevant failure.
- Feature tests may be in distant folders.

Solution:

Add feature-local test orchestration.

Target commands:

```bash
bun run test:feature task-workspace
bun run test:feature plan-generation
bun run test:feature external-calendar
bun run e2e:feature task-workspace
```

Each command runs only relevant tests:

```text
features/<feature>/tests/*.bun.test.ts
features/<feature>/model/*.test.ts
features/<feature>/ui/*.test.tsx
features/<feature>/tests/e2e.spec.ts
```

Implementation:

- Use `Bun.Glob` to discover feature tests.
- Maintain explicit mapping when tests still live in legacy paths.
- Output grouped by feature and test kind.

Acceptance:

- Agent can run one command after changing one feature.
- Failure output names feature, test kind, and exact file.
- Root `bun run test` still exists for full validation.

---

### Problem 6: Build/release resources are implicit

Current release process:

```text
vite build -> apps/web/dist
bun build --compile CLI/server
copy apps/web/dist
copy prisma/schema.prisma
copy prisma/migrations
copy external-plugins/hermes
archive
```

Agent cost:

- Resource list lives inside script logic.
- Smoke checks can drift from copied resources.
- Changing a release resource requires reading the script.

Solution:

Create `build/manifest.ts` as release source of truth.

Example:

```ts
export const buildArtifacts = {
  webDist: "apps/web/dist",
  binaryEntry: "packages/cli/src/bun-entry.ts",
  resources: [
    { from: "apps/web/dist", to: "resources/apps/web/dist", required: true },
    { from: "prisma/schema.prisma", to: "resources/prisma/schema.prisma", required: true },
    { from: "prisma/migrations", to: "resources/prisma/migrations", required: true },
    { from: "external-plugins/hermes", to: "resources/external-plugins/hermes", required: false },
  ],
} as const;
```

Use the same manifest in:

- `scripts/build-binaries.ts`
- `build/release-smoke.ts`
- docs/README command table

Acceptance:

- Adding/removing a release resource changes one manifest.
- Release smoke checks binary exists, executable bit, web index, Prisma schema, migrations, optional plugin path behavior.

---

### Problem 7: Scripts are more verbose than needed for Bun-only repo

Current scripts use a mix of:

- `Bun.spawn`
- `Bun.spawnSync`
- `node:fs` sync file IO
- token arrays with manual `&&` parsing

Solution:

Use Bun-native APIs by default:

```ts
import { $ } from "bun";

await $`bun run --cwd apps/web build`;
await $`bun run db:generate`;
```

Use:

```ts
await Bun.write(dest, Bun.file(src));
const glob = new Bun.Glob("**/*.bun.test.ts");
```

Keep `Bun.spawn` only when process lifecycle control is needed, e.g. dev server with two long-running children.

Acceptance:

- `scripts/chrona.ts` command runner no longer hand-parses `&&`.
- Linear command failures throw with clear command context.
- Long-running dev process management still uses `Bun.spawn`.

---

### Problem 8: Frontend build details leak into architecture decisions

Current Vite is useful and stable, but agents may treat it as architectural center.

Solution:

Hide frontend compiler behind Bun commands and feature layout.

Rules:

- Feature UI lives under `features/<feature>/ui`.
- Web route composition imports feature UI.
- Vite remains compiler implementation, not repo organization principle.
- If Bun frontend bundler later replaces Vite, feature directories do not move.

Acceptance:

- Agent changing UI follows feature path, not Vite config path.
- `bun run build:web` is the only required web build command.
- Vite config contains compiler concerns only: React, CSS, proxy, build output, test environment if needed.

---

### Problem 9: Shared UI abstractions can hide product meaning

Agent cost:

- Generic wrappers obscure where status text/tones/actions come from.
- Local variants drift from shadcn primitives.

Solution:

Use shadcn primitives directly, and only create product-named wrappers.

Allowed:

```text
TaskStatusBadge
ExecutionNextActionPanel
PlanApprovalBanner
CalendarSourceHealthCard
```

Avoid:

```text
StatusBadge
SurfaceCard
ActionPanel
FieldShell
buttonVariants local clone
```

Acceptance:

- UI wrappers encode Chrona domain meaning.
- Generic primitives come from `shared/ui` shadcn components.
- `bun run check:ui-foundation` passes after UI foundation changes.

---

### Problem 10: Feature docs are too prose-heavy for agents

Agent needs entry points, not essays.

Solution:

Each feature gets a short fixed-format README.

Template:

```md
# <feature>

## Entry points
- Contract: contract.ts
- Routes: routes.ts
- Service: service.ts
- Repository: repository.ts
- UI page: ui/<Feature>Page.tsx
- Derived state: model/view-model.ts
- Tests: tests/

## State source
- derive<Feature>ViewModel()

## Commands
- bun run test:feature <feature>
- bun run e2e:feature <feature>

## Public exports
- index.ts
```

Acceptance:

- README under 80 lines.
- No duplicate architecture essay.
- Links point to exact files.

## Migration execution plan

### Phase 0: Guardrails

Tasks:

1. Add dependency-boundary rules for `features/*` and `shared/*`.
2. Add feature public export rule: sibling features import only `features/<feature>/index.ts`.
3. Add `bun run test:feature <name>` command scaffold.
4. Add `build/manifest.ts` and release smoke scaffold.

Acceptance:

- Existing code still passes current checks.
- New commands can map legacy tests before code moves.
- Boundary checker catches direct sibling feature internals once features exist.

Checks:

```bash
bun run typecheck
bun run check:boundaries
```

---

### Phase 1: Script and release cleanup

Tasks:

1. Refactor `scripts/chrona.ts` from token-array runner to command functions using Bun APIs.
2. Refactor `scripts/build-binaries.ts` to read `build/manifest.ts`.
3. Add optional binary minification:

```bash
CHRONA_MINIFY_BINARY=1
```

which appends:

```text
--minify --sourcemap
```

4. Add release smoke check.

Acceptance:

- `bun run build` still builds current-platform release.
- Release smoke verifies required resources.
- Command failure output identifies failing step.

Checks:

```bash
bun run typecheck
bun run build
bun run build:smoke
```

---

### Phase 2: First feature slice pilot

Choose `external-calendar` or another bounded feature. Avoid starting with task workspace because it has largest blast radius.

Tasks:

1. Create `features/external-calendar/`.
2. Move feature contract/schema into `contract.ts`.
3. Move service/domain parser orchestration into feature files where ownership is clear.
4. Move API route into `routes.ts`.
5. Move UI source management pieces into `ui/` if feature already owns UI.
6. Move or map tests under `tests/`.
7. Add feature README.
8. Export public API via `index.ts`.

Acceptance:

- Feature behavior unchanged.
- Feature tests pass through `bun run test:feature external-calendar`.
- No sibling feature imports feature internals.
- Shared utilities remain shared only if reused.

Checks:

```bash
bun run test:feature external-calendar
bun run typecheck
bun run check:boundaries
```

---

### Phase 3: State-heavy feature slice

Choose `task-workspace` after pilot rules are stable.

Tasks:

1. Create `features/task-workspace/`.
2. Move pure state helpers into `model/`.
3. Move command center/header/graph/activity feature UI into `ui/`.
4. Centralize derived view model.
5. Move table-driven state tests beside model.
6. Wire existing app route to feature page.

Acceptance:

- Header badge, command center, graph node tone, activity tone, and disabled reason derive from one model.
- Waiting input and waiting approval remain distinct.
- Blocked/failed next action remains prominent.
- Feature-local tests cover empty, loading, error, blocked, waiting, completed states.

Checks:

```bash
bun run test:feature task-workspace
bun run check:ui-foundation
bun run typecheck
```

Run e2e desktop if navigation/execution flow changed:

```bash
bun run test:e2e:desktop
```

---

### Phase 4: Remaining feature migration

Migrate one feature at a time:

```text
plan-generation
execution-monitoring
schedule
ai-clients
mcp/control-plane
```

For each feature:

1. Create feature directory.
2. Move contract/service/routes/repository/model/ui/tests.
3. Keep public exports minimal.
4. Add README.
5. Update imports.
6. Run feature checks.

Acceptance per feature:

- 80%+ of feature behavior lives under its feature directory.
- Tests are discoverable via `bun run test:feature <feature>`.
- Cross-feature imports use public index only.

---

### Phase 5: Shared cleanup

After several features migrate, clean legacy shared packages.

Tasks:

1. Remove product-specific code from `shared/`.
2. Collapse dead compatibility exports.
3. Delete unused aliases and re-exports.
4. Ensure shadcn primitives are the UI foundation.
5. Update docs package-boundary tables.

Acceptance:

- `shared/` contains infra primitives only.
- No legacy compatibility alias remains.
- Boundary checker enforces new rules.

Checks:

```bash
bun run check:boundaries
bun run check:ui-foundation
bun run typecheck
bun run lint
```

## Feature migration checklist

For every feature:

```text
[ ] Feature directory exists under features/<name>
[ ] contract.ts owns schemas and public types
[ ] routes.ts owns Hono route mount
[ ] service.ts owns use-case orchestration
[ ] repository.ts owns feature-specific db access wrapper
[ ] model/ contains pure derived state helpers
[ ] ui/ contains product-specific UI components
[ ] tests/ contains or maps feature tests
[ ] README.md has entry points and commands
[ ] index.ts exports public API only
[ ] Sibling features do not import internals
[ ] test:feature <name> passes
[ ] typecheck passes
[ ] boundaries pass
```

## Import rules

Allowed:

```ts
import { createTaskWorkspaceRoutes } from "@/features/task-workspace";
import { Button } from "@/shared/ui/button";
import { db } from "@/shared/db";
```

Avoid:

```ts
import { deriveInternalThing } from "@/features/task-workspace/model/internal";
import { PlanServicePrivate } from "@/features/plan-generation/service";
```

Feature-internal imports may use relative paths inside the same feature.

## Testing policy

### Feature-local minimum

For pure state/model changes:

```bash
bun run test:feature <feature>
bun run typecheck
```

For route/service/db changes:

```bash
bun run test:feature <feature>
bun run test:api -- --feature <feature>   # add if supported
bun run typecheck
```

For UI primitive/foundation changes:

```bash
bun run check:ui-foundation
bun run test:feature <feature>
bun run typecheck
```

For navigation/task/execution flow changes:

```bash
bun run test:feature <feature>
bun run test:e2e:desktop
bun run typecheck
```

### Test quality rules

- Test behavior, not implementation plumbing.
- State derivation tests are table-driven.
- UI tests assert visible labels, roles, disabled reasons, and next actions.
- Do not rely on CSS snapshots alone.
- Do not create mocks when a real local db/API path is practical.

## Agent operating rules during refactor

1. Migrate one feature at a time.
2. Do not mix architecture migration with product behavior changes.
3. Preserve public behavior unless a test name documents a deliberate product decision.
4. Delete obsolete re-exports after callsites migrate.
5. Do not leave shims or compatibility aliases unless a phase explicitly requires temporary bridging.
6. After moving an exported symbol, run references before deleting old path.
7. Keep diffs boring: move, rewire, test.
8. Prefer local feature tests before broad checks.
9. Update feature README when entry points move.
10. Do not change DB schema, auth, provider protocol, execution semantics, secrets, network binding, or deployment config without explicit approval.

## Success metrics

Architecture is agent-friendly when these are true:

```text
1. New agent can answer "where is task workspace state derived?" from one feature README.
2. A feature bug usually requires opening one feature directory.
3. test:feature gives relevant failures in under one command.
4. Shared code contains primitives, not product behavior.
5. Feature contracts are single source for HTTP/SSE/UI projection shapes.
6. Release resources are listed in one manifest.
7. Root commands hide tool details; Bun is the orchestration surface.
8. Boundary checker prevents feature internals from becoming accidental public API.
```

## Recommended first concrete tasks

1. Add `build/manifest.ts`.
2. Add `build/release-smoke.ts`.
3. Refactor `scripts/chrona.ts` command execution to Bun command functions.
4. Add `scripts/test-feature.ts` with legacy-path mapping.
5. Add boundary rules for future `features/*`.
6. Pilot `features/external-calendar/` because scope is bounded.
7. Migrate `features/task-workspace/` after pilot stabilizes.
