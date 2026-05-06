# Chrona — AI agent coding rules

This is a Vite + Hono monorepo. There is NO Next.js — do not generate Next.js
patterns.

## Tech stack

- **Frontend:** Vite + React 19 + React Router 7 (SPA under `apps/web/`)
- **Backend:** Hono API server (Bun runtime under `apps/server/`)
- **Database:** SQLite via Prisma 7 with `prisma-adapter-bun-sqlite` (Bun-only
  runtime)
- **Language:** TypeScript strict everywhere
- **AI runtime:** OpenClaw via structured-result bridge

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

- In `apps/web/`, use `@microsoft/fetch-event-source` for all Server-Sent Events.
- Do NOT hand-roll SSE parsing with `ReadableStream#getReader()`, `TextDecoder`, or manual `event:` / `data:` splitting in React components or hooks.
- Route SSE calls through a shared helper (`apps/web/src/lib/fetch-json-event-source.ts`) so headers, error handling, JSON parsing, and non-stream fallbacks stay consistent.

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

<!-- SPECKIT START -->

For additional context about technologies to be used, project structure, shell
commands, and other important information, read
`specs/001-plan-execution-orchestration/plan.md`

<!-- SPECKIT END -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Chrona** (5730 symbols, 10379 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Chrona/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Chrona/clusters` | All functional areas |
| `gitnexus://repo/Chrona/processes` | All execution flows |
| `gitnexus://repo/Chrona/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
