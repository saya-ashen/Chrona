# Chrona Quick Start

This guide covers two paths:

1. Use the packaged CLI: install `@chrona-org/cli`, then run `chrona start`.
2. Develop from the repository: use Bun and the workspace scripts.

## Option A: packaged CLI

Prerequisites:

- Node.js 20 or newer
- npm for installing the published package

```bash
node --version
npm --version
npm install -g @chrona-org/cli
chrona start
```

`chrona start` starts the local Chrona server, normally at `http://localhost:3101`, and serves the web app from the same origin.

Chrona stores local data under platform-specific application directories. You can override them when needed:

```bash
CHRONA_DATA_DIR=/custom/path/data chrona start
CHRONA_CONFIG_DIR=/custom/path/config chrona start
```

## Option B: repository development

Prerequisites:

- Bun 1.3.x or newer
- Git

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

Common repository commands:

```bash
bun run server:start  # API + static app server
bun run dev:web       # Vite web dev server only
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
```

## First run checklist

1. Open `http://localhost:3101`.
2. Open Settings / AI Clients.
3. Add an AI client.
4. Bind it to the features you want to use, such as `generate_plan`, `suggest`, `chat`, or `dispatch_task`.
5. Create a task.
6. Generate a plan.
7. Review and accept the plan.
8. Start execution from the task workspace or Work page.

## AI clients

Chrona stores AI clients and feature bindings in the database. Supported client types include:

- `llm`: OpenAI/OpenRouter-compatible model calls for lightweight AI features.
- `hermes`: Hermes-backed agent execution when the Hermes bridge/provider is configured.

Feature bindings decide which client handles which capability. Typical features are `suggest`, `generate_plan`, `conflicts`, `timeslots`, `chat`, and `dispatch_task`.

## Work page basics

The Work page is the main execution surface for a task. It combines:

- latest result
- accepted/generated plan graph
- execution records grouped around plan runs and runtime events
- task metadata and schedule status
- conversation and command composer context
- checkpoints, inputs, approvals, blocks, and failure recovery actions

## Troubleshooting

- If the server is unreachable, confirm the process is listening on port `3101` and that no other service is using it.
- If AI features do nothing, verify Settings / AI Clients has an enabled client and feature binding.
- If execution pauses, check Inbox and the Work page for waiting input, approval, block, or failure state.
- If developing locally after schema or dependency changes, run `bun run setup`. On NixOS, Prisma may require custom engine configuration or `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` because upstream checksum files can be unavailable for the `linux-nixos` engine target.
