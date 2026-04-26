# Contributing to Chrona

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-org/Chrona.git
cd Chrona
bun install

# Set up environment
cp .env.example .env
bunx prisma generate
bun run db:seed

# Start dev server
bun run dev
```

## Project Architecture

Chrona is a Vite + Hono monorepo:

- **`apps/web/`** — Vite React SPA (React Router, loaders, browser shell)
- **`apps/server/`** — Hono API server and static SPA host
- **`packages/domain/`** — pure domain rules and derivations
- **`packages/contracts/`** — shared DTOs, Zod schemas, API contracts
- **`packages/db/`** — Prisma bootstrap and repositories
- **`packages/runtime/`** — provider-agnostic runtime (commands, queries, projections)
- **`packages/runtime-openclaw/`** — OpenClaw-specific runtime
- **`packages/providers/openclaw/`** — OpenClaw bridge & integration
- **`packages/providers/hermes/`** — Hermes provider (future)

See [docs/architecture.md](./docs/architecture.md) for detailed architecture and data flow.

## Code Style

- **TypeScript strict mode** — No `any` types
- **Bun** — Use `bun` instead of `npm` for all commands
- **Components** — Named exports preferred over default exports
- **i18n** — All user-facing strings must be in `apps/web/src/i18n/messages/{en,zh}.json`

## Making Changes

Before any AI-assisted edit, record this header:

- **Layer:**
- **Files to change:**
- **Boundary check:**
- **Expected behavior:**
- **Tests to run:**

Do not cross layers without a concrete reason. Prefer moving files, adding facades, and fixing imports over rewriting behavior.

1. **Create a branch** from `main`
2. **Write tests** for new features (Vitest for unit, Playwright for E2E)
3. **Run checks** before committing:
   ```bash
   bun run lint               # ESLint
   bun run test               # Unit tests
   bun run typecheck          # TypeScript type check
   bun run check:boundaries   # dependency-cruiser import boundaries
   ```
4. **Commit** with conventional commit messages:
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `refactor:` — Code restructuring
   - `docs:` — Documentation
   - `test:` — Test additions/changes
   - `chore:` — Tooling/config changes

## Adding a New Module

1. Create command/query/projection handlers in `packages/runtime/src/modules/`
2. Add or extend Hono routes in `apps/server/src/routes/`
3. Create UI components in `apps/web/src/components/`
4. Add i18n keys to both `en.json` and `zh.json`
5. Add/update SPA routes in `apps/web/src/router.tsx`

## Adding a Runtime Adapter

1. Create adapter directory in `packages/providers/<name>/`
2. Implement the runtime adapter interface
3. Register in the execution registry
4. Add tests in `__tests__/`

## Testing

- **Unit tests** — `bun run test` (Vitest)
- **Watch mode** — `bun run test:watch`
- **E2E tests** — `bun run test:e2e` (Playwright)

## Reporting Issues

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Bun version)
- Console errors or screenshots

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
