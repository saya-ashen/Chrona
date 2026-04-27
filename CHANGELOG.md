# Changelog

## 0.1.0 — Initial release

### Features
- AI-native task control plane: plan, schedule, and execute tasks with agent support
- Task workspace with editable plan graph (nodes, edges, dependencies)
- Assistant chat with persistent DB-backed message history and proposal application
- AI plan generation with real-time polling and accept/dismiss flow
- Schedule page with calendar view, time blocks, and conflict detection
- Multi-language support (English, Chinese)
- REST API with Hono (Bun/Node runtimes)
- SQLite database with Prisma ORM

### Tech Stack
- **Frontend:** Vite + React 19 + React Router 7 (SPA)
- **Backend:** Hono API server (Bun + Node.js)
- **Database:** SQLite via Prisma 7 with dual adapter (bun-sqlite / better-sqlite3)
- **AI:** OpenClaw bridge, LLM providers via OpenRouter-compatible API
