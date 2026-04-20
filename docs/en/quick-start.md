# Chrona Quick Start

## What Chrona does

Chrona is currently organized around two main product blocks:
- schedule creation and arrangement
- automatic task completion

The schedule side helps users go from rough intent to a concrete calendar block and task plan.
The task side is moving toward scheduled, agent-driven execution with automatic plan updates.

## Prerequisites

- Bun 1.x
- Git
- SQLite via Prisma (local default setup)

## Install

```bash
git clone <repo-url> Chrona
cd Chrona
bun install
```

## Initialize local development

```bash
bunx prisma generate
bun run db:seed
```

Note: `bunx prisma db push` is currently not reliable in this repository on this environment, so it is not listed here as a primary setup command until that workflow is stabilized.

## Start the web app

```bash
bun run dev
```

Then open:
- http://localhost:3000

## Optional: start the OpenClaw bridge

If you want to test agent execution through the OpenClaw bridge:

```bash
bun run services/openclaw-bridge/server.ts
```

Default bridge URL:
- http://localhost:7677

## Runtime directions

Chrona’s backend is being designed to support multiple runtime backends behind the same product surface:
- bare LLM
- OpenClaw
- Hermes

This means planning and execution should stay product-consistent even if the actual runtime provider changes.

## Current product flow

### A. Schedule creation and arrangement

The scheduling side is focused on helping users create and refine work blocks.

Planned/active ideas include:
- intelligent prompts when creating schedule items
- AI-assisted task planning
- turning loose text into structured task plans
- fast review and editing inside the scheduling cockpit

### B. Task automatic completion

The task side is focused on agent execution.

Current direction:
- run an agent automatically according to the schedule
- let the agent complete the task with the configured runtime
- automatically update the plan as execution progresses
- keep planning and execution synchronized

## Useful commands

```bash
bun run dev
bun run test
bun run chrona --help
bun run agentdash --help
```

## Next reading

- Product roadmap: ./roadmap.md
- Architecture: ../architecture.md
