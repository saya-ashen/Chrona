# Chrona Next.js → Vite SPA + Hono Server Migration Plan

## Goal

Migrate Chrona from the current Next.js full-stack app into a clearer local-first architecture:

- `apps/web`: Vite-built React SPA
- `apps/server`: standalone Bun/Node API server using Hono
- `SQLite + Prisma`: preserved
- runtime / OpenClaw bridge / CLI: preserved
- remove runtime dependence on Next.js

## Current-state findings

### 1. Root app is still Next.js-driven

Root `package.json` currently uses:
- `dev = next dev`
- `build = next build`
- `start = next start`
- runtime dependency on `next`
- lint dependency on `eslint-config-next`

`tsconfig.json` still contains:
- Next plugin: `{ "name": "next" }`
- `.next` types in `include`
- `next-env.d.ts` in `include`

`eslint.config.mjs` extends:
- `eslint-config-next/core-web-vitals`
- `eslint-config-next/typescript`

### 2. Routing and rendering are split across App Router pages + mirrored `[lang]` pages

There are two route trees:
- canonical pages under `src/app/*`
- i18n mirror pages under `src/app/[lang]/*` which mostly re-export or wrap canonical pages

Important Next-only mechanisms in use:
- `next/navigation` redirects/notFound/router/pathname
- `next/link`
- `next/server` route handlers with `NextResponse`
- `next/font/google`
- `proxy.ts` locale redirect middleware
- `src/app/actions/task-actions.ts` server actions + `next/cache` revalidation
- `src/instrumentation.ts` for scheduler boot through `NEXT_RUNTIME`

### 3. API layer is already mostly business-module oriented

`src/app/api/**` contains ~35 API routes. Most are thin wrappers around `src/modules/**` logic, which is good for migration.

Representative patterns:
- `src/app/api/tasks/route.ts` calls `createTask` and Prisma directly
- `src/app/api/tasks/[taskId]/run/route.ts` calls `startRun` with OpenClaw runtime adapter
- `src/app/api/work/[taskId]/projection/route.ts` calls `getWorkPage`
- `src/app/api/ai/generate-task-plan/route.ts` is complex but still centered on reusable modules

This means the server migration should mainly replace the HTTP adapter layer, not rewrite business logic.

### 4. Business logic is already largely framework-independent

Reusable logic already lives in:
- `src/modules/commands`
- `src/modules/queries`
- `src/modules/projections`
- `src/modules/events`
- `src/modules/tasks`
- `src/modules/task-execution`
- `src/modules/runtime-sync`
- `src/modules/ai`
- `src/modules/workspaces`

Extra reusable packages already exist:
- `packages/domain`
- `packages/db`
- `packages/contracts`
- `packages/runtime`
- `packages/runtime-openclaw`
- `packages/common/cli`
- `packages/providers/openclaw/integration`
- `packages/providers/openclaw/bridge`

### 5. Frontend is React-client heavy already

Many pages are only server wrappers around client components:
- `SchedulePage`
- `TaskPage`
- `WorkPageClient`
- `InboxPageClient`
- `MemoryPageClient`
- settings dialogs/panels

This is favorable for migration to SPA.

Main frontend migration pain points are not UI rendering, but Next bindings:
- `next/link` in `LocalizedLink`
- `next/navigation` in shell, schedule page, work page controller, settings dialogs, etc.
- server-side data loading in page components
- server actions imported by UI components

### 6. i18n is custom and portable

Portable pieces already exist:
- `src/i18n/config.ts`
- `src/i18n/client.tsx`
- `src/i18n/routing.ts`
- `src/i18n/messages/*.json`

Non-portable piece:
- `src/i18n/get-dictionary.ts` imports `server-only`

Locale semantics currently rely on:
- path prefix `/en/...`, `/zh/...`
- middleware/proxy redirecting unprefixed paths to preferred locale

### 7. Prisma/SQLite are portable

- schema in `prisma/schema.prisma`
- generated client output in `src/generated/prisma`
- seed in `prisma/seed.ts`
- db bootstrap in `src/lib/db.ts`

`src/lib/db.ts` already supports both Bun and Node adapters, which is ideal for Hono server runtime.

### 8. CLI already talks to HTTP API

`packages/common/cli/src/client.ts` uses plain fetch to the app API.
This means CLI preservation only requires keeping equivalent HTTP endpoints and updating default base URL if needed.

### 9. E2E and docs are still Next-bound

- `playwright.config.ts` starts `bun run dev` and expects Next on port 3100
- README and quick-start docs instruct `bun run dev` and open `localhost:3000`
- architecture/API docs explicitly describe Next.js App Router

## Target architecture

## Directory shape

```text
apps/
  web/
    index.html
    vite.config.ts
    src/
      main.tsx
      app/
      routes/
      entry/
  server/
    src/
      index.ts
      app.ts
      routes/
      middleware/
      static/

packages/
  ui/                 optional shared frontend entry surface over existing src/components
  domain/             keep existing package
  db/                 keep existing package
  runtime-client/     keep existing runtime-related packages as-is or via current names
  cli/                keep current package path/name
  openclaw-bridge/    keep current provider package path/name
```

## Boundary rules

### apps/web
- pure SPA, no server-side rendering requirement
- React Router for routes
- fetch/TanStack Query for data access
- i18n locale prefix preserved in client routes
- static build output served by Hono server in production

### apps/server
- Hono app for all `/api/**`
- owns scheduler bootstrap on startup
- serves SPA dist in production
- no Next route handlers, middleware, or server actions

### src/modules and packages
- continue to own domain logic
- no direct dependency on web framework types
- API routes should remain thin wrappers over module commands/queries

