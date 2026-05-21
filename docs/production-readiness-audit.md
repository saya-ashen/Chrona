# Production Readiness Audit

Date: 2026-05-21

Scope: current repository state for a formal Chrona release. This audit covers build, test, packaging, Docker, runtime startup, security exposure, and release gate readiness.

## Summary

Current state is not ready for a formal release.

The web build, npm bundle build, and Linux x64 binary build pass. A local Linux x64 binary smoke test also starts successfully, initializes SQLite migrations, listens on `127.0.0.1`, and shuts down cleanly.

Release is blocked by failing test gates, a Docker default startup conflict, and production security risks around AI client secrets and internal error exposure.

## Checks Run

| Check | Result | Notes |
| --- | --- | --- |
| `bun run typecheck` | Pass | TypeScript check passed. |
| `bun run build` | Pass | Vite production build passed with warnings. |
| `bun run build:npm` | Pass | Built `dist/cli.js` and `dist/bun-entry.js`. |
| `bun run build:binary:linux-x64` | Pass | Built `dist/releases/chrona-linux-x64/chrona` and archive. |
| Linux x64 binary first-start smoke | Pass | Created database, ran migrations, started on `127.0.0.1`, shut down cleanly. |
| `bun run test:api` | Pass | API Bun test runner passed. |
| `bun run check:ui-foundation` | Pass | No duplicate primitive consumers found. |
| `bun run lint` | Pass with warnings | Exit code 0, but 732 warnings. |
| `bun run check:boundaries` | Pass with warnings | Exit code 0, but 53 dependency warnings. |
| `bun run test` | Fail | Vitest suite failed. |
| `bun run test:bun` | Fail | Bun test aggregation exited 1. |
| `bun run test:e2e` | Not validated | Failed before tests because port `127.0.0.1:3100` was already in use. |
| `bun run deadcode` | Fail | Knip reported unused files, dependencies, devDependencies, unlisted dependencies, and unused exports. |

## P0 Release Blockers

### 1. Main Vitest Suite Fails

Evidence: `bun run test` exits with code 1.

Observed failures:

```text
apps/web/src/components/settings/ai-clients-manager.test.tsx
AiClientsManager > creates a Hermes client with Hermes-specific config
TestingLibraryElementError: Unable to find an accessible element with the role "listbox"
```

```text
ReferenceError: window is not defined
Originated in apps/web/src/components/work/task-plan-side-panel.test.tsx
```

Impact: core test gate is red. A formal release cannot claim stable UI behavior or reliable test coverage.

Recommended fix: repair the AI clients manager select interaction tests and the `window` usage/test environment issue, then require `bun run test` to pass in release gating.

### 2. Bun Test Gate Fails

Evidence: `bun run test:bun` exits with code 1.

Observed output shows many Bun tests passing, but the aggregated script still exits 1.

Impact: server, provider, engine, or script-level Bun test coverage is not release-green. This blocks confidence in backend/runtime execution paths.

Recommended fix: locate the failing file inside `scripts/run-bun-tests.ts` output or improve the script summary so the failing test is explicit. Require `bun run test:bun` to pass before release.

### 3. Docker Default Runtime Configuration Conflicts With Safe Bind Check

Evidence:

`Dockerfile` sets:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3101
DATABASE_URL="file:./prisma/chrona.db"
```

`apps/server/src/config/env.ts` refuses `HOST=0.0.0.0` unless `API_KEY` is set or `CHRONA_UNSAFE_PUBLIC_BIND=1` is explicitly set.

Impact: the Docker image likely fails at startup with default settings. Docker-based release and deployment path is not usable as-is.

Recommended fix: choose one explicit production Docker policy.

Option 1: default Docker to `HOST=127.0.0.1` and document reverse-proxy binding.

Option 2: require `API_KEY` at container startup and fail with clear deployment docs.

Option 3: set `CHRONA_UNSAFE_PUBLIC_BIND=1` only for explicitly unsafe local/demo images, not formal production images.

### 4. AI Client Secrets Are Returned To The Frontend

Evidence: `apps/server/src/routes/ai/clients.routes.ts` returns `config: client.config` from `GET /api/ai/clients`.

The stored config can include provider secrets such as OpenClaw bridge tokens or Hermes API keys.

Impact: any user or browser session with API access can read configured AI backend credentials. This is a production security blocker.

Recommended fix: split stored config from public config. `GET /api/ai/clients` should return only non-secret metadata and masked secret presence, for example `hasApiKey: true` or `apiKey: "********"`. Create/update routes may accept secrets, but list/read routes must never return raw secret values.

### 5. Production 500 Responses Expose Internal Error Messages

Evidence: `apps/server/src/app.ts` returns `error instanceof Error ? error.message : ...` in the global `onError` response.

Impact: production clients can receive internal exception details, provider errors, paths, database messages, or implementation hints.

Recommended fix: keep detailed messages in structured server logs, but return a generic localized internal server error in production. Development and test can keep detailed messages if needed.

## P1 High Priority

### 1. Hermes Provider Logs Raw Request And Stream Data

Evidence:

`packages/providers/hermes/src/HermesProviderClient.ts` contains:

```text
console.log("startRun body", body)
console.log("event", { rawEvent, mappedEvent: event })
```

Impact: task input, conversation content, API payloads, and runtime events may be written to stdout, local logs, container logs, or cloud logging systems.

Recommended fix: remove these logs or guard them behind an explicit debug flag with strict redaction.

### 2. Dead Code And Dependency Audit Fails

Evidence: `bun run deadcode` exits 1.

Observed categories:

```text
Unused files (17)
Unused dependencies (7)
Unused devDependencies (5)
Unlisted dependencies (13)
Unused exports (127)
```

Impact: dependency metadata and exported surfaces have drifted. Because `package.json` `analyze` includes `deadcode`, the full analysis gate currently fails.

Recommended fix: triage Knip results into real removals, explicit ignores, and workspace dependency declarations. Keep `bun run deadcode` green or remove it from release gating only with a documented replacement.

### 3. E2E Gate Is Not Stable To Run Locally Or In CI

Evidence: `bun run test:e2e` failed before running tests because `http://127.0.0.1:3100` was already used. `playwright.config.ts` sets `reuseExistingServer: false`.

