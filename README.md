English | [中文](./README.zh.md)

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>
<h1 align="center">Chrona</h1>
<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/saya-ashen/Chrona/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/saya-ashen/Chrona" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

## What Chrona is

A personal steward available in chat, an affair center you control on the web, and a background agent service that keeps working. Tell it once; it keeps context, advances what it can, reports important changes, and shows what happened, where the results are, and what remains unresolved.

Everything you hand over is an **affair**: a one-off request or something to keep watching. Simple questions can be answered without creating an affair. The agent chooses a handling method from context, not a fixed keyword menu; its choice is visible and correctable.

```text
QQ private chat / web → concierge → affairs → Pi agent → results / notifications
                         └ direct reply        ↑              ↓
                                  sources / scheduled checks  QQ / web
```

Chrona owns state, scheduling, permissions and delivery. Pi works through scoped tools; model prose alone never changes state.

## Pages

- **Today**: decisions, important changes, results and upcoming follow-ups.
- **Affairs**: what is waiting for you, active, watching, paused or done.
- **Affair**: context, current status, handling, timeline, care schedule and controls.
- **Result**: readable content, versions, sources, limitations and feedback.
- **Settings**: chat binding, notifications, permissions, preferences, sources, tools and runtime health.

## Autonomy and notifications

Deterministic policy decides: `auto`, `notify_after`, `preapproved`, `ask`, or `never`. Read-only research and internal records are normally automatic; care schedules and panels are reported afterward. Sensitive external actions require approval; credential changes are left to you. Approval does not create an implementation for an unsupported action. External text cannot grant permission.

Proactive notifications go through `now` / `digest` / `web` budgeting. Defaults: five immediate pushes per day, quiet hours 23:00–08:00 (urgent notices excepted), and a daily digest only when there is content. Excess immediate notices are folded into the digest. Settings lets you adjust the budget.

## Quick start

Requires **Bun ≥ 1.3.11** and a compatible **Pi CLI**, with model access configured for the user running Chrona. Pi must support the flags used by the [runner](packages/integrations/src/steward/pi-agent-runner.ts). Web research additionally needs an explicit web extension path.

From the repository root, choose a new, empty data directory:

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
bun run dev
```

Open `http://localhost:3100`; the API defaults to `http://127.0.0.1:3101`. Startup creates the schema and the `ws_default` workspace. Source development requires an explicit `DATABASE_URL`: setting the data directory alone does not relocate its database. Do not reuse a pre-rebuild database.

Use a trusted development network: the dev script binds Vite to all interfaces, even though the API defaults to loopback. This is not a production exposure recipe. See [operations](docs/zh/operations.md) for backups and health checks.

## Configuration

Set variables in the server process environment. Optional values are unset unless noted.

| Variable | Meaning / default |
| --- | --- |
| `DATABASE_URL` | SQLite URL; source server default `file:./prisma/dev.db` |
| `CHRONA_DATA_DIR` | Packaged CLI data root and QQ state fallback; set explicitly for predictable operation |
| `HOST`, `PORT` | API bind address and port: `127.0.0.1`, `3101` |
| `API_KEY` | API authentication; required before non-loopback exposure |
| `ALLOWED_ORIGINS` | Comma-separated additional browser origins; same-origin works by default |
| `CHRONA_WEB_PORT` | Development web port: `3100` |
| `VITE_API_BASE_URL` | Development proxy target: `http://127.0.0.1:3101` |
| `CHRONA_SERVER_WATCH` | Set `false` to disable server watch in development |
| `CHRONA_WEB_DIST` | Override built web asset directory |
| `CHRONA_CONFIG_FILE` | Optional runtime JSON config path; explicit environment values take precedence |
| `CHRONA_MIGRATIONS_DIR` | Override migration directory; source startup uses `prisma/migrations` |
| `CHRONA_STEWARD_AGENT` | Set `pi` to enable concierge and affair agent; otherwise disabled |
| `CHRONA_STEWARD_PI_COMMAND` | Pi executable path/name, default `pi` (not a shell command) |
| `CHRONA_STEWARD_PI_MODEL` | Optional model passed to Pi |
| `CHRONA_STEWARD_PI_AGENT_EXTENSION` | Override Chrona tool extension file; repository copy is discovered automatically |
| `CHRONA_STEWARD_PI_WEB_EXTENSION` | Absolute path to a compatible web extension, such as pi-web-access; absent means no web tools |
| `CHRONA_STEWARD_ASSESSOR` | `pi` for source assessment through Pi; otherwise deterministic rules |
| `CHRONA_STEWARD_TICK_SECONDS` | Background tick interval: `60` seconds |
| `CHRONA_STEWARD_CHINO_DASHBOARD_URL` | Enables the Chino service-health source adapter |
| `CHRONA_PUBLIC_URL` | HTTP(S) origin for notification links; no path, query or credentials |
| `CHRONA_QQ_APP_ID` | Dedicated QQ bot application ID |
| `CHRONA_QQ_SECRET_FILE` | Path to private app-secret file owned by the server user |
| `CHRONA_QQ_STATE_DIR` | QQ state directory; fallback: `CHRONA_DATA_DIR/qq-bot/<appId>` |
| `CHRONA_STEWARD_SANDBOX_BWRAP` | Optional sandbox executable path; no script execution by default |

Unsafe overrides `CHRONA_UNSAFE_PUBLIC_BIND` and `CHRONA_UNSAFE_CORS` exist but should remain unset. Do not enable `CHRONA_E2E_TEST_ROUTES` outside isolated tests.

## QQ bot setup

Use a dedicated official QQ bot with private-chat access enabled for your account. Set its application ID, secret-file path and data/state directory in the same environment used by the server and CLI. The secret must be a private regular file owned by that user (for example, mode `0600`); never paste it into chat or source control.

Start Chrona, then generate a one-time code:

```bash
chrona qq bind-code --workspace ws_default
```

For a source checkout without an installed `chrona` binary:

```bash
bun run packages/cli/src/index.ts qq bind-code --workspace ws_default
```

Send `绑定 <码>` to the bot in private chat. Codes expire after ten minutes by default. Only the bound owner can use the bot; normal conversation needs no command prefix. Check Settings → Chat and the QQ status file described in [operations](docs/zh/operations.md). QQ platform delivery limits still apply.

## Privacy and safety

Local-first SQLite stores affairs and results on your machine; this does **not** mean offline-only. Model calls through Pi send bounded context to the configured model service; web searches/fetches contact external services; QQ chat and notifications pass through QQ. Chino polling contacts the configured service. Protect database backups and QQ state as private data.

The agent runner disables built-in tools and loads explicit extensions. Chrona API/database/QQ configuration is filtered from its environment; Pi still needs its own model credentials. Keep unrelated secrets out of the server environment. Review sources, results and approvals rather than treating model output as verified fact.

## Project status

Rebuilt, single-owner application; no multi-user collaboration or compatibility with pre-rebuild databases. Connected source adapters are **Chino service health** and **local test** (the latter is an isolated test seam, not a production feed).

Scripts begin as drafts and require version-specific approval. Script execution is **unavailable by default**. This checkout contains an optional bubblewrap runner, requiring a configured executable and a successful isolation probe; its current mounts assume `/nix/store`. This is not a generally available or deployment-verified sandbox. A draft or approval is not evidence that a script ran.

Product goals are not a claim that every target capability has shipped. See [documentation](docs/README.md), [design goals](docs/zh/steward-goals.md), [architecture](docs/zh/steward-rebuild.md), and [contributing](CONTRIBUTING.md).

## License

[MIT](LICENSE).
