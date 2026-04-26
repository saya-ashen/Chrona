# AI coding rules for Chrona

Before making any code change, the AI must state:

Layer:
- frontend
- api
- server
- domain
- db
- runtime
- cli
- test

Files to change:
Boundary check:
Expected behavior:
Tests to run:

## Boundary rules

- Do not modify multiple layers unless the task genuinely requires it.
- Prefer moving files, introducing facades, and fixing imports over rewriting behavior.
- Do not put business logic in React components, Next pages, or API routes.
- Do not import React, Next.js, Prisma, database clients, provider SDKs, `fetch`, or `process.env` into `packages/domain`.
- Put shared request/response shapes and Zod schemas in `packages/contracts`.
- Put command/query/projection orchestration in `packages/server` or the current server-side module layer during migration.
- Put Prisma bootstrap and repositories in `packages/db`.
- Keep provider-specific OpenClaw logic in `packages/runtime-openclaw` or provider packages.
- API routes should validate input, call server-layer functions, and return responses only.
- Client components must not import server-only handlers or database helpers.

## Migration discipline

- Preserve existing route behavior and public API behavior unless explicitly requested.
- Prefer compatibility facades during refactors so old imports keep working until the cutover is complete.
- After each migration batch, run typecheck, lint, and the smallest relevant test set.
- If a check fails, first determine whether the failure is caused by import/path breakage, environment/tooling drift, or an actual behavior change.