Impact: release verification cannot reliably prove browser flows. Port conflicts can block validation even when the app is otherwise healthy.

Recommended fix: make E2E use an isolated configurable port or a dedicated CI database/server lifecycle. If local reuse is desired, make it explicit and safe.

### 4. Publish Gate Is Too Weak

Evidence: `package.json` has:

```text
"prepublishOnly": "bun run build && bun run build:npm"
```

Impact: npm publication can proceed even while tests, Bun tests, deadcode, E2E, or release smoke checks are failing.

Recommended fix: add a release gate script that includes at minimum `typecheck`, `lint`, `test`, `test:bun`, `build`, `build:npm`, and one binary smoke check. Use `prepublishOnly` to call that gate.

### 5. Docker Healthcheck Depends On `curl`

Evidence: `Dockerfile` healthcheck uses:

```text
curl -f http://localhost:3101/health || exit 1
```

The runtime image is `oven/bun:1-slim`.

Impact: if `curl` is absent from the slim image, the container can be marked unhealthy even if Chrona is running.

Recommended fix: use a Bun-native healthcheck command or explicitly install `curl` in the runtime image.

## P2 Medium Priority

### 1. Lint Has 732 Warnings

Evidence: `bun run lint` exits 0 but reports 732 warnings.

Examples include complexity, max lines, max statements, max params, unnecessary conditionals, and switch exhaustiveness warnings.

Impact: not an immediate runtime blocker, but warning volume hides important regressions and weakens lint as a release signal.

Recommended fix: separate historical style warnings from release-critical rules. Promote correctness and exhaustiveness issues to errors once current debt is triaged.

### 2. Dependency Boundary Check Has 53 Warnings

Evidence: `bun run check:boundaries` exits 0 but reports 53 warnings, including circular dependencies and `no-apps-import-internals` warnings.

Impact: architecture debt exists and can make release fixes riskier over time.

Recommended fix: record accepted historical debt and prevent new warnings from being introduced.

### 3. Binary Runtime Database Name Is Still `dev.db`

Evidence: `packages/cli/src/bun-entry.ts` uses user data directory path ending in `dev.db`.

Impact: functionality works, but formal product release should not create production user data with a development filename.

Recommended fix: use `chrona.db` for released binaries. If prior users already have `dev.db`, handle migration/rename deliberately.

### 4. Binary Migrations Are Custom SQLite Execution

Evidence: `packages/cli/src/bun-entry.ts` manually creates `_prisma_migrations`, reads migration SQL files, runs SQL via `bun:sqlite`, and records empty checksums.

Impact: first-start smoke passed, but migration integrity differs from Prisma's normal checksum and failure semantics.

Recommended fix: document why custom migration execution is required for portable binaries, then add failure tests for partial migrations and checksum/migration drift behavior.

### 5. Vite Build Emits Chunk And Dynamic Import Warnings

Evidence: production build warns about chunk size and ineffective dynamic import for i18n JSON modules.

Impact: not a release blocker, but may affect bundle shape and performance expectations.

Recommended fix: review i18n import strategy and chunking after blockers are fixed.

## P3 Release Experience And Operations

### 1. npm Launcher Depends On External Tools For Bun Download

Evidence: `packages/cli/src/npm-launcher.ts` downloads Bun through `curl` or `wget`, then extracts with `unzip`. Windows automatic Bun download is not supported.

Impact: npm install/run path can fail on machines without these tools. README currently emphasizes binary downloads, so this is a secondary release risk.

Recommended fix: document prerequisites or replace download/extract implementation with a more self-contained path.

### 2. GitNexus Index Is Stale

Evidence: GitNexus reported the Chrona index is 24 commits behind HEAD.

Impact: does not affect product runtime, but reduces confidence in future graph-based impact analysis.

Recommended fix: run `npx gitnexus analyze` before using GitNexus for release-critical change impact analysis.

### 3. Local `.env` Exists In Workspace

Evidence: `.env` exists in the repository working directory. `.dockerignore` excludes `.env*` and `git status --short` was clean.

Impact: no tracked secret leak was observed, but release scripts must continue to avoid packaging local environment files.

Recommended fix: keep `.env*` excluded from Docker context and package artifacts except `.env.example`. Add an explicit release artifact check if publishing automation grows.

## Minimum Recommended Release Gate

Before formal release, require this sequence to pass in a clean environment:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run check:ui-foundation
bun run check:boundaries
bun run deadcode
bun run build
bun run build:npm
bun run build:binary:linux-x64
bun run test:e2e
```

Also require a binary smoke test that starts Chrona with a fresh data directory, verifies `/health`, verifies the SPA root, and shuts down cleanly.

## Minimum Fix Line For First Formal Release

1. Make `bun run test` and `bun run test:bun` pass.
2. Fix Docker startup defaults and healthcheck.
3. Stop returning raw AI client secrets from `/api/ai/clients`.
4. Stop returning internal error messages in production 500 responses.
5. Remove or strictly gate raw Hermes request/event logs.
6. Strengthen `prepublishOnly` or add a dedicated `release:check` script.
7. Make E2E validation stable in CI and local clean environments.
