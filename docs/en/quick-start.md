# Chrona Quick Start

This guide covers two paths:

1. Download a packaged release from GitHub and run `chrona start`.
2. Develop from the repository: use Bun and the workspace scripts.

## Option A: packaged release

Use this path when you want to run Chrona without cloning the repository.

1. Open the [latest GitHub release](https://github.com/saya-ashen/Chrona/releases/latest).
2. Download the archive for your platform:

| Platform | Asset |
| --- | --- |
| Linux x64 | `chrona-linux-x64.tar.gz` |
| Linux ARM64 | `chrona-linux-arm64.tar.gz` |
| macOS Apple Silicon | `chrona-darwin-arm64.tar.gz` |
| Windows x64 | `chrona-windows-x64.tar.gz` |
3. Extract the archive and start Chrona:

```bash
tar -xzf chrona-linux-x64.tar.gz
cd chrona-linux-x64
./chrona start
```

On Windows:

```powershell
tar -xzf chrona-windows-x64.tar.gz
cd chrona-windows-x64
.\Chrona.exe start
```

The packaged command starts the local Chrona server, normally at `http://localhost:3101`, and serves the web app from the same origin.

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
3. Add an AI client. For local agent execution, choose `Hermes`.
4. Bind it to the features you want to use, such as `generate_plan`, `suggest`, `chat`, or `dispatch_task`.
5. Create a task with enough context to execute.
6. Place the task on the schedule.
7. Generate a plan from the task workspace.
8. Review or edit the plan graph, then accept it.
9. Start execution from the task workspace, or let configured auto-execution move due work forward.
10. Review progress, blockers, approvals, and outputs from Inbox or the task workspace.

## Providers and AI clients

Chrona stores AI clients and feature bindings in the database. Chrona does not ship a built-in model provider today; configure an external provider client before using AI-backed features.

- `hermes`: primary supported execution provider for Hermes-backed agent execution.
- `debug`: deterministic local test/development provider.

Feature bindings decide which client handles which capability. Typical features are `suggest`, `generate_plan`, `conflicts`, `timeslots`, `chat`, and `dispatch_task`.

### Local Hermes

Use local Hermes when the Hermes gateway runs on the same machine as Chrona.

1. Add a `Hermes` client.
2. Keep `Hermes location` set to `Local Hermes`.
3. Keep `Base URL` as `http://127.0.0.1:8642` unless your Hermes API server uses another port.
4. Click `Diagnose Hermes` to check the CLI, plugin, plugin MCP URL, Hermes `.env`, API key, reachability, and capabilities.
5. Click `Auto-configure local Hermes` when setup is missing. Chrona can install/update the plugin, write plugin config, and write `API_SERVER_ENABLED=true` plus `API_SERVER_KEY` to `~/.hermes/.env`.
6. Restart Hermes when prompted. Chrona can request `hermes gateway restart`, but if Hermes runs through a service or custom command, restarting it yourself is often clearer.

Equivalent CLI checks:

```bash
chrona hermes doctor
chrona hermes setup
chrona hermes setup --show-api-key
```

### Remote Hermes

Use remote Hermes when the Hermes gateway runs on another machine.

1. Add a `Hermes` client.
2. Set `Hermes location` to `Remote Hermes`.
3. Enter the remote base URL and API key.
4. On the remote machine, install/enable the Chrona Hermes plugin, point the plugin MCP URL at this Chrona server, set `API_SERVER_ENABLED=true`, set `API_SERVER_KEY`, and restart Hermes.
5. Run `Diagnose Hermes` and `Test availability` from Chrona.

## Task workspace execution basics

The task workspace is the main execution surface for a task. It combines:

- latest result
- accepted/generated plan graph
- execution records grouped around plan runs and runtime events
- task metadata and schedule status
- conversation and command center context
- checkpoints, inputs, approvals, blocks, and failure recovery actions

## Troubleshooting

- If the server is unreachable, confirm the process is listening on port `3101` and that no other service is using it.
- If AI features do nothing, verify Settings / AI Clients has an enabled client and feature binding.
- If Hermes diagnosis fails, read the individual checks first. Local mode can auto-fix plugin/config/env issues; remote mode shows manual instructions because Chrona should not modify another machine.
- If execution pauses, check Inbox and the task workspace for waiting input, approval, block, or failure state.
- If developing locally after schema or dependency changes, run `bun run setup`. On NixOS, Prisma may require custom engine configuration or `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` because upstream checksum files can be unavailable for the `linux-nixos` engine target.
