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

Chrona is in an incremental monorepo-layering migration. Current canonical direction:

- **`apps/web/`** — Vite React SPA entry (React Router, loaders, browser shell)
- **`apps/server/`** — independent local Hono API server and static SPA host
- **`src/components/`** — React UI components
- **`src/i18n/`** — locale config and message bundles
- **`packages/domain/`** — pure domain rules and derivations
- **`packages/contracts/`** — shared DTOs, schemas, contracts
- **`packages/db/`** — database bootstrap and future repositories
- **`packages/runtime/`** — provider-agnostic runtime surface
- **`packages/runtime-openclaw/`** — OpenClaw-specific runtime surface
- **`src/modules/commands/` / `queries/` / `projections/`** — current application/service layer reused by the local server
- **`packages/providers/openclaw/**`** — provider bridge/integration implementation

## Code Style

- **TypeScript strict mode** — No `any` types
- **Bun** — Use `bun` instead of `npm` for all commands
- **Imports** — Use `@/` path aliases (e.g., `@/modules/ai/types`)
- **Components** — Named exports preferred over default exports
- **i18n** — All user-facing strings must be in `src/i18n/messages/{en,zh}.json`

## Making Changes

Before any AI-assisted edit, record this header in the task/report:

- Layer:
- Files to change:
- Boundary check:
- Expected behavior:
- Tests to run:

AI contributors must not cross layers without a concrete reason. Prefer moving files, adding facades, and fixing imports over rewriting behavior.

1. **Create a branch** from `main`
2. **Write tests** for new features (Vitest for unit, Playwright for E2E)
3. **Run checks** before committing:
   ```bash
   bun run lint               # ESLint
   bun run test               # Unit tests
   bunx tsc --noEmit          # Type check
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

1. Create command handlers in `src/modules/commands/`
2. Create query handlers in `src/modules/queries/`
3. Create projections in `src/modules/projections/`
4. Add or extend Hono routes in `apps/server/src/routes/api.ts`
5. Create UI components in `src/components/<module>/`
6. Add i18n keys to both `en.json` and `zh.json`
7. Add/update SPA routes in `apps/web/src/router.tsx` and page bindings in `apps/web/src/pages.tsx`

## Adding a Runtime Adapter

1. Create adapter directory in `src/modules/runtime/<name>/`
2. Implement `RuntimeAdapterDefinition` and `RuntimeExecutionAdapter` interfaces
3. Register in `src/modules/task-execution/execution-registry.ts`
4. Add config spec in the relevant execution module
5. Add tests in `__tests__/`

## Testing

- **Unit tests** — `bun run test` (Vitest)
- **Watch mode** — `bun run test:watch`
- **E2E tests** — `bun run test:e2e` (Playwright)
- **OpenClaw integration** — `bun run test:openclaw:integration`

## Reporting Issues

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Bun version, Node version)
- Console errors or screenshots

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
