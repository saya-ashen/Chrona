# Changelog

## Unreleased

### Fixed
- Pinned each Task to its first resolved execution model, reused that model for retries and later nodes, honored explicit user model changes, and rejected OMP cross-provider model drift instead of silently falling back.
- Aligned result-finalizer provider schemas with Chrona's strict per-component contracts, surfaced finalization failures with retry controls, prevented acceptance of failed finalizations, and removed duplicate artifact fallback lists.
- Compacted finalized-result readiness into the primary summary flow and corrected light-theme warning text contrast across result caveats and warning surfaces.
- Moved finalized-result content previews into a bounded Workbench-style Sheet dialog, promoted the key strategy into a single editorial feature surface, and reduced evidence/source boundaries to a compact collapsible footnote.
- Deduplicated finalized deliverables from their underlying run Artifact rows, while preserving complete Artifact fallback on finalization failure and collapsing only unreferenced extras as secondary generated files.

## 0.1.9 — Alpha public-readiness polish

Date: 2026-07-03

### Status
- Alpha release for local-first dogfood, early adopters, and contributor review.
- Not a stable production release; runtime contracts, provider behavior, recovery flows, and packaging may still change.

### Highlights
- Consolidated current product docs around the active task workspace execution surface.
- Added first-class immutable structured-result assets in Goal Workbench, with safe catalog replay, opaque generated-file references, and Markdown/PDF/JSON exports.
- Documented Vite + Hono + Bun architecture, package boundaries, API surface, data model, and provider boundary as stable contributor entry points.
- Added multi-platform release workflow and binary smoke coverage for packaged archives.
- Expanded focused tests across engine, server, web, providers, feature slices, and Playwright flows.
- Hardened completed-task restarts so active sessions, canonical runs, task lifecycle timestamps, and task projections converge on the same running state.
- Added open-source maintenance files for security reporting, support, code of conduct, and issue intake.

### Known limitations
- Task workspace execution records, schedule-to-execution reliability, recovery diagnostics, and multi-session execution remain active hardening areas.
- Hermes is the primary supported execution provider; additional providers are still evolving behind provider contracts.
- Production readiness work such as backup/restore, deployment runbooks, observability, and migration safety remains future work.

## 0.1.4-rc.1 — First MVP release candidate

Date: 2026-05-26

### Status
- First reviewable MVP release candidate for local development, internal dogfood, and friendly-user review.
- Not a stable public release; APIs, runtime contracts, packaging, and recovery flows may still change.
- RC verification notes were folded into this changelog; obsolete internal release notes were removed.

### Highlights
- Repositioned top-level English and Chinese README copy around Chrona's schedule-first loop: task, plan, schedule, and auto execution.
- Added an explicit project-status warning and roadmap summary to the README.
- Improved Work execution record usability with a run-grouped execution stream and separate sticky task cockpit.
- Hardened Inbox action copy handling so proposal and task actions use the required copy contract.
- Added focused ExecutionTimeline coverage for cockpit/stream separation and run-grouped execution behavior.

### Known limitations
- The focused React UI gate is green under Vitest/jsdom; raw `bun test` remains the wrong runner for those React Testing Library files.
- Schedule-to-auto-execution reliability, task-scoped recovery, wait/condition paths, and projection refresh behavior still need more verification before wider release.
- Packaged CLI quick-start docs still need reconciliation with the current Bun-only top-level README/runtime position.

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
- Provider bridge: prevent mixed input arrays from causing errors
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
- Portable binary release — download the platform archive and run `chrona start`
- Bun runtime embedded in the binary — no separate Bun install required for users
- Auto-setup on first launch: creates data/config directories, SQLite database, runs migrations
- Single binary entry point: `chrona start` launches the packaged server
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
- **AI:** Provider bridge, LLM providers via OpenRouter-compatible API
