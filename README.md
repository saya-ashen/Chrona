English | [中文](README.zh.md)

# Chrona

A local-first personal steward: talk in the web composer or QQ private chat, and work together in persistent sessions and apps.

## How it works

**Sessions** have directories under `<dataDir>/sessions/<id>/`. Apps (modules) keep their own files under `<dataDir>/platform/data` (code under `<dataDir>/platform/store`) and offer tools; conversation attachments are kept under `<dataDir>/platform/data/chat`. The Provider (currently Pi) works through app tools, researches and uses its own tools. Chrona supplies persistent schedules, foreground/background queues, credentials, approvals and delivery. Model prose alone does not schedule work or send messages: those actions use Chrona tools.

- **Today**: approvals, schedules and recent activity.
- **Sessions**: conversations and saved work.
- **Documents and apps**: the files app's documents, each app's runs, versions and tools.
- **Settings**: notifications, permissions, preferences and Provider/runtime health.

Schedules can wake the Provider or trigger modules, including fixed reminders without a model call and recurring executable checks. Proactive notifications pass through the built-in `notify` module's budget, including quiet hours and digests. External content cannot grant permission.

## Quick start

Requires **Bun ≥ 1.4.2**, **git**, and a pinned **Pi CLI** with model access configured in a dedicated service profile. The [Provider adapter](packages/integrations/src/steward/pi-provider.ts) uses Pi RPC; its default version pin is **0.85.0**; an explicit **1.x** pin from **1.3.0** on is also supported. Full backups additionally require GNU-compatible `tar`.

Choose a fresh data directory; do not reuse a pre-rebuild database:

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
# Replace this example with a reviewed, service-only executable; no shell arguments.
export CHRONA_STEWARD_PI_COMMAND=/opt/chrona/pi/bin/pi
export CHRONA_STEWARD_PI_VERSION=0.85.0
export CHRONA_STEWARD_PI_AGENT_DIR="$CHRONA_DATA_DIR/providers/pi"
install -d -m 700 "$CHRONA_STEWARD_PI_AGENT_DIR"
# Configure model access using this executable and PI_CODING_AGENT_DIR first.
bun run dev
```

The Pi path above is a placeholder, not an installation command. Prepare model access separately with `PI_CODING_AGENT_DIR="$CHRONA_STEWARD_PI_AGENT_DIR"` and the selected executable. Chrona does not copy personal authentication or create the profile. Use an absolute canonical profile path that does not overlap the session tree, private to the service user (Unix mode `0700`); the default `<dataDir>/providers/pi` is valid. Missing configuration or a version mismatch leaves the Provider unavailable; there is no PATH/profile fallback. See [operations](docs/zh/operations.md#确认-agent-真正可用) before upgrading an existing installation.

Open `http://127.0.0.1:3101`; `bun run dev` starts Hono in watch mode and serves both the built-in web module and API there, with no separate Vite server. Startup applies migrations and creates `ws_default`. Set both storage variables explicitly: the source server's database default is `file:./prisma/dev.db`, independent of `CHRONA_DATA_DIR`. The server binds loopback by default; configure authentication before exposing it to a network.

The packaged application uses `chrona start --no-open`. For source startup without watch mode use `bun run server:start`.

## Configuration

Set these in the server environment, then restart:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | SQLite URL; source default `file:./prisma/dev.db` |
| `CHRONA_DATA_DIR` | Platform, sessions and secrets root; set explicitly for server and CLI |
| `HOST`, `PORT` | API bind; defaults `127.0.0.1`, `3101` |
| `API_KEY` | API authentication; required before non-loopback exposure |
| `ALLOWED_ORIGINS` | Additional permitted browser origins, comma-separated |
| `CHRONA_STEWARD_AGENT` | `pi` enables the Provider; otherwise disabled |
| `CHRONA_STEWARD_PI_COMMAND` | Required absolute, reviewed service executable; no PATH fallback or shell arguments |
| `CHRONA_STEWARD_PI_VERSION` | Exact version pin; default `0.85.0`, also supports explicit `1.x` from `1.3.0` |
| `CHRONA_STEWARD_PI_AGENT_DIR` | Existing private canonical profile; default `<dataDir>/providers/pi`; never copied automatically |
| `CHRONA_STEWARD_PI_RESOURCES_FILE` | Optional private, canonical JSON manifest of reviewed explicit skill/extension entry files and extra tool names; no installation or ambient discovery |
| `CHRONA_STEWARD_PI_MODEL` | Optional Pi model selection |
| `CHRONA_STEWARD_PI_WEB_EXTENSION` | Optional explicit web extension path |
| `CHRONA_STEWARD_EXECUTION_MODE` | Owner-selected `trusted-local` (default for unset/empty values) or `required-isolation`; other values reject startup |
| `CHRONA_STEWARD_SANDBOX_BWRAP` | bubblewrap executable for Provider and module isolation in `required-isolation` mode |
| `CHRONA_STEWARD_TICK_SECONDS` | Background tick interval; default `30` seconds |
| `CHRONA_PUBLIC_URL` | Public HTTP(S) origin for notification links |
| `CHRONA_QQ_APP_ID` | Dedicated QQ bot application ID |
| `CHRONA_QQ_SECRET_FILE` | Private app-secret file owned by the server user |
| `CHRONA_QQ_STATE_DIR` | Legacy QQ state source for the first migration; fallback `<dataDir>/qq-bot/<appId>`; current state lives in the `qq` module's data |

