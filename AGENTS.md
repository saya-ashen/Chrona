# Chrona — AI agent coding rules

This is a Vite + Hono monorepo. There is NO Next.js — do not generate Next.js
patterns.

## Tech stack

- **Frontend:** Vite + React 19 + React Router 7 (SPA under `apps/web/`)
- **Backend:** Hono API server (Bun runtime under `apps/server/`)
- **Database:** SQLite via Prisma 7 with `prisma-adapter-bun-sqlite` (Bun-only
  runtime)
- **Language:** TypeScript strict everywhere
- **AI runtime:** Provider bridge via structured-result contracts

## Database migration policy

- Database schema and migration changes require explicit human approval.
- Before the first public release with persistent user databases, keep a single
  `prisma/migrations/0001_initial` baseline matching `prisma/schema.prisma`.
  Squash development-only migration folders into that baseline before cutting a
  release.
- After a public release ships, never edit, rename, delete, or squash any
  migration included in that release. Treat those files and checksums as a user
  data compatibility contract.
- Create a new migration only when changing schema from one released version to
  the next. Name it with a release-oriented timestamp and purpose, for example
  `20260715000000_add_workspace_preferences`.
- Do not create migrations for temporary development churn on unreleased code.
  Use local reset/db push during development, then regenerate the release
  baseline before release.
- Every release candidate must prove both paths: fresh install from empty SQLite
  and upgrade from the previous released database snapshot.

Recommended workflow:

1. During unreleased development: edit `prisma/schema.prisma`; reset local test
   databases as needed.
2. Before first public release: regenerate `0001_initial/migration.sql` from the
   final schema; delete intermediate migration folders.
3. For later releases: preserve all shipped migrations; add exactly one new
   migration per released schema change set unless a release needs multiple
   independently reversible upgrade steps.
4. Verify with `bun run typecheck`, targeted DB/runtime tests, and release
   smoke (`bun run chrona build <target>` plus `bun run build:smoke`).

## Understand the codebase — read these first

Before exploring source, orient with the curated docs (kept current; faster and
cheaper than reading files):

| To understand…                                                                  | Read                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| System: layers, workflows, data/projection model, architecture rules            | [`docs/en/architecture.md`](docs/en/architecture.md)                     |
| Where code belongs: per-package responsibilities, dependency rules, enforcement | [`docs/en/package-boundaries.md`](docs/en/package-boundaries.md)         |
| Frontend `apps/web`: routing, components, hooks, lib, conventions               | [`docs/en/frontend-structure.md`](docs/en/frontend-structure.md)         |
| Execution internals                                                             | [`docs/en/backend-execution-flow.md`](docs/en/backend-execution-flow.md) |
| Persistence                                                                     | [`docs/en/data-model.md`](docs/en/data-model.md)                         |
| HTTP/MCP surface                                                                | [`docs/en/api-reference.md`](docs/en/api-reference.md)                   |
| Full doc index                                                                  | [`docs/README.md`](docs/README.md)                                       |

For **structural** questions (what calls X, where is X defined, blast radius),
prefer the codegraph / GitNexus MCP tools (see the tool sections below) over
grepping — they are a pre-built AST index. Read source directly only when
editing it or for literal-text searches.

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

## Frontend SSE standard

- In `apps/web/`, use `@microsoft/fetch-event-source` for all Server-Sent
  Events.
- Do NOT hand-roll SSE parsing with `ReadableStream#getReader()`, `TextDecoder`,
  or manual `event:` / `data:` splitting in React components or hooks.
- Route SSE calls through a shared helper
  (`apps/web/src/lib/fetch-json-event-source.ts`) so headers, error handling,
  JSON parsing, and non-stream fallbacks stay consistent.

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
- Before accepting UI foundation changes, run `bun run check:ui-foundation`. If
  it flags removed imports, consumer `buttonVariants`, reusable field class
  helpers, generic status badges, or generic surface cards, replace consumers
  with official shadcn primitives first. Wrapper decision order: use generated
  shadcn primitive, compose it in the feature component, then create a
  product-named wrapper only when the wrapper carries Chrona domain meaning.

## Frontend development principles

- Preserve existing Chrona product behavior unless the spec explicitly changes
  it.
- Do not change backend APIs for visual or interaction polish unless justified
  in the plan.
