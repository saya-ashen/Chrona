# Chrona Quick Start

## What is Chrona

Chrona is an AI-native task control plane with two core loops:

- **Schedule** — turn rough intent into concrete time blocks and structured task plans
- **Execute** — let AI agents carry tasks forward with continuously updated plans

## Prerequisites

- **Node.js >= 20** — the only runtime requirement
- No Bun, no build tools, no Docker needed

## Install

```bash
npm install -g @chrona-org/cli
```

## Start

```bash
chrona start
```

First run does everything automatically:
- Creates `~/.local/share/chrona/` (data)
- Creates `~/.config/chrona/.env` (config, from the bundled template)
- Creates the SQLite database and runs schema migrations
- Opens `http://localhost:3101` in your browser

The web app runs entirely locally — no cloud account, no SaaS.

### Data directories

| Platform | Data | Config |
|----------|------|--------|
| Linux | `~/.local/share/chrona/` | `~/.config/chrona/` |
| macOS | `~/Library/Application Support/chrona/` | `~/Library/Preferences/chrona/` |
| Windows | `%APPDATA%/chrona/` | `%APPDATA%/chrona/` |

Override with env vars: `CHRONA_DATA_DIR`, `CHRONA_CONFIG_DIR`.

## Configure AI Backends

Open **Settings > AI Clients** in the web app to add and configure AI backends.

Two backend types are supported:

### LLM (OpenRouter-compatible API)

Any OpenRouter-compatible endpoint. Configure via the web UI — add an LLM client with your API key and model name.

### OpenClaw Gateway

Add an OpenClaw client in the web UI with your gateway URL and token. Test connectivity from the Settings page after configuring.

## CLI Usage

The `chrona` command also functions as a CLI client for the local API:

```bash
chrona task list                          # List tasks
chrona task create --title "Research X"   # Create a task
chrona task show <id>                     # Show task details
chrona run start <task-id>               # Start agent run
chrona schedule list                     # List scheduled tasks
chrona ai suggest --title "idea"         # AI task suggestions
```

All commands accept `--base-url` to target a different API server.

## Product Flow

### 1. Create & schedule

Create tasks in the web app or via CLI. Use the Schedule page's calendar view to drag tasks into time slots. AI features help with auto-complete, plan generation, and timeslot suggestions.

### 2. Configure execution

Each task can be assigned a runtime adapter (e.g. `openclaw`), an AI model, and an execution prompt. The task workspace provides a visual plan graph that you can edit, reorder, and materialize into child tasks.

### 3. Run & observe

Start an agent run on a task. Watch the live conversation, tool calls, and approvals in the Work view. Agents can request input or approval mid-run. Execution progress automatically updates the plan.

## Server Options

```bash
chrona start                     # Default on port 3101
PORT=3100 chrona start           # Custom port
HOST=0.0.0.0 chrona start        # Bind to all interfaces
```

The server hosts both the API and the static SPA from the same port in production mode.

## Next Reading

- [Roadmap](./roadmap.md) — what's planned
- [Architecture](../architecture.md) — CQRS + Event Sourcing design
- [API Reference](../api-reference.md) — REST API docs
