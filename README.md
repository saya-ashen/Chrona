English | [中文](README.zh.md)

# Chrona

A local-first personal steward: talk in the web composer or QQ private chat, and work together on persistent affairs. Simple questions can receive a direct reply without creating an affair.

## How it works

Each **affair is a git directory** under `<dataDir>/affairs`, with `README.md` as its home page. The Provider (currently Pi) organizes files, edits pages, researches and uses its own tools. Chrona supplies persistent schedules, foreground/background queues, git history, connector credentials, approvals and delivery. Model prose alone does not schedule work or send messages: those actions use Chrona tools.

- **Today**: approvals, schedules and recently changed pages.
- **Affairs**: summaries and activity.
- **Affair**: file tree, Markdown editor, checkboxes, uploads, authenticated downloads, local image/audio/video previews, panels, schedules and revision history with revert.
- **Settings**: notifications, permissions, preferences, connectors and Provider/runtime health.

Schedules can wake the Provider, send a fixed reminder without a model call, or run a deterministic job. Proactive notifications pass through the notification budget, including quiet hours and digests. External content cannot grant permission. Email sends through Chrona require approval.

## Quick start

Requires **Bun ≥ 1.3.11**, **git**, and a pinned **Pi CLI** with model access configured in a dedicated service profile. The [Provider adapter](packages/integrations/src/steward/pi-provider.ts) uses Pi RPC; its default version pin is **0.85.0**, with **1.3.0** available by explicit selection. Full backups additionally require GNU-compatible `tar`.

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