## Route strategy

Preserve route semantics:
- `/en/schedule`, `/zh/schedule`
- `/en/tasks`
- `/en/inbox`
- `/en/memory`
- `/en/settings`
- `/en/workspaces`
- `/en/workspaces/:workspaceId`
- `/en/workspaces/:workspaceId/tasks/:taskId`
- `/en/workspaces/:workspaceId/work/:taskId`

Implementation:
- React Router route tree under `/:lang/...`
- root `/` redirects client-side to preferred/default locale
- server also redirects non-API unknown non-prefixed routes to `/${defaultLocale}` or preferred locale when feasible

## Data-loading strategy

Replace Next server pages with one of these patterns:

1. Initial fetch in route loaders or component effects
2. Shared API-client hooks for pages
3. TanStack Query where mutation/cache coherence is valuable

Preferred approach for migration speed:
- use direct fetch/hooks first
- introduce TanStack Query only where it clearly reduces complexity

## Server-actions replacement strategy

Current `src/app/actions/task-actions.ts` should be retired.
UI components must stop importing server actions and instead call:
- REST API endpoints through shared client helpers
- then refresh local query state / re-fetch projections

This is one of the largest frontend migrations because several components currently import actions directly.

## Concrete phased migration plan

### Phase 1 — Create standalone server first, keep existing business modules

1. Create `apps/server` Hono bootstrap
2. Add shared HTTP helpers for JSON/error handling
3. Port every `src/app/api/**/route.ts` to Hono route modules
4. Move scheduler boot from `src/instrumentation.ts` into server startup
5. Keep API response contracts stable for CLI and frontend callers

Result: API no longer depends on Next runtime.

### Phase 2 — Create SPA shell and route structure

1. Create `apps/web` with Vite + React + React Router
2. Reuse `src/components`, `src/i18n`, and page client components
3. Build a SPA root layout replacing `src/app/layout.tsx` / `[lang]/layout.tsx`
4. Replace:
   - `next/link` → React Router `Link`
   - `next/navigation` hooks → router equivalents
   - `next/font` → standard CSS/font loading
5. Recreate locale-prefixed routes in React Router

Result: main pages render from SPA without Next.

### Phase 3 — Replace server-action usage in UI

1. Introduce frontend API helper layer for task mutations
2. Refactor imports from `@/app/actions/task-actions`
3. Update schedule/task/work/inbox/memory flows to use REST calls
4. Remove `revalidatePath` assumptions and replace with explicit projection refresh / local cache invalidation

Result: frontend no longer depends on Next server actions.

### Phase 4 — Remove remaining Next-only files

Delete or replace:
- `src/app/**`
- `proxy.ts`
- `src/instrumentation.ts`
- `next.config.ts`
- `next-env.d.ts`
- Next-specific tests
- Next-specific lint/tsconfig settings

Then remove dependencies:
- `next`
- `eslint-config-next`

### Phase 5 — Validation and docs

1. Update scripts
2. Update Playwright webServer command
3. Run targeted tests and typecheck
4. Update README, quick-start, architecture docs, API docs
5. Document residual risks

## Implementation order inside codebase

### Server-first files
- `apps/server/src/index.ts`
- `apps/server/src/app.ts`
- `apps/server/src/routes/**`
- shared route adapters extracted from `src/app/api/**`

### Web-first files
- `apps/web/vite.config.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/router.tsx`
- SPA layout and route pages

### Shared migration helpers
- portable navigation utilities
- portable API mutation helpers
- portable dictionary loader without `server-only`

## Key refactor decisions

### 1. Keep `src/modules/**` in place for this migration
Do not simultaneously re-home all business logic into new packages unless required.
This keeps scope controlled.

### 2. Keep Prisma client generation path temporarily
Current output is `src/generated/prisma`.
That is slightly awkward for an `apps/*` split, but acceptable for migration speed.
Can be moved later if needed.

### 3. Keep existing API paths
Keep `/api/tasks`, `/api/ai/*`, `/api/schedule/projection`, etc.
This minimizes CLI and frontend breakage.

### 4. Preserve locale-in-path behavior
Do not collapse to query/localStorage-only locale handling.
Keep `/en/...` and `/zh/...` semantics.

### 5. Use Hono on the app server only
Do not merge Chrona app server with the OpenClaw bridge.
The bridge remains a separate package/process.

## Main migration risks

1. UI components tightly coupled to Next navigation hooks
2. UI components importing server actions directly
3. Work page/task page wrappers currently rely on server-side redirect/notFound behavior
4. Locale middleware behavior must be reimplemented in Hono + SPA fallback
5. Playwright tests likely encode Next-specific startup assumptions
6. Some docs still describe package names or structures slightly differently from reality

## Acceptance mapping

- Remove `next` and `eslint-config-next`: Phase 4
- Eliminate `src/app/api` runtime use: Phase 1 + Phase 4
- Eliminate `src/app/[lang]` runtime use: Phase 2 + Phase 4
- Vite static build: Phase 2
- standalone Hono server: Phase 1
- server serves dist: Phase 1/2 integration
- preserve runtime/OpenClaw/CLI/SQLite: Phases 1–3
- update tests/docs/scripts: Phase 5

## Immediate execution plan

1. scaffold `apps/server` Hono app
2. scaffold `apps/web` Vite app with locale-prefixed router
3. add shared compatibility aliases so old `src/components` can be reused during transition
4. port core projection/task/AI endpoints to Hono
5. switch a first slice of frontend routes to SPA-driven fetch rendering
6. refactor server-action consumers to API calls
7. remove Next runtime and clean configs
