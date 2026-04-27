# Contributing to Chrona

## Development Setup

Chrona development requires **Bun**:

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
```

Set up environment:

```bash
cp .env.example .env
# Edit .env to configure AI backends (optional, can also be done in-app)
bun run db:generate
bun run db:seed
```

Start dev servers:

```bash
bun run dev
```

Development ports:
- Vite SPA dev server: `http://localhost:3100`
- Hono API server: `http://localhost:3101`

## Build & Package

The npm package is built with esbuild (not tsup/bun build) to handle monorepo workspace paths:

```bash
bun run build         # Build the SPA (Vite)
bun run build:npm     # Build the npm entry point (esbuild)
```

Test locally:

```bash
node dist/cli.js start
```

## Project Architecture

Chrona is a Vite + Hono monorepo:

| Package | Purpose |
|---------|---------|
| `apps/web/` | Vite React SPA (React Router) |
| `apps/server/` | Hono API server + static SPA host |
| `packages/cli/` | npm entry point (Node.js) |
| `packages/common/cli/` | CLI commands (task, run, schedule, ai) |
| `packages/contracts/` | Shared DTOs, Zod schemas |
| `packages/db/` | Prisma bootstrap and repositories |
| `packages/domain/` | Pure business rules |
| `packages/runtime/` | CQRS: commands, queries, projections, events |
| `packages/providers/openclaw/` | OpenClaw bridge & integration |
| `packages/providers/hermes/` | Hermes provider (future) |

See [docs/architecture.md](./docs/architecture.md) for full design details.

## Code Style

- **TypeScript strict** — No `any` types
- **Bun** for dev; **Node.js** for the npm build
- **Components** — Named exports preferred
- **i18n** — All user-facing strings in `apps/web/src/i18n/messages/{en,zh}.json`

## Making Changes

1. **Create a branch** from `main`
2. **Write tests** for new features (Vitest for unit, Playwright for E2E)
3. **Run checks** before committing:
   ```bash
   bun run lint
   bun run test
   bun run typecheck
   ```
4. **Commit** with conventional messages:
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `refactor:` — Code restructuring
   - `docs:` — Documentation
   - `test:` — Test changes
   - `chore:` — Tooling/config changes

## Boundary Discipline

Do not cross layers without reason. Prefer moving files and fixing imports over rewriting behavior.

- No business logic in React components or route handlers
- No React, Prisma, or `fetch` imports into `packages/domain`
- Shared types/schemas in `packages/contracts`
- Command/query/projection handlers in `packages/runtime/src/modules/`
- API routes validate input, call runtime handlers, return responses — no direct DB access

## Testing

```bash
bun run test              # Vitest unit tests
bun run test:watch        # Watch mode
bun run test:e2e          # Playwright E2E tests
```

## Adding an AI Runtime Adapter

1. Create adapter in `packages/providers/<name>/`
2. Implement the runtime adapter interface
3. Register in the execution registry
4. Add tests

## License

By contributing, you agree your contributions will be licensed under MIT.
