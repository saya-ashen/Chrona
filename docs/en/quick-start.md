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

## Optional: install the Chrona OpenClaw structured-result plugin

If you want structured OpenClaw task results, install the local plugin:

```bash
bun run openclaw:plugin:install
```

What it does:
- builds `packages/openclaw-plugin-structured-result`
- installs it into local OpenClaw as `chrona-structured-result`
- enables the plugin
- attempts a gateway restart

Notes from verification:
- install and enable completed successfully in this repository
- gateway restart may still report a local service-management issue, so manually restart your OpenClaw gateway/bridge process if needed
- OpenClaw may warn that `plugins.allow` is empty; if you want stricter trust configuration, pin allowed plugin ids in your OpenClaw config

## Optional: start the OpenClaw bridge

If you want to test agent execution through the OpenClaw bridge:

```bash
bun run openclaw:bridge
```

Default bridge URL:
- http://localhost:7677

Bridge notes from verification:
- the actual entrypoint is `packages/openclaw-bridge/src/server.ts`
- you can also run `bun packages/openclaw-bridge/src/server.ts` directly
- if port `7677` is already in use, the bridge exits immediately with an address-in-use error
- successful startup prints a `bridge.started` log line

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
```

## Next reading

- Product roadmap: ./roadmap.md
- Architecture: ../architecture.md
