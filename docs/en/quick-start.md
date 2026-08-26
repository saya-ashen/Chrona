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

Before the first start or after changing data/network settings, inspect the local setup:

```bash
chrona doctor
```

The command checks data/config directory permissions; the database, SQLite sidecars, locks, restore artifacts, and automatic backup permissions; integrity; runtime-lock ownership; backup readiness; and localhost/API-key safety. A missing database before first start is expected; `chrona start` creates it. If it reports a confirmed stale lock, run `chrona doctor --repair-stale-lock`; this quarantines only the stale lock and never deletes the database.

Chrona stores local data under platform-specific application directories. You can override them when needed:

```bash
CHRONA_DATA_DIR=/custom/path/data chrona start
CHRONA_CONFIG_DIR=/custom/path/config chrona start
```

Back up local data before upgrading:

```bash
chrona backup ./chrona-before-upgrade.db
```

On the next `chrona start`, a pending migration creates a verified automatic recovery point under the database's `backups/pre-upgrade/` directory before changing schema history. Chrona runs one process per database; stop Chrona before `restore`.

See [Backup, Restore, and Local Operations](./operations.md) for recovery and safe local deployment, and [Local privacy and data handling](./privacy.md) before configuring external providers or sharing diagnostics.

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
3. Add the default OMP AI client and run its configuration check. The check resolves configured local SDK/model settings; it is not a remote credential or model-access probe. The five-minute demo provider request is the remote credential/model proof.
4. Bind only the feature slots shown for that provider. `task.plan` and `goal.review` accept either authoritative cross-process recovery or OMP's terminal-only read-only single-attempt contract. OMP fails closed after an uncertain interrupted start and requires an explicit new operation; lower-level feature slots such as `generate_plan`, `suggest`, `chat`, and `dispatch_task` may also appear in developer-facing contexts.
5. Create a task with enough context to execute.
6. Place the task on the schedule.
7. Generate a plan from the task workspace.
8. Review or edit the plan graph, then accept it.
9. Start execution from the task workspace, or let configured auto-execution move due work forward.
10. Review progress, blockers, approvals, and outputs from the task workspace or Dashboard.

## Providers and AI clients

Chrona stores AI clients and feature bindings in the database. Chrona does not ship a built-in model provider today; configure an external provider client before using AI-backed features.

- `omp`: Stable / Tier-1 in-process SDK adapter and default first-run provider. It supports `task.plan`, `task.execution`, `dashboard.brief`, and `goal.review`, plus local result finalization. Session history resumes where available. Its terminal-only read-only starts run once; an uncertain interruption is never auto-replayed and requires an explicit new operation. Its configuration check resolves SDK/model setup only; use the five-minute demo provider request to prove remote credentials and model access.
- `claude_code`: Beta adapter; do not rely on it for the stable five-minute first-run path yet.
- `codex`: Beta ACP adapter; do not rely on it for the stable five-minute first-run path yet.
- `hermes`: Experimental adapter for existing gateway setups; its setup/config flow is not stable-release evidence yet.

Feature bindings decide which client handles which capability. Product-oriented bindings include `task.plan`, `task.execution`, and `dashboard.brief`; lower-level feature slots such as `suggest`, `generate_plan`, `conflicts`, `timeslots`, `chat`, and `dispatch_task` remain available where needed.

### OMP (Stable Tier-1 SDK adapter)

1. Open **Settings → AI Clients → Add Client → OMP**. OMP is listed first and is the default first-run client type.
2. Enter a model and credentials, or leave credentials empty to use local `~/.omp` credentials; save and run the configuration check.
3. Bind the displayed product features: `task.plan`, `task.execution`, `dashboard.brief`, and `goal.review`.
4. Use **Start with Chrona → Use safe demo** as the five-minute provider request. It proves remote credentials and model access without granting external tools or side effects.
5. If a terminal-only read-only planning or review start is interrupted before Chrona records its outcome, Chrona does not replay it. Start a new operation explicitly. Session history can resume where the provider exposes it.

The SDK configuration check validates local SDK/model resolution only. The five-minute demo provider request is the authority for remote credentials and model access.

### Claude Code

Use `Settings -> AI Clients -> Add Client -> Claude Code`.

Common fields:

| Field | Purpose | Default / note |
| --- | --- | --- |
| Model | Claude model passed to Claude Code | Defaults to Chrona's provider default if left empty |
| API key | Anthropic API key for Claude Code | Optional; leave empty to use the user's existing Claude Code auth/config |
| Config directory | Claude Code config/state directory | Optional; empty means Claude Code's default user-level config |
| Working directory | Filesystem scope for the run | Optional; defaults to the Chrona process working directory |
| MCP base URL | Chrona `/api/mcp` server URL | Defaults to the current Chrona server |
| MCP bearer token | Bearer token for Chrona MCP requests | Usually leave empty; use `CHRONA_API_KEY` or `CHRONA_MCP_BEARER_TOKEN` when API auth is enabled |
| Timeout | Maximum provider run time | Optional |

### Codex

Use `Settings -> AI Clients -> Add Client -> Codex`.

Common fields:

| Field | Purpose | Default / note |
| --- | --- | --- |
| Model | Codex model passed through provider config | Optional |
| API key | OpenAI/Codex API key | Optional; also passed as `CODEX_API_KEY` and `OPENAI_API_KEY` for the provider process |
| Base URL | OpenAI-compatible gateway URL | Optional |
| Config directory | Codex home directory | Optional; empty means default user-level `CODEX_HOME` (`~/.codex`) |
| Working directory | Filesystem scope for the run | Optional; defaults to the Chrona process working directory |
| MCP base URL | Chrona `/api/mcp` server URL | Defaults to the current Chrona server |
| MCP bearer token | Bearer token for Chrona MCP requests | Usually leave empty; use `CHRONA_API_KEY` or `CHRONA_MCP_BEARER_TOKEN` when API auth is enabled |
| Timeout | Maximum provider run time | Optional |

## Task workspace execution basics

The task workspace is the main execution surface for a task. It combines:

- latest result
- accepted/generated plan graph
- execution records grouped around plan runs and runtime events
- task metadata and schedule status
- conversation and command center context
- checkpoints, inputs, approvals, blocks, and failure recovery actions

## Backup and recovery

Packaged Chrona provides consistent SQLite backup and restore commands:

```bash
chrona backup ./chrona-backup.db
# Stop Chrona before restoring.
chrona restore ./chrona-backup.db --force
```

Backups contain sensitive task, provider, and execution data. Store them securely. See [Local Operations](./operations.md) for platform data paths and the upgrade procedure.

## Troubleshooting

- If the server is unreachable, confirm the process is listening on port `3101` and that no other service is using it.
- If AI features do nothing, verify Settings / AI Clients has an enabled client and feature binding.
- If provider setup fails, verify the configured AI client is enabled, bound to the feature you are using, and has valid auth/config directory settings.
- If execution pauses, check the task workspace or Dashboard for waiting input, approval, block, or failure state.
- If developing locally after schema or dependency changes, run `bun run setup`. On NixOS, Prisma may require custom engine configuration or `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` because upstream checksum files can be unavailable for the `linux-nixos` engine target.
