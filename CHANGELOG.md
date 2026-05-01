# Changelog

## 0.1.4

### Breaking changes
- **Bun-only runtime** — removed Node.js server entry, `tsx`, `@types/node`, and `better-sqlite3`. Chrona requires Bun >= 1.3.11 as the application runtime.

### Features
- Redesigned schedule page with modern three-panel cockpit UI and linear full-day hour scale
- Adaptive timeline with reduced scroll length
- Delete task button in Task cockpit and Task page
- Nix development shell support with smoke tests and build infrastructure
- Workspace isolation guards in API routes

### Fixes
- OpenClaw: prevent mixed input arrays from causing errors
- SPA path resolution no longer depends on CWD (`CHRONA_WEB_DIST` env fix)
- Release quality: 235 lint errors, typecheck errors, and 2 failing tests resolved
- Prisma 7 WASM crash workaround when `DbNull` sentinel used on nullable fields
- Timeline resize clamping calculation corrected
- ESLint rules properly scoped — test files no longer flagged for `no-explicit-any`

### Internal
- E2E tests consolidated into a single `full-ai-task-flow` spec
- 12 pure-logic tests migrated from Vitest to Bun-native runner
- ESLint `no-unused-vars` configured with `^_` ignore conventions

## 0.1.3

### Features
- Auto-setup improvements — OS-standard data/config directories on first launch
- Build and test suite stabilization
- Documentation overhaul: Diátaxis framework, testing guide, API reference
- Repeatable Playwright spec for README demo recordings

### Fixes
- SPA routes without extensions now return `text/html` instead of `application/octet-stream`
- Static assets (`/assets/*`, `/favicon.*`) no longer incorrectly redirected through locale prefix
- Circular dependency deadlock fixed in runtime sync module
- Top-level `await` removed from npm entry to avoid unsettled promise warnings

### Internal
- API workflow integration tests (task CRUD, plan lifecycle, schedule proposals, bridge contracts)
- Testing guide covering runners, coverage, mock strategy, and CI configuration

## 0.1.2

### Features
- npm package `@chrona-org/cli` — install via `npm install -g` and run `chrona start`
- Bun runtime embedded via npm binary — no separate Bun install required for users
- Auto-setup on first launch: creates data/config directories, SQLite database, runs migrations
- Single binary entry point: `chrona start` (server) + `chrona task|run|schedule|ai` (CLI client)
- OS-standard data directories (XDG on Linux, App Support on macOS, %APPDATA% on Windows)
- Static assets served with correct MIME types (JS, CSS, HTML, ICO)

### Fixes
- SPA routes without extensions now return `text/html` instead of `application/octet-stream`
- Static assets (`/assets/*`, `/favicon.*`) no longer incorrectly redirected through locale prefix
- Circular dependency deadlock fixed in runtime sync module

## 0.1.0 — Initial release

### Features
- AI-native task control plane: plan, schedule, and execute tasks with agent support
- Task workspace with editable plan graph (nodes, edges, dependencies)
- Assistant chat with persistent DB-backed message history and proposal application
- AI plan generation with real-time SSE streaming and accept/dismiss flow
- Schedule page with calendar view, time blocks, and conflict detection
- Multi-language support (English, Chinese)
- REST API with Hono
- SQLite database with Prisma 7

### Tech Stack
- **Frontend:** Vite + React 19 + React Router 7 (SPA)
- **Backend:** Hono API server (Bun)
- **Database:** SQLite via Prisma 7 with Bun SQLite adapter
- **AI:** OpenClaw bridge, LLM providers via OpenRouter-compatible API
