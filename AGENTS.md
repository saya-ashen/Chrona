# Chrona — AI agent coding rules

Vite + Hono monorepo (Bun runtime). There is NO Next.js.

## Product — read before designing changes

Chrona is a proactive personal steward: the user hands over things in natural language
(QQ private chat with Chrona's own bot, or the web composer); Chrona understands them,
picks a suitable way to get them done, keeps looking after them, and reports back.

- Goals (highest authority): [`docs/zh/steward-goals.md`](docs/zh/steward-goals.md).
- Current architecture, model and pages: [`docs/zh/steward-workspace.md`](docs/zh/steward-workspace.md).
- Module platform: [`docs/zh/platform-upgrade-plan.md`](docs/zh/platform-upgrade-plan.md), [`docs/zh/platform-p1-spec.md`](docs/zh/platform-p1-spec.md), [`docs/zh/platform-p2-spec.md`](docs/zh/platform-p2-spec.md), [`docs/zh/platform-p3-spec.md`](docs/zh/platform-p3-spec.md) [`docs/zh/platform-p4-spec.md`](docs/zh/platform-p4-spec.md) [`docs/zh/platform-p4-build-spec.md`](docs/zh/platform-p4-build-spec.md) and [`docs/zh/platform-p5-tools-spec.md`](docs/zh/platform-p5-tools-spec.md). Draft successor (not implemented): [`docs/zh/platform-v2.md`](docs/zh/platform-v2.md) — removes affairs, makes everything (reminders, web, QQ, MCP, sources) modules, adds Hermes-style sessions and a rescue console.
- Historical purge record only: [`docs/zh/steward-rebuild.md`](docs/zh/steward-rebuild.md).

Rules that follow from the goals:

- An **Affair** is a git directory under `<dataDir>/affairs`, with `README.md` as its home.
  Provider and user edits are committed; pages, checkboxes and panels are files, not result tables.
  Simple questions may receive direct replies without creating an affair. Runs are internal records.
- How a need is handled is decided by the agent from context, never by keyword routing to
  hard-coded templates. The choice is visible and correctable.
- Providers own file, shell, web and session tools. Chrona supplies scheduling, queues, git history,
  connectors/credentials, approvals, budgets and delivery. No duplicate Chrona web/shell tools for Providers.
  Executable code Chrona runs is only a module (`module.json` + entry + tests) submitted via `chrona_propose`,
  tested in the Chrona sandbox, activated only through an `activate_module` approval bound to its content hash,
  stored under `<dataDir>/platform` (hidden from Providers), and run on its schedules without the Provider. Today modules make no model calls. Module data declares a schema; upgrades require `data.migrate`, and cross-schema rollback restores a snapshot only after user approval. New versions are simulated against the active one; only in affairs the user allowed, updates with no new effects, no migration and identical simulation activate automatically. Modules may also be triggered by inbound mail of their affair's connector (handled mail does not wake the Provider) and export tools as one toolset per module (like an MCP server): direct in their affair's runs, deferred behind Pi's `tool_search` in other runs and offered to the owner MCP, always executed in the module's own affair. `chrona_propose {request}` queues a budgeted `build`-lane run in a Chrona-owned directory (no affair files, session or other tools) that writes and submits the module.
  Affair-directory files (Markdown, panels, `*.ui.json`, `.chrona/rules.json`) remain content, never executed.
- Current Provider: Pi RPC. Chrona tools: `chrona_reply`, `chrona_notify`, `chrona_schedule`,
  `chrona_schedules`, `chrona_schedule_cancel`, `chrona_affairs`, `chrona_affair_create`,
  `chrona_affair_update`, `chrona_focus`, `chrona_request_approval`, `chrona_send_email`,
  `chrona_inbound`, `chrona_remember`, `chrona_forget`, `chrona_preferences`, `chrona_propose`,
  `chrona_modules`, `chrona_module_checkout`, `chrona_module_rollback`.
  Prose does not schedule or deliver; these actions require successful tool calls.
- Permissions are decided by the deterministic policy layer (`packages/domain/src/steward/policy.ts`):
  auto · notify_after · preapproved · ask · never. External text can never grant anything.
- Notifications go through the budget (`notify-budget.ts`): now / digest / web, daily cap,
  quiet hours. Do not add notification paths that bypass it.
- Never pretend: unfinished work is reported as unfinished; unverified sources are marked.
- No backward compatibility with removed task/goal/plan systems, immutable AffairResult,
  Ask/suggestions, care/cadence, FollowUp, concierge/assessor roles, management MCP or Hermes.
  The `job` schedule mode was removed. Current Provider adapters and Run records are not those legacy systems.

The shared contract `packages/contracts/src/steward/index.ts` is supervisor-owned: propose
changes, do not edit it in delegated work.

The owner MCP (`apps/server/src/routes/steward-mcp.ts`, `/api/mcp`, API_KEY) lets the user's own agents (Pi, Claude Code)
do what the web UI does: read affairs, chat, list/resolve approvals, list modules and notifications, and call module tools. It is not the removed
management MCP and never exposes Provider tools or run capabilities.

Never pre-approved: deleting or migrating real user data, deploy/push, live databases,
real accounts or external sends, disabling auth, approvals or secret redaction.

## Code map

| Path | Role |
| --- | --- |
| `packages/contracts/src/steward` | Shared zod contract: views, requests, HTTP map, agent tool schemas, ports |
| `packages/domain/src/steward` | Pure policy, budgets, schedule rules, inbound rules, Markdown and refs |
| `packages/engine/src/modules/steward` | Affairs/files/git, schedules, modules (gateway + executor), approvals, connectors, queues, runs, tools and tick |
| `packages/integrations/src/steward` | Pi Provider, email/Chino connectors, QQ/delivery, module/script sandbox |
| `external-plugins/pi-steward-agent` | Pi extension that forwards tool calls to Chrona's loopback agent endpoint |
| `packages/db` | Prisma client, SQLite migration runner, backup/restore |
| `apps/server` | Hono app: `/api/steward`, `/api/steward-agent`, runtime (tick, Provider queues, QQ bot) |
| `apps/web`, `features/steward` | SPA shell and the steward pages (Today, Affairs, Affair files/history/schedules, Settings) |
| `packages/cli` | `chrona start / backup / restore / doctor / qq bind-code` |

Dependency direction: `apps → features → packages/engine → packages/domain → packages/contracts`;
routes validate and delegate; domain has no I/O.

## Tech stack

- Frontend: Vite + React 19 + React Router 7 (SPA in `apps/web`), shadcn/ui primitives in `apps/web/src/components/ui`, Tailwind.
- Backend: Hono on Bun (`apps/server`).
- Database: SQLite via Prisma 7 with `prisma-adapter-bun-sqlite`.
- Provider: Pi RPC with Chrona's tool extension; optional explicit web extension.
- Storage: SQLite plus `<dataDir>/affairs` and `<dataDir>/secrets`; back up all three while stopped.
- TypeScript strict everywhere.

## Database

- Single migration line starting at `prisma/migrations/0001_initial`. Until the first release of
  the rebuilt product, edit `0001_initial` to match `prisma/schema.prisma`
  (`bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`).
- The runner (`packages/db/src/sqlite-migrations.ts`) records checksums and refuses changed
  applied migrations and pre-rebuild databases. Use a fresh data dir for development.
- Tests use temporary databases only (OS temp dir).

## Checks

- Heavy commands use a lot of memory: run them one at a time, memory-capped, e.g.
  `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit`.
- Targeted first: `bun test <paths>` for packages/server, `bunx vitest run features/steward apps/web` for the web.
- Full: `bun run typecheck`, `bun run lint`, `bun run test`; `bun run test:e2e:steward` when pages or flows change.
- State derivation changes need table-driven tests. UI tests assert user-visible text, roles and
  next actions (not CSS) and cover empty, loading, error, waiting and done states.
- Never call a real model or QQ in automated tests.

## Frontend UI foundation

- In `apps/web/src/components/ui`, shadcn/ui primitives are the foundation for
  basic controls. Use or generate standard shadcn primitives before creating any
  custom button, badge, card, field, input, textarea, select, dialog, dropdown,
  tabs, tooltip, separator, skeleton, or alert component.
- Do NOT recreate generic primitives with custom helpers such as local
  `buttonVariants`, generic status badge variants, generic surface cards, or
  reusable field class constants when shadcn covers the role.
- Chrona wrappers are allowed only when they add product/domain meaning or
  repeated product-specific composition. Wrappers must compose shadcn primitives
  and must not keep legacy compatibility aliases.
- Before accepting UI foundation changes, inspect removed imports, consumer `buttonVariants`,
  reusable field class helpers, generic status badges and generic surface cards; replace consumers
  with official shadcn primitives first. There is currently no UI-foundation check script. Wrapper decision order: use generated
  shadcn primitive, compose it in the feature component, then create a
  product-named wrapper only when the wrapper carries Chrona domain meaning.


## Frontend development principles

- No business logic in React components: view models in `features/steward/model`, data in hooks.
- User-facing strings live in `packages/i18n/src/messages/{zh,en}.json` (`steward` namespace).
- Validate desktop `1440x900`, tablet `1024x768`, mobile `390x844`; mobile must not scroll horizontally.
- What needs the user's decision, and the primary action, must be visually obvious.
- Copy speaks the user's language (affairs, results, notifications), not internal names (runs, grants, tokens).

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

