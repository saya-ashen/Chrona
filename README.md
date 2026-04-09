# Agent Dashboard

AI-native task control plane prototype for planning, scheduling, and observing runtime-backed work.

## What It Is

This repository implements the schedule-first MVP described in `docs/superpowers/specs/2026-04-09-task-centric-ai-control-plane-design.md`.

Key product surfaces:
- `Schedule`: top-level planning surface for scheduled blocks, unscheduled work, AI proposals, and overdue/conflict risk
- `Tasks`: task-centric control surface
- `Work`: execution-centric surface with timeline, conversation, approvals, and artifacts
- `Inbox` and `Memory`: human intervention and memory management surfaces
- `Workspaces`: advanced/internal management surface reached through `Settings -> Advanced`

Default app entry now follows a single-workspace UX:
- `/` redirects to `/schedule`
- `Schedule`, `Tasks`, `Inbox`, and `Memory` automatically resolve a default workspace
- the internal `Workspace` model and `/workspaces/*` routes still exist for advanced flows

## Tech Stack

- Next.js App Router
- React 19
- TypeScript
- Bun
- Prisma with SQLite (`prisma/dev.db` locally)
- Playwright, Vitest, and `bun test`

## Local Setup

1. Install dependencies:

```bash
bun install
```

2. Create local env if needed:

```bash
cp .env.example .env
```

3. Regenerate the Prisma client if the schema changed:

```bash
bunx prisma generate
```

4. Seed the local database:

```bash
bun run db:seed
```

5. Start the app:

```bash
bun run dev
```

Open `http://127.0.0.1:3000`.

## Useful Commands

```bash
bun run lint
bun run test
bun test
bun run test:e2e
bun run build
bun run probe:openclaw
```

Notes:
- `bun run test` runs the Vitest component suite.
- `bun test` runs Bun-based module tests.
- `bun run test:e2e` requires Playwright browser dependencies to be available on the host.

## Schedule-First Seed Data

`bun run db:seed` prepares a demo workspace with both execution and planning examples, including:
- a running task with timeline/artifact data
- a waiting-for-approval task
- a scheduled task (`Prepare release schedule`)
- an unscheduled task with a pending AI proposal (`Queue follow-up docs`)
- an overdue task that needs replanning (`Recover overdue adapter run`)

## OpenClaw Integration

The current runtime adapter target is OpenClaw. Probe the feasibility gate with:

```bash
OPENCLAW_MODE=live bun run probe:openclaw
```

This requires `OPENCLAW_GATEWAY_URL` (or legacy `OPENCLAW_BASE_URL`) in `.env`.

## Planning Artifacts

- Spec: `docs/superpowers/specs/2026-04-09-task-centric-ai-control-plane-design.md`
- Plan: `docs/superpowers/plans/2026-04-09-schedule-first-mvp-alignment.md`
- Plan: `docs/superpowers/plans/2026-04-09-single-workspace-ux-alignment.md`
