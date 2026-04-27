# Changelog

## 0.1.2

### Features
- npm package `@chrona-org/cli` — install via `npm install -g` and run `chrona start`
- Node.js runtime support (>= 20) — no Bun required for users
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
- REST API with Hono (Bun/Node runtimes)
- SQLite database with Prisma 7

### Tech Stack
- **Frontend:** Vite + React 19 + React Router 7 (SPA)
- **Backend:** Hono API server (Bun + Node.js)
- **Database:** SQLite via Prisma 7 with dual adapter (bun-sqlite / better-sqlite3)
- **AI:** OpenClaw bridge, LLM providers via OpenRouter-compatible API