- Do not put business logic in React components.
- Keep user-facing strings in i18n message files.
- Validate desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
- Mobile views must not horizontally scroll.
- Current task, active node, blocked/review state, and primary action must be
  visually obvious.
- Required checks: `bun run typecheck`, `bun run lint`, `bun run test`.
- Run `bun run test:e2e` when task, schedule, or navigation flows are affected.

## Frontend AI surface ownership

- Keep component names domain-first (`TaskResultPanel`, `ExecutionActivity`,
  `SettingsPage`). Do not rename components by implementation ownership unless
  the ownership is the domain concept.
- Mark AI/product/runtime boundaries with surface metadata, props, wrapper
  names, `data-ui-surface-kind`, and local comments instead of broad directory
  moves or component-name churn.
- Use these surface kinds consistently: `product-authored` for fixed Chrona UI,
  `ai-authored` for validated AI/json-render output, `ai-editable` for
  product-owned regions AI may patch after review, and `runtime-control` for
  execution state/actions owned by Chrona runtime.
- Visual distinction should clarify trust and mutability: AI-authored shows
  source/validation, AI-editable shows pending/review/revert affordance,
  runtime-control emphasizes status and next action, product-authored stays
  default.
- Surface kind is lifecycle metadata, not permanent identity. A region may move
  from product-authored to ai-editable or from ai-authored draft to saved
  artifact without renaming its business component.
- AI-authored surfaces must not contain product authority controls,
  secret-bearing data, permission decisions, or execution lifecycle rules.

## Chrona task workspace / AI auto-edit rules

Chrona task execution monitoring workspace. Core UX goal: user always sees task
state, plan state, current execution state, current node state, and next action.

### Prohibited unattended changes

- Do not change database schema, migrations, auth, run token, MCP bearer,
  provider protocol, execution engine semantics, deployment config, secrets,
  network binding, or external provider contracts without explicit human
  approval.
- Do not hand-roll SSE parsing in `apps/web`; use
  `apps/web/src/lib/fetch-json-event-source.ts`.
- Do not expose secrets, API keys, run tokens, provider request bodies, raw tool
  payloads, or run context in UI, logs, tests, or json-render output.

### UI state logic constraints

- Derive `task.status`, `currentExecution.status`, `savedPlan.status`, and
  execution node status through pure helpers under
  `apps/web/src/components/tasks/workspace/model/`.
- Header badge, command center status, graph node tone, activity tone, and
  action disabled reason should share the same derived state source where
  possible.
- `WaitingForInput` and `WaitingForApproval` must remain distinguishable in UI
  copy and derived metadata.
- `Cancelled`, `Completed`, and `Done` must not be treated as identical unless
  the test name documents the product decision.
- Blocked and failed states must make the next action more prominent than
  secondary metadata.

### json-render rules

- All Chrona json-render specs must validate against the `@chrona/ui-protocol`
  catalog.
- Add or update `packages/ui-protocol` tests when changing catalog components,
  builders, validation, or AI output prompt examples.
- Prefer shared spec builders over local one-off spec objects.
- Fallback specs must be tested with `validateChronaSpec()`.

### Required command matrix

- Type-only/model/state changes: `bun run typecheck` and targeted
  `bun run test`.
- UI primitive/foundation changes: `bun run check:ui-foundation`,
  `bun run typecheck`, and targeted tests.
- json-render catalog/builder/validation changes: `bun run test:bun` and
  `bun run typecheck`.
- Task workspace navigation or execution flow changes: targeted tests plus
  `bun run test:e2e:desktop` when flow affected.
- Package boundary changes: `bun run check:boundaries`.

### Test requirements

- State derivation changes need table-driven tests.
- UI changes must cover touched empty, loading, error, blocked, waiting, and
  completed states.
- Do not test CSS snapshots only; assert user-visible labels, roles, disabled
  reasons, and next actions.

### AI auto-edit boundaries

Safe unattended AI:

- pure helper extraction
- status mapping tests
- small UI polish
- validation tests
- dead field cleanup covered by typecheck

Unsafe without human approval:

- execution engine changes
- DB schema or migrations
- auth, permission, or token changes
- provider protocol changes
- large visual redesign
- deploy, network, or secrets config

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
