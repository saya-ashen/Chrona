# Chrona — AI agent coding rules

Vite + Hono monorepo (Bun runtime). There is NO Next.js.

## Product — read before designing changes

Chrona is a personal tool that grows with the user's needs: the user talks in natural language
(QQ private chat with Chrona's own bot, the web composer, or their own agents over the owner MCP);
Chrona gets things done, keeps looking after them, and grows new apps (modules) when a need recurs.

- Goals (highest authority): [`docs/zh/steward-goals.md`](docs/zh/steward-goals.md).
- Architecture: [`docs/zh/platform-v2.md`](docs/zh/platform-v2.md) and its parts
  [v2-1 runtime](docs/zh/platform-v2-1-runtime.md), [v2-2 sessions/content/files](docs/zh/platform-v2-2-sessions-content.md),
  [v2-3 remind/model](docs/zh/platform-v2-3-remind-model.md), [v2-4 entries/rescue](docs/zh/platform-v2-4-entries-rescue.md),
  [v2-5 extensions](docs/zh/platform-v2-5-extensions.md), [v2-6 packages](docs/zh/platform-v2-6-packages.md),
  [v2-8 calls only](docs/zh/platform-v2-8-calls-only.md) (modules interact only through routed calls; supersedes content areas, connectors and the web/MCP owner API), [v2-9](docs/zh/platform-v2-9-owner-api.md) (no owner HTTP API: settings, schedules and Provider questions are system interfaces).
  Implemented: v2-1, v2-2 (built-ins, `files`), v2-3 (`remind`, module `model`), v2-4 (owner API, `listen`, rescue console, `chrona admin`, built-in `mcp`, `qq` and a simple `web`), v2-6 (module dependencies), v2-5 §3 (routed calls between modules, built-in `notify`; see v2-5 §9) and v2-7 (system modules `chat` and `approvals`; conversation replies pushed to the entry module, [v2-7](docs/zh/platform-v2-7-system-modules.md)) and v2-8 (`uses: ["*"]`, system modules `modules` and `chat` with sessions, `chat.ask` and `chat.today`, multi-path `listen`; MCP and the web page on routed calls; no content areas, connectors or `owner` capability) and v2-9 (system modules `settings`, `schedules`, `chat.runs/answer/cancel`; the owner HTTP API is gone) and v2-10 ([AI calls](docs/zh/platform-v2-10-ai-calls.md): `ai.complete`, `ai.wake`, `secrets.get`; the module channel carries only `call`/`callStatus`) and v2-11 ([Provider module](docs/zh/platform-v2-11-provider-module.md): `ai` became the system module `provider` — `provider.complete`, `provider.wake` — and the Provider adapter also serves completions; `ai.*` names stay as aliases) and v2-12 ([Provider browser](docs/zh/platform-v2-12-provider-browser.md): `browser_screenshot` for the Provider and `node_modules/chrona/preview.ts` in builds; the browser is found on the host or acquired once) and v2-13 ([module tools and build sessions](docs/zh/platform-v2-13-modules-tools.md): `modules.list/check/checkout/propose/rollback/build` replace `chrona_propose` and friends; a build is its own conversation (source `build`) that reports back; `chat.transcript`; callers set `timeoutSeconds`) and v2-14 ([contributions and events](docs/zh/platform-v2-14-contributions-events.md): the kernel keeps only the trust root; manifest `contributes` read by the named module via `modules.contributions`; tools with `modules` visibility are callable by any module; built-in `events` with `chrona.emit`) and v2-15 ([multi-module builds](docs/zh/platform-v2-15-multi-module-builds.md): `modules.build({ modules })`, one group approval via `modules.request-group`, activated together in one generation) and v2-16 ([module secrets and requests](docs/zh/platform-v2-16-module-secrets-requests.md): any module may declare `secrets`, saved by the user in Settings or `chrona admin secret-set`; `approvals.request` asks the user to decide, approved once, the decision returned as a `call_result`) and v2-17 ([approval levels and model tiers](docs/zh/platform-v2-17-approval-levels-model-tiers.md): kernel-computed green/yellow/red levels, green module updates activate after an AI review that can only escalate, red approved on the page only, weekly habit suggestions; model tiers `{ model, thinking }` with per-module daily caps; `modules.permissions`) and v2-18 ([activity](docs/zh/platform-v2-18-activity.md): system module `activity`, `activity.list` words the user-facing audit trail for the page and MCP; credential changes are audited by name) and v2-19 ([reflection](docs/zh/platform-v2-19-reflection.md): when an app goes live or fails beyond recovery, the kernel queues a reflection conversation (source `reflect`) that sees kernel facts and may only call `reflection.suggest`, which starts a build at once; results are levelled as usual; `settings.reflection.enabled`) and v2-20 ([system apps](docs/zh/platform-v2-20-system-apps.md): system modules carry a description and the session source they work in; `modules.system` shows them read-only on the page and MCP, with their work conversations; reflection activity links to its process) and v2-21 ([memory](docs/zh/platform-v2-21-memory.md): system module `memory` forwards retain/recall/forget to the provider module chosen in `settings.memory` (kernel-only tools, `contributes.memory`); conversations auto-recall at their first run and auto-retain every four user messages; optional built-in `memory-local` (mnemopi) is registered and downloaded only when chosen; manifest `limits.virtualMemoryMb` raises one module's address-space cap) and v2-23 ([app pages](docs/zh/platform-v2-23-app-pages.md): manifest `settings` declare user-editable values stored in `moduleSettings` and delivered as params; `modules.settings-set` and `modules.overview`; system modules declare their own settings; the page groups everything per app in tabs) and v2-24 ([timers](docs/zh/platform-v2-24-timers.md): any module may arrange its own timers with `schedules.create/cancel/mine`, delivered back to its `on("schedule")` with the payload; the calendar app is built on it); v2-26 ([mind](docs/zh/platform-v2-26-mind.md): built-in `mind` senses Chrona's records and wakes the Provider (`provider.wake`) by rules or an optional System One decision model; `modules.disable/enable`, which the Provider only requests as a yellow once-only approval, and `modules.remove`, always a red page-only approval that backs up data and code first); v2-28 steps 1–3 ([mind agenda](docs/zh/platform-v2-28-mind-agenda.md): the mind keeps the user's open matters (`mind.agenda/note/report/decisions`) and a decision log, senses deadline bands and revisit times, and runs it wakes get the kernel's `MIND_PROTOCOL`); v2-29 ([content references](docs/zh/platform-v2-29-content-refs.md): `content.read` reads approved content references with base64 and sha256, replies attach `content/<module>/<path>`; reference indexes and Provider version lists are trimmed, with actionable bridge truncation notices; implemented, not deployed); v2-25 steps 1–2 ([interface contracts](docs/zh/platform-v2-25-contracts.md): every module-callable system tool declares its output and the router checks it; builds get a generated `node_modules/chrona/calls.d.ts` and the entry is type-checked before tests; step 3, app tool outputs, is planned); v2-30 §2–§3 ([secrets for tools](docs/zh/platform-v2-30-secrets-for-tools.md): credentials stay in the kernel store; `chrona.exec` hands them to one child process as env vars or temporary 0600 files and redacts them from its output; no keyring; no per-module secret cap; deployed in 0.8.34; §4 OAuth broker: `secrets.authorize` (PKCE link, kernel route `/oauth/callback` outside API-key auth) and `secrets.token` (kernel-refreshed access tokens, error `reauthorize`), `chrona.exec` `tokenEnv`; deployed in 0.8.35); v2-16 §2.1 (credential fields declared in the manifest, the page saves field by field and removes single fields; deployed in 0.8.35, merged into the live custom `web`); a finished build wakes the conversation that asked for it once with the result (at most 5 in a row before the user speaks; deployed in 0.8.36); the rest of v2-5 is a draft. The React web app was removed; the page is the built-in `web` module.

Rules that follow from the goals:

- There are no affairs. Chrona's features are **modules (apps)**: `module.json` + entry + tests,
  long-running sandboxed SDK processes that receive events (schedule, tool, call_result)
  and reach Chrona and other modules only through routed calls
  (`chrona.call`; the callee's `visibility` defines its audience; `uses` is a contract, not runtime admission, except `uses: ["*"]` also reaches `owner` tools; Chrona records the real caller; see security-simplification §3.2). That is the only way modules
  interact (v2-8): a module keeps its files private (`chrona.paths.data`, `chrona.paths.content`) and offers tools; the web module decides how to show
  them (an app that needs its own page gets it by changing the web module). Only entry modules serve HTTP (`listen`). Built-in modules (e.g. `files`)
  ship with Chrona and activate without approval. When the active version is user/AI-modified, releases skip that built-in and never create ordinary replacement approvals. Merge features into the active custom version; discarding customization requires an explicit recovery rollback (e.g. `chrona admin rollback web builtin` to a saved approved built-in), not an update approval.
- Manifest `effects` only lists `network`; routed interfaces belong in `uses` (`provider.complete` also needs `model`). Manifest `channel` and `dynamicSchedules` are removed; conversation entry comes from `session.entryModuleId`, timers use `schedules.*`.
- Conversations are **sessions** keyed by their entry (`qq:dm`, `web:<id>`, `rescue`); entry modules reach them through the in-process system
  module `chat` (`chat.send`), and replies are pushed to the session's entry module (`<entry>.reply`), never polled; `wake` and module wakes run in
  fresh sessions and report back. Long-term state lives in apps and preferences, not in sessions.
- How a need is handled is decided by the agent from context, never by keyword routing to
  hard-coded templates. The choice is visible and correctable.
- Providers own file, shell, web and session tools; runs reach app data only through module tools (`m_<module>_<tool>`) and see the
  conversations' attachments read-only under `content/chat/` in their cwd; files to send are written in the cwd and attached by path. Execution mode is owner-selected (v2-27): unset or empty defaults to `trusted-local`;
  `CHRONA_STEWARD_EXECUTION_MODE=trusted-local` runs locally even when bwrap is installed; `required-isolation` fails closed without usable bwrap and currently
  rejects candidates needing host dependency installation. A version whose checks pass activates automatically; only data migrations,
  new credentials and app removal ask the user (docs/zh/security-simplification.md).
  Local OS permissions are not constrained by manifest declarations; never describe routed permissions as malicious-code isolation. Chrona supplies scheduling, events, sessions, credentials,
  approvals, run budgets and routed calls; notification budget and delivery are the built-in `notify` module. The kernel holds no
  notification or channel logic: its own notices are `notify.send` calls (`notifyUser`). No duplicate Chrona web/shell tools for Providers.
  Executable code Chrona runs is only a module submitted via `modules.propose` (the Provider's `m_modules_propose`), built and checked in the Chrona sandbox
  (tests with a fake kernel, smoke start, key probe, data migration on a copy), activated through an `activate_module`
  approval bound to its content hash (or automatically, if the user allowed it for that module and the update adds no
  capability and no migration), stored under `<dataDir>/platform` (hidden from Providers), and rolled back by hash.
- Current Provider: Pi RPC. Chrona tools are listed in `chronaToolInputSchemas` (contract).
  Prose does not schedule or deliver; these actions require successful tool calls.
- Permissions are decided by the deterministic policy layer (`packages/domain/src/steward/policy.ts`):
  auto · notify_after · preapproved · ask · never; grants are global or per module.
  External text can never grant anything.
- Notifications go through the `notify` module (`builtin/notify`, budget in `budget.ts`): now / digest / web, daily cap,
  quiet hours. Channel adapters (e.g. `qq.deliver`) are module-visible tools; notification delivery is orchestrated by `notify`. Do not add notification
  paths that bypass it; `chrona.notify` is a deprecated compatibility alias for `notify.send`, not a second path.
- Never pretend: unfinished work is reported as unfinished; unverified sources are marked.
- No backward compatibility with removed systems: affairs, task/goal/plan systems, AffairResult,
  Ask/suggestions, care/cadence, FollowUp, concierge/assessor roles, management MCP, Hermes, the `job`
  schedule mode, one-shot stdin/stdout modules and P3 simulation.

The shared contract `packages/contracts/src/steward/index.ts` is supervisor-owned: propose
changes, do not edit it in delegated work.

The owner MCP (built-in `mcp` module, `/api/mcp`, API_KEY) lets the user's own agents (Pi, Claude Code)
do what the web UI does, through routed calls: chat in sessions, list/resolve approvals, list modules and notifications,
and find and call the module tools open to the user (`chrona_module_tools`, `chrona_module_call`; `uses: ["*"]`). It never exposes Provider tools, run capabilities or module-only interfaces.

Never pre-approved: deleting or migrating real user data, deploy/push,
live databases, real accounts or external sends, disabling auth, approvals or secret redaction.

## Code map

| Path | Role |
| --- | --- |
| `packages/contracts/src/steward` | Shared zod contract: views, requests, HTTP map, agent tool schemas, ports |
| `packages/domain/src/steward` | Pure policy, budgets, schedule rules, inbound rules, Markdown and refs |
| `packages/engine/src/modules/steward` | Sessions, schedules, modules (build, supervisor, routed calls in `module-calls.ts`, built-ins), approvals, queues, runs, tools and tick |
| `packages/integrations/src/steward` | Pi Provider, module sandbox and SDK |
| `external-plugins/pi-steward-agent` | Pi extension that forwards tool calls to Chrona's loopback agent endpoint |
| `packages/db` | Prisma client, SQLite migration runner, backup/restore |
| `apps/server` | Hono app: `/api/steward-agent` (Provider tool bridge), `/health`, the `listen` proxy (API key checked for `/api/*`), rescue console, runtime (tick, Provider queues) |
| `packages/engine/src/modules/steward/builtin` | Built-in modules: `files`, `remind`, `notify`, `events`, `mcp`, `qq`, `mind`, `web` (the web page: plain HTML + JS, no build) |
| `packages/cli` | `chrona start / backup / restore / doctor / qq bind-code` |

Dependency direction: `apps → packages/engine → packages/domain → packages/contracts`;
routes validate and delegate; domain has no I/O.

## Tech stack

- Web page: the built-in `web` module (`builtin/web`: `index.html`, `app.js`, `style.css`), plain DOM against its own `/api/web` (routed calls); no frontend build or dependencies.
- Backend: Hono on Bun (`apps/server`).
- Database: SQLite via Prisma 7 with `prisma-adapter-bun-sqlite`.
- Provider: Pi RPC with Chrona's tool extension; optional explicit web extension.
- Storage: SQLite plus `<dataDir>/platform`, `<dataDir>/sessions` and `<dataDir>/secrets`; back up all of them while stopped (`chrona backup`).
- TypeScript strict everywhere.

## Database

- Single migration line starting at `prisma/migrations/0001_initial`. Until the first release of
  the rebuilt product, edit `0001_initial` to match `prisma/schema.prisma`
  (`bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`).
- The runner (`packages/db/src/sqlite-migrations.ts`) records checksums and refuses changed
  applied migrations and pre-rebuild databases. Use a fresh data dir for development.
- Tests use temporary databases only (OS temp dir).

## Owner bounded builds

`modules.build-owner` / MCP `chrona_build` starts only an explicitly authorized single-module build, with a single-use request key and exact Provider/model, timeout and submission cap. Never resume or retry it automatically. `chrona admin build <request-file>` is the stopped-service recovery path; it uses the same checks and approvals, without a normal tick or built-in upgrades. See [owner bounded builds](docs/zh/owner-bounded-builds.md).

## Checks

- Heavy commands use a lot of memory: run them one at a time, memory-capped, e.g.
  `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit`.
- Targeted first: `bun test <paths>`. Full: `bun run typecheck`, `bun run lint`, `bun run test:bun`, `bun run test:api` (all server tests); check page changes in a real browser.
- State derivation changes need table-driven tests. UI tests assert user-visible text, roles and
  next actions (not CSS) and cover empty, loading, error, waiting and done states.
- Never call a real model or QQ in automated tests.

## Web page principles

- The web page is Chinese-first plain DOM; keep the static page data-free (data comes from `/api/web` with the user's key).
- Validate desktop `1440x900`, tablet `1024x768`, mobile `390x844`; mobile must not scroll horizontally.
- What needs the user's decision, and the primary action, must be visually obvious.
- Copy speaks the user's language (apps, files, conversations, notifications), not internal names (runs, grants, tokens).

> Note for delegated workers (Pi): the context-mode, memory and CodeGraph sections below describe
> MCP tools available only to some interactive agents. If you do not have them, use your native
> read/grep/find/bash tools and keep output small.

# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding.
One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via
`context-mode_ctx_execute(language, code)`, `console.log()` only the answer. Do
NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure
JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`).
`try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED

Shell `curl`/`wget` intercepted and blocked. Do NOT retry. Use:
`context-mode_ctx_fetch_and_index(url, source)` or
`context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED

`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` —
intercepted. Do NOT retry. Use: `context-mode_ctx_execute(language, code)` —
only stdout enters context

### Direct web fetching — BLOCKED

Use: `context-mode_ctx_fetch_and_index(url, source)` then
`context-mode_ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)

Shell ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`,
`pip install`. Otherwise: `context-mode_ctx_batch_execute(commands, queries)` or
`context-mode_ctx_execute(language: "shell", code: "...")`

### File reading (for analysis)

Reading to **edit** → reading correct. Reading to **analyze/explore/summarize**
→ `context-mode_ctx_execute_file(path, language, code)`.

### grep / search (large results)

Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

0. **MEMORY**: `context-mode_ctx_search(sort: "timeline")` — after resume, check
   prior context before asking user.
1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — runs all
   commands, auto-indexes, returns search. ONE call replaces 30+. Each command:
   `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — all
   questions as array, ONE call (default relevance mode).
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` |
   `context-mode_ctx_execute_file(path, language, code)` — sandbox, only stdout
   enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then
   `context-mode_ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — store in FTS5 for
   later search.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N`
(1-8):

- `context-mode_ctx_batch_execute(commands: [3+ network commands], concurrency: 5)`
  — gh, curl, dig, docker inspect, multi-region cloud queries
- `context-mode_ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)`
  — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep
concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state
(ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Terse like caveman. Technical substance exact. Only fluff die. Drop: articles,
filler (just/really/basically), pleasantries, hedging. Fragments OK. Short
synonyms. Code unchanged. Pattern: [thing] [action] [reason]. [next step].
Auto-expand for: security warnings, irreversible actions, user confusion. Write
artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `search(source: "label")`.


## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them
as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking
the user:

| Need                    | Command                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| What did we decide?     | `context-mode_ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What constraints exist? | `context-mode_ctx_search(queries: ["constraint"], source: "constraint")`               |

DO NOT ask "what were we working on?" — SEARCH FIRST. If search returns 0
results, proceed as a fresh session.

## ctx commands

| Command       | Action                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| `ctx stats`   | Call `stats` MCP tool, display full output verbatim                           |
| `ctx doctor`  | Call `doctor` MCP tool, run returned shell command, display as checklist      |
| `ctx upgrade` | Call `upgrade` MCP tool, run returned shell command, display as checklist     |
| `ctx purge`   | Call `purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use
`ctx purge` to start fresh.

<!-- CODEGRAPH_START -->

## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured.
CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and
file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break,
where is X defined, what is X's signature. Use native grep/read only for
**literal text** queries (string contents, comments, log messages) or after you
already have a specific file open.

| Question                                      | Tool                |
| --------------------------------------------- | ------------------- |
| "Where is X defined?" / "Find symbol named X" | `codegraph_search`  |
| "What calls function Y?"                      | `codegraph_callers` |
| "What does Y call?"                           | `codegraph_callees` |
| "What would break if I changed Z?"            | `codegraph_impact`  |
| "Show me Y's signature / source / docstring"  | `codegraph_node`    |
| "Give me focused context for a task/area"     | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/"                | `codegraph_files`   |
| "Is the index healthy?"                       | `codegraph_status`  |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" /
  architecture / trace questions, answer with 2-3 codegraph calls:
  `codegraph_context` first, then ONE `codegraph_explore` for the source of the
  symbols it surfaces. Codegraph IS the pre-built index, so spawning a separate
  file-reading sub-task/agent — or running a grep + read loop — repeats work
  codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify
  them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is
  faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want
  context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore`
  call returns several symbols' source grouped in a single capped call, while
  each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query
  immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: _"I notice this project
doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build
the index?"_

<!-- CODEGRAPH_END -->

