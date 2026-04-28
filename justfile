# ── Development ──────────────────────────────────────────────

# Start web + server in dev mode (concurrent)
dev:
    bun run dev

# Start only the Vite web dev server
dev:web:
    bun run dev:web

# Start only the Hono API server (tsx watch)
dev:server:
    bun run server:dev

# Start only the Hono API server (Bun runtime)
dev:server:bun:
    bun run server:dev:bun

# ── Build ────────────────────────────────────────────────────

# Build the Vite SPA
build:
    bun run build

# Full build (SPA + bundle-check)
build:full:
    bun run build:full

# Build the npm distribution package
build:npm:
    bun run build:npm

# ── Check & Lint ─────────────────────────────────────────────

# Run all checks (typecheck + lint) — AGENTS.md required flow
check: typecheck lint

# TypeScript type checking
typecheck:
    bun run typecheck

# ESLint across the monorepo
lint:
    bun run lint

# Dependency-cruiser boundary check
check:boundaries:
    bun run check:boundaries

# ── Test ─────────────────────────────────────────────────────

# Run vitest with coverage
test:
    bun run test

# Run vitest in watch mode
test:watch:
    bun run test:watch

# Run Playwright E2E tests
test:e2e:
    bun run test:e2e

# ── Database ─────────────────────────────────────────────────

# Generate Prisma client
db:generate:
    bun run db:generate

# Push schema to SQLite database
db:push:
    bun run db:push

# Run Prisma migrations
db:migrate:
    bun run db:migrate

# Seed the database
db:seed:
    bun run db:seed

# Full DB setup: generate client + seed
db:setup:
    bun run setup

# ── CLI ──────────────────────────────────────────────────────

# Build the Chrona CLI binary
cli:build:
    bun run cli:build

# ── Demo (Playwright recordings) ─────────────────────────────


# Remove old artifacts and GIFs
clean-videos:
    rm -rf artifacts/demo/playwright/
    rm -f docs/assets/demo-plan.gif docs/assets/demo-assistant.gif

# Run the Playwright recordings
_playwright:
    bunx playwright test --config=playwright.record.config.ts

# Convert recorded videos to GIFs
_convert-gifs:
    @sh scripts/demo/convert-record-gifs.sh

# Run both demos in debug mode
demo-debug: clean-videos
    bunx playwright test --config=playwright.record.config.ts --debug

# ── Misc ─────────────────────────────────────────────────────

# Clean all generated artifacts
clean:
    rm -rf artifacts/demo/playwright/
    rm -rf dist/
    rm -rf coverage/
    rm -rf .tsbuildinfo

# OpenClaw runtime probe
probe:openclaw:
    bun run probe:openclaw
