# Chrona Quick Start

Get Chrona running in 2 minutes.

## What is Chrona

Chrona is an AI-native task control plane with two core loops:

- **Schedule** — turn rough intent into concrete time blocks and structured task plans
- **Execute** — let AI agents carry tasks forward with continuously updated plans

## Prerequisites

| Requirement | Check |
|------------|-------|
| **Node.js >= 20** | `node --version` (for npm install only) |
| **npm** | `npm --version` (bundled with Node.js) |

```bash
# Verify your Node.js version (npm install only; runtime is Bun)
node --version  # must be >= 20.0.0
```

Chrona runs on **Bun** as its application runtime. The npm package ships
with an embedded Bun binary — no separate Bun install is required.

## Install

```bash
npm install -g @chrona-org/cli
```

Installs the `chrona` command globally.

## Start

```bash
chrona start
```

First run does everything automatically:

1. Creates data directory (`~/.local/share/chrona/` on Linux)
2. Creates config file (`~/.config/chrona/.env` from bundled template)
3. Creates SQLite database and runs schema migrations
4. Starts the server at `http://localhost:3101`

Open `http://localhost:3101` in your browser. The web app runs entirely locally — no cloud account, no SaaS.

### Data directories

| Platform | Data | Config |
|----------|------|--------|
| Linux | `~/.local/share/chrona/` | `~/.config/chrona/` |
| macOS | `~/Library/Application Support/chrona/` | `~/Library/Preferences/chrona/` |
| Windows | `%APPDATA%/chrona/` | `%APPDATA%/chrona/` |

Override with environment variables:

```bash
CHRONA_DATA_DIR=/custom/path/data chrona start
CHRONA_CONFIG_DIR=/custom/path/config chrona start
```

## Configure AI Backends

Open **Settings > AI Clients** in the web app.

### Option A: LLM (recommended for quick start)

Use any OpenRouter-compatible API. You need:
- An API key from your LLM provider
- The model name you want to use

Example configuration:
```json
{
  "name": "My Claude",
  "type": "llm",
  "config": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### Option B: OpenClaw Gateway

For dedicated agent execution. You need:
- A running OpenClaw gateway (default: `http://localhost:18789`)
- A gateway token

Test connectivity from the Settings page after configuring.

## CLI Usage

The `chrona` command also works as a CLI client:

```bash
# Task operations
chrona task list                                    # List tasks
chrona task create --title "Research competitor products"  # Create
chrona task show <id>                               # Show details

# Run operations
chrona run start <task-id>                          # Start agent run

# Schedule operations
chrona schedule list                                # List scheduled tasks

# AI operations
chrona ai suggest --title "bug fix"                 # Get AI suggestions
```

All commands accept `--base-url` to target a different API server:

```bash
chrona task list --base-url http://other-machine:3101
```

## Your First Task Walkthrough

### 1. Create a task

Navigate to the **Schedule** page, click the "+" button, and describe your work:

```
Title: Analyze Q4 sales data
Description: Pull data from the analytics DB, identify trends,
             and generate a summary report with charts
```

### 2. Generate an AI plan

Click **"Generate Plan"** for your task. Chrona streams an AI-generated execution plan with typed nodes, dependencies, and time estimates. Review the plan, edit if needed, then **Accept** it.

### 3. Schedule the task

Drag and drop the task onto the calendar to assign a time block. Or use **AI Suggest Timeslot** to let Chrona find an optimal window.

### 4. Run the agent

Click **"Start Run"** on the task. Watch the live conversation, tool calls, and progress in the **Work** view. The agent may request input or approvals — you stay in control.

### 5. Review and iterate

When the run completes, review the generated artifacts. Accept the result or create a follow-up task.

## Server Options

```bash
chrona start                     # Default on port 3101
PORT=3100 chrona start           # Custom port
HOST=0.0.0.0 chrona start        # Bind to all interfaces
```

In production mode, a single server hosts both the API and the static SPA on the same port.

## Troubleshooting

### "command not found: chrona"

Make sure npm's global bin directory is in your PATH:

```bash
npm config get prefix          # e.g. /home/user/.npm-global
export PATH="$PATH:$(npm config get prefix)/bin"
```

### Port 3101 is already in use

```bash
chrona start
# Error: listen EADDRINUSE :::3101

# Use a different port
PORT=3102 chrona start
```

### AI backend not responding

1. Verify network connectivity: `curl -I https://api.openai.com/v1/models`
2. Check your API key hasn't expired
3. Test connectivity from **Settings > AI Clients** → **Test Connection**

### Database issues

```bash
# Reset everything (deletes all data!)
rm -rf ~/.local/share/chrona/chrona.db
chrona start    # Recreates fresh DB
```

## Next Steps

- [Roadmap](./roadmap.md) — product direction and phases
- [Architecture](../architecture.md) — CQRS + Event Sourcing deep dive
- [API Reference](../api-reference.md) — full REST API docs
- [Data Model](../data-model.md) — database schema reference
