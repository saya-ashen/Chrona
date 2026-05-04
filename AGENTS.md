# Chrona — AI agent coding rules

This is a Vite + Hono monorepo. There is NO Next.js — do not generate Next.js patterns.

## Tech stack

- **Frontend:** Vite + React 19 + React Router 7 (SPA under `apps/web/`)
- **Backend:** Hono API server (Bun runtime under `apps/server/`)
- **Database:** SQLite via Prisma 7 with `prisma-adapter-bun-sqlite` (Bun-only runtime)
- **Language:** TypeScript strict everywhere
- **AI runtime:** OpenClaw via structured-result bridge

## Application runtime — Bun only

Chrona only supports **Bun** as the application runtime. There is no Node.js server entry, no `tsx` dev path, and no `@hono/node-server` adapter. The server uses `Bun.serve()` directly.

Build tools (Vite, Prisma, Vitest) may use Node.js toolchain internally, but the application itself and all dev/start scripts require Bun.

- Server entry: `apps/server/src/index.bun.ts`
- Dev: `bun run dev` (parallel web + server with `bun --watch`)
- Start: `bun run server:start`
- Tests: `bun run test:bun` for Bun-native tests, `bun run test` for Vitest (frontend/general)
- CLI: `chrona start` launches server via Bun

## Boundary discipline

Before any code change, state:

- **Layer:** frontend | api | server | domain | db | runtime | cli | test
- **Files to change:**
- **Boundary check:**
- **Expected behavior:**
- **Tests to run:**

### Layer rules

- Do not cross layers without a concrete reason. Prefer moving files, adding facades, and fixing imports over rewriting behavior.
- Do not put business logic in React components or Hono route handlers.
- Do not import React, Prisma, `fetch`, or `process.env` into `packages/domain`.
- Put shared request/response types and Zod schemas in `packages/contracts`.
- Put command/query/projection handlers in `packages/runtime/src/modules/`.
- Put Prisma bootstrap and database access in `packages/db`.
- Keep provider-specific OpenClaw logic in `packages/providers/openclaw/`.
- API routes in `apps/server/src/routes/` should validate input, call server-layer functions, and return responses — no direct DB access.
- Client components must not import server-only handlers or database helpers.

## Directory layout

```
apps/
  web/          — Vite React SPA
  server/       — Local Hono API server + static SPA host
packages/
  common/
    ai-features/        — AI feature surface (generate plan, suggest, etc.)
    cli/                — Chrona CLI
  contracts/            — Shared DTOs, Zod schemas, API contracts
  db/                   — Prisma bootstrap, repositories, generated client
  domain/               — Pure business rules, state derivations
  runtime/              — Provider-agnostic runtime (commands, queries, projections)
  providers/
    openclaw/           — OpenClaw bridge & integration
    hermes/             — Hermes provider (future)
```

## Migration discipline

- Preserve existing route behavior and public API behavior unless explicitly requested.
- After each change batch, run: `bun run typecheck`, `bun run lint`, `bun run test`.
- If a check fails, first determine whether the failure is caused by import/path breakage, environment/tooling drift, or an actual behavior change.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read `specs/001-plan-execution-orchestration/plan.md`
<!-- SPECKIT END -->
