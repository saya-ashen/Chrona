# Chrona

Chrona is an AI-native control plane for turning intent into scheduled execution.

It is designed around two product pillars:
- **Schedule creation and arrangement**
- **Automatic task completion**

The project focuses on making planning and execution feel like one connected system: users create work, shape it into time, and let agents carry tasks forward with continuously updated plans.

## Documentation

Start here:
- Docs index (English / 中文): `./docs/README.md`

Language entry points:
- English docs: `./docs/en/README.md`
- 中文文档：`./docs/zh/README.md`

Key docs:
- Quick start (EN): `./docs/en/quick-start.md`
- 快速开始（中文）：`./docs/zh/quick-start.md`
- Roadmap (EN): `./docs/en/roadmap.md`
- 路线图（中文）：`./docs/zh/roadmap.md`

## Quick Start

> For full setup details, environment variables, and runtime options, see `./docs/en/quick-start.md`.

1. Install dependencies

```bash
bun install
```

2. Generate the Prisma client

```bash
bunx prisma generate
```

3. Seed the local database

```bash
bun run db:seed
```

> Note: `bunx prisma db push` is currently not reliable in this repository on this environment, so it is intentionally not listed as a primary README command until the Prisma workflow is stabilized.

4. Start the web app

```bash
bun run dev
```

5. Optional: start the OpenClaw bridge when testing agent execution

```bash
bun run services/openclaw-bridge/server.ts
```

Open http://localhost:3000.

## Product Roadmap

### 1. Schedule Creation and Arrangement

This part of Chrona is about converting rough intent into a usable plan on the calendar.

Current and planned capabilities:
- intelligent task suggestions while creating schedule items
- AI-assisted task planning before execution
- turning loose ideas into structured task plans
- making schedule creation, review, and adjustment fast enough for daily use

### 2. Automatic Task Completion

This part of Chrona is about letting scheduled tasks run through agents with minimal manual coordination.

Current direction:
- automatically run an agent according to the schedule
- execute the task against its runtime configuration
- automatically update the task plan as work progresses
- keep execution status and planning status connected instead of drifting apart

### Backend Runtime Direction

Chrona is being designed to support multiple backend execution paths behind one product surface:
- bare LLM backends
- OpenClaw
- Hermes

The goal is to keep the scheduling and task model stable while allowing different runtime providers to power planning, execution, and follow-up updates.