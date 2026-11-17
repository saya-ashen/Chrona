# Contributing to Chrona

Read [AGENTS.md](AGENTS.md), [product goals](docs/zh/steward-goals.md) and [architecture](docs/zh/architecture.md) first. This repository contains the general kernel, host runtime, CLI and SDK. Concrete applications are maintained and released independently. Explain the user problem, permission boundary, failure behavior and verification in each change.

## Setup

Requires Bun ≥ 1.4.2, git and a native C compiler. Follow the [README](README.md) for a fresh data directory.

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
bun scripts/chrona.ts build helper
bun run dev
```

The empty kernel requires no Provider or application. Startup initializes the database. Do not reuse a pre-rebuild database or migrate real user data as part of development. See [operations](docs/zh/operations.md).

For local capability changes, read the [kernel API design](docs/zh/kernel-api-design.md) and [implementation record](docs/zh/kernel-api-implementation.md). Preserve the single Run queue and kernel enforcement. Providers register through the general kernel contract; their implementation belongs to their own application repository.

## Structure and rules

Hono on Bun, SQLite through Prisma. No Next.js.

The CLI and HTTP bridge live in `apps/`. The CLI assembles `host → kernel → domain → contracts`; the kernel and host share transport contracts from `packages/app-sdk` (`chrona`). Domain rules have no I/O. Application source, UI, application libraries and application tests belong to their own repositories. Do not add fixed application inputs, default installation, application dependency bundlers or page generators to the kernel build.

- Agent choices come from context, not keyword routing.
- Chrona owns state and permissions. Model prose cannot mutate state; external content cannot grant authority.
- Preserve caller identity, exact approvals, budgets, cancellation and process-stop evidence.
- Shared steward contracts are supervisor-owned in delegated work: propose changes rather than editing them.
- Preserve other contributors' changes. Do not restore removed systems or add compatibility with the old database.
- No real accounts, external sends, deployment or destructive data operations without explicit authorization. Never commit credentials.

## Checks

Run targeted checks first:

```bash
bun test packages/domain/src/steward
```

Use `bun test <paths>` for affected server/package tests. Full checks from current root scripts:

```bash
bun run typecheck
bun run lint
bun run test
```

Application UI checks run in the owning application repository. Kernel scripts include `bun run test:api`, `bun run test:bun`, `bun run smoke:entrypoints`, `bun run check:boundaries` and `bun run ci:local`.

Heavy commands must run one at a time with memory limits. On hosts with user systemd scopes, for example:

```bash
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit
```

State derivations need table-driven tests. Automated checks use temporary databases and synthetic application fixtures; they must not call real models or external accounts.

## Database and builds

The migration baseline is `packages/db/prisma/migrations/0001_initial`. Before the rebuilt product's first release, schema edits update that baseline rather than adding compatibility migrations. The runner records checksums and rejects changed applied migrations: test with a fresh directory, never alter real user data to make a check pass.

```bash
bun run db:generate
bun run build
bun run build:smoke
```

Generation refreshes Prisma bindings in `packages/db/src/generated/prisma`; the schema lives in `packages/db/prisma/schema.prisma`. Startup applies migrations and creates the default workspace, so no separate seed command is needed. Build sources and their tests live in `scripts/build/`; the build writes portable artifacts under `dist/` and does not authorize publishing or deployment.

## Review notes

Report changed files, checks actually run, outcomes and remaining gaps. Separate implemented behavior from product targets and manual verification. For documentation, check relative links and verify commands/environment variables against current source. For agent behavior, include multi-turn corrections, missing information, failure/restart handling and honest incomplete results.