The default `trusted-local` mode runs Pi's bash, file tools and modules as local processes with the service user's OS permissions, even when bubblewrap is installed. Host files are not hidden by an OS sandbox; `content/chat` uses symlinks, so treating attachments as read-only is an agent rule rather than an enforced mount. Chrona's routed authorization, approvals and budgets still apply; local access does not grant permission to bypass them.

Explicit `required-isolation` requires a successful bubblewrap probe for the Provider, modules and build checks, with no local fallback. The Provider masks home and Chrona data, mounts attachments read-only, and allows writes to its session workspace, dedicated Pi profile and approved host paths; other host mounts remain readable, and network access remains available. It is not a boundary against every host read. This mode currently rejects module candidates needing host dependency installation. Chrona does not duplicate Provider web or shell tools; recurring executable work runs in modules.

Pi resource auto-discovery and project trust are disabled. An optional reviewed [resource manifest](docs/zh/provider-runtime.md) adds explicit skills/extensions using Pi's own loading mechanism; native MCP requires an explicit `1.x` pin of `1.3.0` or later. Startup checks command resources before prompting. This is not a full tool manifest or proof that wrappers/extensions are safe: review the executable, extension code and service profile independently. Health checks validate launch configuration/version, not authentication or model success.

### Work progress and Provider questions

Safe progress summaries and usage estimates appear on session/app pages. Blocking Pi `select/confirm/input/editor` requests appear in the shared shell, including when you are viewing a different session, app or Settings. You must answer explicitly; requests are bound to one attempt, expire within its deadline and cannot be reused after interruption/restart. Editor originals are available only from the live controller; originals and free-text answers are not stored in request history or copied into the chat composer. Overlong/sensitive request context fails closed instead of offering approval of hidden details. Chrona's own approvals remain separate.

Stopping an attempt preserves saved work/messages, blocks new Chrona actions and does not automatically retry that attempt. It does not undo external effects or cancel future schedules. Usage is a Provider estimate: the UI distinguishes this attempt from session totals and never invents zero for missing data. See [runtime behavior and limitations](docs/zh/provider-runtime.md).

### QQ

Configure the dedicated official bot variables above and a private secret file, then create an owner binding code:

```bash
chrona qq bind-code --workspace ws_default
```

In a source checkout, replace `chrona` with `bun run packages/cli/src/index.ts`. Send `绑定 <码>` in the bot's private chat. Codes expire after ten minutes by default. QQ delivery restrictions and Chrona notification budgets still apply.

## Backups and safety

**Back up the data directory, not only SQLite.** Stop the server before `chrona backup /absolute/private/path/backup.db`: it creates a consistent DB copy plus `backup.db.tar` containing `platform` (module store and data, conversation attachments), `sessions`, `secrets` and `qq-bot`. Keep the pair together and private; neither file is encrypted. `chrona restore /absolute/private/path/backup.db` restores both while stopped and refuses existing data without `--force`. Current QQ state is included under `platform`, and legacy state under `<dataDir>/qq-bot` is also included. Archive the Provider profile (including `<dataDir>/providers/pi`) and any custom state directories outside the backup roots separately; they are not in that tar. See [operations](docs/zh/operations.md) for recovery caveats.

Local-first is not offline-only: model requests, web tools and QQ can contact external services. Protect backups, review approvals and verify model claims. The Provider environment filters Chrona credentials but retains its own model access. No compatibility with pre-rebuild databases; only Pi is currently implemented, not every future Provider described in design notes.

[Documentation](docs/README.md) · [Goals](docs/zh/steward-goals.md) · [Architecture](docs/zh/architecture.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
