# Contributing to Chrona

Read [AGENTS.md](AGENTS.md), [product goals](docs/zh/steward-goals.md) and [architecture](docs/zh/steward-rebuild.md) first. Chrona is a single-owner personal steward: natural-language input, affairs, ongoing care and usable results. Explain the user problem, permission boundary, failure behavior and verification in each change.

## Setup

Requires Bun ≥ 1.3.11. Follow the [README](README.md) for a fresh data directory and Pi configuration.

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
bun run dev
```

Pi is required for real agent interaction, not mocked automated tests. Startup initializes the database. Do not reuse a pre-rebuild database or migrate real user data as part of development. See [operations](docs/zh/operations.md).

## Structure and rules

Vite + React SPA, Hono on Bun, SQLite through Prisma. No Next.js.

Dependency direction: apps → features → engine → domain → contracts. Routes validate and delegate; domain rules have no I/O. Keep business logic out of React components: view models belong in `features/steward/model`, data access in hooks. User-facing strings belong in the Chinese and English `steward` message namespaces.

- Everything user-visible belongs to an affair; technical records remain secondary.
- Agent choices come from context, not keyword routing.
- Chrona owns state and permissions. Model prose cannot mutate state; external content cannot grant authority.
- Use the deterministic policy and notification-budget layers; never add bypasses.
- Compose shadcn primitives rather than recreating generic controls.
- Shared steward contracts are supervisor-owned in delegated work: propose changes rather than editing them.
- Preserve other contributors' changes. Do not restore removed systems or add compatibility with the old database.
- No real accounts, external sends, deployment or destructive data operations without explicit authorization. Never commit credentials.

## Checks

Run targeted checks first:

```bash
bun test packages/domain/src/steward
bunx vitest run features/steward apps/web
```

Use `bun test <paths>` for affected server/package tests. Full checks from current root scripts:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:e2e:steward
```

Run the end-to-end suite when pages or flows change. Additional scripts include `bun run test:api`, `bun run test:bun`, `bun run smoke:entrypoints`, `bun run check:boundaries` and `bun run ci:local`.

Heavy commands must run one at a time with memory limits. On hosts with user systemd scopes, for example:

```bash
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit
```

State derivations need table-driven tests. UI tests assert visible text, roles and next actions, covering empty, loading, error, waiting and done states. Check desktop 1440×900, tablet 1024×768 and mobile 390×844; mobile must not scroll horizontally. Automated tests must use temporary databases and must not call a real model or QQ.

AGENTS.md also requires a UI-foundation check for relevant changes. Its named check is currently absent from root scripts; report that gap rather than claiming it ran. Follow the primitive/composition rules and request restoration of the check before accepting UI-foundation changes.

## Database and builds

The migration baseline is `prisma/migrations/0001_initial`. Before the rebuilt product's first release, schema edits update that baseline rather than adding compatibility migrations. The runner records checksums and rejects changed applied migrations: test with a fresh directory, never alter real user data to make a check pass.

```bash
bun run db:generate
bun run build
bun run build:smoke
```

Generation refreshes Prisma bindings. Build creates portable artifacts; it does not authorize publishing or deployment.

## Review notes

Report changed files, checks actually run, outcomes and remaining gaps. Separate implemented behavior from product targets and manual verification. For documentation, check relative links and verify commands/environment variables against current source. For agent behavior, include multi-turn corrections, missing information, failure/restart handling and honest incomplete results—not only a successful reply.