The Pi path above is a placeholder, not an installation command. Prepare model access separately with `PI_CODING_AGENT_DIR="$CHRONA_STEWARD_PI_AGENT_DIR"` and the selected executable. Chrona does not copy personal authentication or create the profile. Use an absolute canonical profile path, outside the affair tree, private to the service user (Unix mode `0700`). Missing configuration or a version mismatch leaves the Provider unavailable; there is no PATH/profile fallback. See [operations](docs/zh/operations.md#确认-agent-真正可用) before upgrading an existing installation.

Open `http://localhost:3100`; the API defaults to `http://127.0.0.1:3101`. Startup applies migrations and creates `ws_default`. Set both storage variables explicitly: the source server's database default is `file:./prisma/dev.db`, independent of `CHRONA_DATA_DIR`. Vite development binds all interfaces; use a trusted development network, not public exposure.

The packaged application uses `chrona start --no-open`. For source-only API startup use `bun run server:start`.

## Configuration

Set these in the server environment, then restart:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | SQLite URL; source default `file:./prisma/dev.db` |
| `CHRONA_DATA_DIR` | Affairs and secrets root; set explicitly for server and CLI |
| `HOST`, `PORT` | API bind; defaults `127.0.0.1`, `3101` |
| `API_KEY` | API authentication; required before non-loopback exposure |
| `ALLOWED_ORIGINS` | Additional permitted browser origins, comma-separated |
| `CHRONA_STEWARD_AGENT` | `pi` enables the Provider; otherwise disabled |
| `CHRONA_STEWARD_PI_COMMAND` | Required absolute, reviewed service executable; no PATH fallback or shell arguments |
| `CHRONA_STEWARD_PI_VERSION` | Exact version pin; default `0.85.0`, also supports explicit `1.3.0` |
| `CHRONA_STEWARD_PI_AGENT_DIR` | Existing private canonical profile; default `<dataDir>/providers/pi`; never copied automatically |
| `CHRONA_STEWARD_PI_RESOURCES_FILE` | Optional private, canonical JSON manifest of reviewed explicit skill/extension entry files and extra tool names; no installation or ambient discovery |
| `CHRONA_STEWARD_PI_MODEL` | Optional Pi model selection |
| `CHRONA_STEWARD_PI_WEB_EXTENSION` | Optional explicit web extension path |
| `CHRONA_STEWARD_SANDBOX_BWRAP` | bubblewrap executable for Provider isolation and schedule jobs |
| `CHRONA_STEWARD_TICK_SECONDS` | Background tick interval; default `30` seconds |
| `CHRONA_CHINO_DASHBOARD_URL` | Chino service-health source URL |
| `CHRONA_PUBLIC_URL` | Public HTTP(S) origin for notification links |
| `CHRONA_QQ_APP_ID` | Dedicated QQ bot application ID |
| `CHRONA_QQ_SECRET_FILE` | Private app-secret file owned by the server user |
| `CHRONA_QQ_STATE_DIR` | QQ state; fallback `<dataDir>/qq-bot/<appId>` |

Without bubblewrap, Pi's bash tool is disabled; its file tools and explicitly configured web tools remain available. With bubblewrap, the Provider has read-only host mounts and scoped writable affair/session directories plus its dedicated Pi profile, with network access. This is not a confidentiality boundary against all host reads. Chrona does not duplicate Provider web or shell tools. Its separate schedule-job sandbox needs a successful isolation probe; it currently assumes `/nix/store` and never falls back to host execution.

Pi resource auto-discovery and project trust are disabled. An optional reviewed [resource manifest](docs/zh/provider-runtime.md) adds explicit skills/extensions using Pi's own loading mechanism; native MCP requires an explicit `1.3.0` pin. Startup checks command resources before prompting. This is not a full tool manifest or proof that wrappers/extensions are safe: review the executable, extension code and service profile independently. Health checks validate launch configuration/version, not authentication or model success.

### Work progress and Provider questions

Safe progress summaries and usage estimates appear on Today/affair pages. Blocking Pi `select/confirm/input/editor` requests appear in the shared shell, including when you are viewing a different affair or Settings. You must answer explicitly; requests are bound to one attempt, expire within its deadline and cannot be reused after interruption/restart. Editor originals are available only from the live controller; originals and free-text answers are not stored in request history or copied into the chat composer. Overlong/sensitive request context fails closed instead of offering approval of hidden details. Chrona's own approvals remain separate.

Stopping an attempt preserves saved work/messages, blocks new Chrona actions and does not automatically retry that attempt. It does not undo external effects or cancel future schedules. Usage is a Provider estimate: the UI distinguishes this attempt from session totals and never invents zero for missing data. See [runtime behavior and limitations](docs/zh/provider-runtime.md).

### Email connector

In **Settings → Connectors**, add an email address, IMAP host/port (TLS, default 993), folders (default INBOX), password/app password and an existing or new affair. Optional SMTP host/port enables sending (default 465; TLS required). The connector synchronizes mail read-only, deduplicates inbound events and stores material in the affair. Chrona holds credentials under `<dataDir>/secrets`; they are not supplied as Provider context. SMTP sends require user approval. Testing a real connection contacts the mail server; automatic tests use fakes.

### QQ

Configure the dedicated official bot variables above and a private secret file, then create an owner binding code:

```bash
chrona qq bind-code --workspace ws_default
```

In a source checkout, replace `chrona` with `bun run packages/cli/src/index.ts`. Send `绑定 <码>` in the bot's private chat. Codes expire after ten minutes by default. QQ delivery restrictions and Chrona notification budgets still apply.

## Backups and safety

**Back up the data directory, not only SQLite.** Stop the server before `chrona backup /absolute/private/path/backup.db`: it creates a consistent DB copy plus `backup.db.tar` containing `affairs` (including git history) and `secrets`. Keep the pair together and private; neither file is encrypted. `chrona restore /absolute/private/path/backup.db` restores both while stopped and refuses existing data without `--force`. Archive QQ state and the Provider profile (including `<dataDir>/providers/pi`) separately; neither is in that tar. See [operations](docs/zh/operations.md) for recovery caveats.

Local-first is not offline-only: model requests, web tools, QQ and email can contact external services. Protect backups, review approvals and verify model claims. The Provider environment filters Chrona credentials but retains its own model access. No compatibility with pre-rebuild databases; only Pi is currently implemented, not every future Provider described in design notes.

[Documentation](docs/README.md) · [Goals](docs/zh/steward-goals.md) · [Workspace model](docs/zh/steward-workspace.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
