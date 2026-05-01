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
bun dist/cli.js start
```

## Project Architecture

Chrona is a Vite + Hono monorepo:

| Package | Purpose |
|---------|---------|
| `apps/web/` | Vite React SPA (React Router) |
| `apps/server/` | Hono API server + static SPA host |
| `packages/cli/` | npm entry point (embeds Bun) |
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
- **Bun** for development and application runtime
- **Components** — Named exports preferred
- **i18n** — All user-facing strings in `apps/web/src/i18n/messages/{en,zh}.json`

## Making Changes

1. **Create a branch** from `main`
2. **Write tests** for new features (Vitest for unit, Playwright for E2E)
3. **Run checks** before committing:
```bash
bun run lint
bun run typecheck
bun run test              # Vitest unit tests
bun run test:bun           # Bun-native tests
bun run test:watch        # Watch mode
bun run test:e2e          # Playwright E2E tests (CI-stable, no AI dependency)
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
bun run test:bun          # Bun-native tests
bun run test:watch        # Watch mode
bun run test:e2e          # Playwright E2E tests (CI-stable, no AI dependency)
```

### E2E test layout

```
e2e/
├── specs/                # CI-stable tests — what `bun run test:e2e` runs
│   ├── schedule.spec.ts  # Schedule page flows (render, quick-add, validation, seed data)
│   ├── task.spec.ts      # Task workspace flows (navigation, assistant, error states)
│   └── control-plane.spec.ts  # Control-plane navigation
├── demo/                 # Demo / recording scripts — NOT run in CI
│   ├── demo.readme.spec.ts   # README GIF recording (mocked AI, video enabled)
│   └── demo-record.spec.ts   # Manual recording (no webServer, requires `bun run dev`)
└── helpers/              # Shared test helpers (future)
```

| Command | Scope | AI dependency | CI |
|---------|-------|---------------|-----|
| `bun run test:e2e` | `e2e/specs/` | Mocked only | Yes |
| `bun run test:e2e:demo` | `e2e/demo/demo.readme.spec.ts` | Mocked | No |
| `bun run test:e2e:record` | `e2e/demo/demo-record.spec.ts` | Real AI | No |

Demo tests are separated because they include video recording, fixed viewports,
`waitForTimeout` calls, and (in the record config) real AI calls —
none of which belong in a CI pipeline that should be fast, deterministic,
and self-contained.

## Adding an AI Runtime Adapter

1. Create adapter in `packages/providers/<name>/`
2. Implement the runtime adapter interface
3. Register in the execution registry
4. Add tests

## License

By contributing, you agree your contributions will be licensed under MIT.
