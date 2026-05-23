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
bun run build:npm     # Build the npm launcher bundle
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
| `packages/cli/` | CLI package: npm entry point, launcher, and commands |
| `packages/contracts/` | Shared DTOs, Zod schemas |
| `packages/db/` | Prisma bootstrap and repositories |
| `packages/engine/` | Business use cases for tasks, plans, execution, scheduling, projections, and AI clients |
| `packages/graph-runtime/` | Plan graph build, resolve, transition, and command execution primitives |
| `packages/runtime-core/` | Shared runtime contracts and helpers |
| `packages/providers/foundation/` | Provider-neutral client contracts |
| `packages/providers/hermes/` | Hermes provider adapter |

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
- Command/query/projection handlers in `packages/engine/src/modules/`
- API routes validate input, call engine handlers, return responses — no direct DB access

## Schema-First Contracts

Runtime contracts must be schema-first, not interface-first.

- Define contract shape in Zod inside `packages/contracts`
- Derive TypeScript types from schemas with `z.infer<...>`
- Derive provider/tool JSON Schema from the same Zod schema
- Validate runtime payloads with the same Zod schema that generated the types and tool schema

Do not maintain parallel handwritten versions of the same contract across:

- TypeScript interfaces/types
- Zod validators
- AI tool parameter JSON Schema

For AI-facing structured payloads such as plan generation:

- Zod schema is the single source of truth
- Field descriptions belong on the Zod schema via `.describe(...)`
- Tool schemas sent to providers must be generated from Zod, not handwritten JSON objects
- If a node/variant is discriminated by `type`, keep fields strict per variant instead of merging all fields into one broad object

Goal: avoid schema drift, prevent provider payloads from being broader than backend validation, and keep contracts synchronized across compile-time types, runtime validation, and AI tool transport.

## Testing

```bash
bun run test              # Vitest unit tests
bun run test:bun          # Bun-native tests
bun run test:watch        # Watch mode
bun run test:e2e          # Playwright E2E tests (CI-stable, no AI dependency)
```

### E2E test layout

```text
e2e/
├── specs/                # CI-stable tests — what `bun run test:e2e` runs
│   ├── ai-client-settings-flow.spec.ts       # Settings / AI Clients flow
│   ├── task-plan-generation-hermes.spec.ts   # Hermes-backed plan generation flow
│   ├── task-workspace-accessibility.spec.ts  # Workspace accessibility checks
│   ├── task-workspace-chat.spec.ts           # Workspace chat behavior
│   └── task-workspace-layout.spec.ts         # Workspace layout behavior
└── specs/task-workspace-test-helpers.ts      # Shared Playwright test helpers
```

| Command | Scope | AI dependency | CI |
|---------|-------|---------------|-----|
| `bun run test:e2e` | `e2e/specs/` | Mocked only | Yes |

Demo/recording flows are separated from `bun run test:e2e` because they may
include video recording, fixed viewports, long waits, or real AI calls — none of
which belong in a CI pipeline that should be fast, deterministic, and
self-contained.

## Adding an AI Runtime Adapter

1. Create provider code in a concrete package under `packages/providers/`.
2. Keep protocol-specific transport and event normalization inside that package.
3. Put provider-neutral contracts in `packages/providers/foundation` and product workflow policy in `packages/engine`.
4. Add tests.

## License

By contributing, you agree your contributions will be licensed under MIT.
