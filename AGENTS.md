# Chrona — AI agent coding rules

Vite + Hono monorepo (Bun runtime). There is NO Next.js.

## Product — read before designing changes

Chrona is a personal tool that grows with the user's needs: the user talks in natural language
(QQ private chat with Chrona's own bot, the web composer, or their own agents over the owner MCP);
Chrona gets things done, keeps looking after them, and grows new apps (modules) when a need recurs.

- Goals (highest authority): [`docs/zh/steward-goals.md`](docs/zh/steward-goals.md).
- Current architecture: [`docs/zh/architecture.md`](docs/zh/architecture.md), verified against the implementation.
  See also [security and activation rules](docs/zh/security-simplification.md),
  [module dependency direction](docs/zh/module-dependency-direction.md) and [operations](docs/zh/operations.md).
  Staged designs are [historical records](docs/zh/history/README.md), not current implementation instructions.

Rules that follow from the goals:

- There are no affairs. Chrona's features are **modules (apps)**: `module.json` + entry + tests,
  long-running SDK processes (trusted-local by default; sandboxed in required-isolation) that receive events (schedule, tool, call_result)
  and reach Chrona and other modules only through routed calls
  (`chrona.call`; the callee's `visibility` defines its audience; `uses` is a contract, not runtime admission, except `uses: ["*"]` also reaches `owner` tools; Chrona records the real caller; see security-simplification §3.2). That is the only way modules
  interact (v2-8): a module keeps its files private (`chrona.paths.data`, `chrona.paths.content`) and offers tools; the web module decides how to show
  them (apps register their own json-render pages through `web.page-set`). Only entry modules serve HTTP (`listen`). Built-in modules (e.g. `files`)
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
  (tests with a fake kernel, smoke start, key probe, data migration on a copy), activated automatically when checks pass
  (data migrations and new credentials still ask the user), stored under `<dataDir>/platform` (not exposed through Provider tools; OS hiding requires isolation), and rolled back by hash.
  A newly activated version that fails to start before any event is delivered automatically switches back once to the previous approved version,
  including entry/network modules, without opt-in or a standing grant. Both manifests must be valid and approved; data schema must be unchanged,
  with no migration/restore, group activation or changed/dynamic schedules. The module must still be active at that activation/hash and unverified;
  restored code never automatically rolls back again. Current data and compatible schedules are preserved; work is not replayed.
- Current Provider: Pi RPC. Chrona tools are listed in `chronaToolInputSchemas` (contract).
  Prose does not schedule or deliver; these actions require successful tool calls.
- Permissions are decided by the deterministic policy layer (`packages/domain/src/steward/policy.ts`):
  allow · ask; grants are global or per module. At the same scope, once grants beat standing rules,
  otherwise ask beats allow. Runtime approvals leave once or standing allow grants; module activation and removal
  use the approval id and payload directly, without creating or checking grants.
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
| `packages/engine/src/modules/steward/builtin` | Built-in modules: `files`, `remind`, `notify`, `events`, `mcp`, `qq`, `mind`, `web` (all web pages share the React/json-render renderer built into `pages.js`) |
| `packages/cli` | `chrona start / backup / restore / doctor / qq bind-code` |

Dependency direction: `apps → packages/engine → packages/domain → packages/contracts`;
routes validate and delegate; domain has no I/O.

## Tech stack

- Web page: the built-in `web` module (`builtin/web`: `index.html`, `app.js`, `pages.js`, `style.css`). All system and registered app pages share the React/json-render renderer in `src/pages.tsx`, built by `build.ts`; system specs live in `src/system/` and alone receive the system adapter. `app.js` keeps authentication, requests, routing and the single SSE connection; its own `/api/web` uses routed calls.
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

- The web page is Chinese-first and all pages share the json-render components; keep the static page data-free (data comes from `/api/web` with the user's key).
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

