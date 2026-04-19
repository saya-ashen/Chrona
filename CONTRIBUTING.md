# Contributing to AgentDashboard

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-org/AgentDashboard.git
cd AgentDashboard
bun install

# Set up environment
cp .env.example .env
bunx prisma generate
bun run db:seed

# Start dev server
bun run dev
```

## Project Architecture

AgentDashboard uses a CQRS/Event Sourcing architecture:

- **`src/modules/commands/`** — Write operations that produce domain events
- **`src/modules/queries/`** — Read operations from projections
- **`src/modules/projections/`** — Event-to-read-model projections
- **`src/modules/events/`** — Domain event recording
- **`src/modules/runtime/`** — AI runtime adapter abstraction
- **`src/components/`** — React UI components
- **`src/app/api/`** — Next.js API routes
- **`src/app/[lang]/`** — i18n page routes

## Code Style

- **TypeScript strict mode** — No `any` types
- **Bun** — Use `bun` instead of `npm` for all commands
- **Imports** — Use `@/` path aliases (e.g., `@/modules/ai/types`)
- **Components** — Named exports preferred over default exports
- **i18n** — All user-facing strings must be in `src/i18n/messages/{en,zh}.json`

## Making Changes

1. **Create a branch** from `main`
2. **Write tests** for new features (Vitest for unit, Playwright for E2E)
3. **Run checks** before committing:
   ```bash
   bun run lint          # ESLint
   bun run test          # Unit tests
   npx tsc --noEmit      # Type check
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
4. Create API routes in `src/app/api/`
5. Create UI components in `src/components/<module>/`
6. Add i18n keys to both `en.json` and `zh.json`
7. Add page routes in `src/app/[lang]/<module>/`

## Adding a Runtime Adapter

1. Create adapter directory in `src/modules/runtime/<name>/`
2. Implement `RuntimeAdapterDefinition` and `RuntimeExecutionAdapter` interfaces
3. Register in `src/modules/runtime/execution-registry.ts`
4. Add config spec in `config.ts`
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
