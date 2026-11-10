# Chrona — AI agent coding rules

Vite + Hono monorepo (Bun runtime). There is NO Next.js.

## Product — read before designing changes

Chrona is a personal tool that grows with the user's needs: the user talks in natural language
(QQ private chat with Chrona's own bot or the web composer; the ordinary optional owner MCP endpoint is available after checked installation);
Chrona gets things done, keeps looking after them, and grows new apps (modules) when a need recurs.

- Goals (highest authority): [`docs/zh/steward-goals.md`](docs/zh/steward-goals.md).
- Current permanent-contraction source inventory: [boundary contract](docs/zh/kernel-permanent-boundary-contract.md) and [implementation / pending gates](docs/zh/kernel-permanent-boundary-implementation.md). The boundary is **UNFROZEN**; the main coordinator records final gate commands, revision, counts and evidence. General architecture: [`docs/zh/architecture.md`](docs/zh/architecture.md).
  See also [security and activation rules](docs/zh/security-simplification.md),
  [module dependency direction](docs/zh/module-dependency-direction.md) and [operations](docs/zh/operations.md).
  Completed staged designs and [historical records](docs/zh/history/README.md) do not establish current capabilities.
- Current priority is the full permanent kernel contraction, including callers, resources and documentation. Historical Workbench integration/acceptance records do not establish current availability: Remind is the only whole application paused with all source and dependency material retained; Mind is restored as an ordinary optional application (not preinstalled), with isolated acceptance completed and local deployment recorded in docs/zh/mind-implementation.md (automatic checks and notifications remain disabled); Editor is retired and removed (docs/zh/editor-retirement.md); Coding is restored as a headless ordinary optional application with a separate coding-web client; isolated acceptance is recorded in docs/zh/coding-peer-clients-implementation.md; memory-local remains an ordinary optional app with scheduled consolidation paused. Do not delete retained sources or restore removed kernel APIs to keep these callers running. The external Neovim client's removed content.read integration remains outside the approved scope.
- There are only kernel and applications. Agent is the sole immutable builtin application and Pi the sole builtin Provider. Web/Notify/QQ/Author are ordinary default preinstalled apps; preinstallation grants no authority. runtime-callback/workspace-local are private kernel hosts, excluded from public discovery. Preserve one Run queue, actual caller identity, exact authorization, budgets, leases, cancellation, unknown-stop capacity, sensitive-data handling and bootstrap persistence. Remote general module hosting is deferred. Use fresh temporary data for this contraction; no existing-user-data migration or old-interface compatibility. This architecture paragraph grants no model, network, real-account, production or deployment acceptance.

Rules that follow from the goals:

- There are no affairs. Features are applications: `module.json` + entry + offline tests, using SDK events and routed `chrona.call`. Applications keep their data/content private and expose bounded tools. `visibility` defines the audience; `uses` is a declaration contract, except the current approved `uses: ["*"]` identity may reach owner tools. Privileged handlers must still validate the real current caller. Never accept caller identity, host cwd/session paths or Run tokens from module arguments. Only entry applications serve HTTP (`listen`); apps register pages through `web.page-set` and may register trusted browser components through Web's `component-set/component-remove` tools. These components run directly in the Web page; there is no browser sandbox or security isolation.
- Agent is an independent SDK process that owns Pi adapters, operation receipts and private model policy (`agent.configure`); the kernel enforces Run authorization and hard caps. Its launcher binds only the current approved builtin Agent identity. Dynamic Agent candidate submission, activation, update, rollback, removal or installation is forbidden; Agent changes ship with Chrona. Web/Notify have ordinary checked lifecycle and deletion semantics, retaining dependency, entry, approval, backup, actual-stop and data-loss guards. Initialization does not overwrite existing choices or automatically reinstall removed apps. There is no grandfathered MCP removal exception or customizable-builtin Web/Notify category.
- The current public kernel namespaces are exactly `modules`, `approvals`, `settings`, `secrets`, `activity`. `modules` exposes exactly `list/tools/reference/diagnostics/health/admit-candidates/source/submit/candidate-check/rollback/disable/enable/remove`. Agent tools belong to the Agent application. Private hosts, reserved-name enums and old exported schemas do not register public services. `modules.tools` discovers reachable contracts; application tools carry `moduleId/hash/contractHash`, and callback pinning uses `expectedTarget: {moduleId, contractHash}`. `modules.reference` filters paused applications and registers its index/detail output schema. Reading metadata grants no authority; a target's `outputSchema: null` means undeclared.
- Manifest `effects` lists only `network`; routed declarations belong in `uses` (`agent.complete` also requires `model: {tier,maxCalls,maxOutputTokens}`). Manifest `settings`, `triggers`, `dynamicSchedules`, `channel`, `contributes`, `healthCheck` and `builds` are removed. `params` contains versioned literal values. Applications own mutable configuration, preferences, schedules and business policies; there is no public `schedules.*` or `projects.*` kernel API. The SDK exposes no `chrona.model`, `chrona.notify` or `chrona.wakeProvider` helpers and excludes schedule from public `Trigger`; the private wire schedule delivery/drain remains wired. `activity.runtime` has no `dueSchedules` field.
- Application settings remain app-owned. Global Web Settings edits kernel governance only and indexes explicitly registered `purpose: "settings"` pages; application detail and page navigation open that same page. Forms validate and save through their own application's tools, retaining real caller authorization; Web does not infer settings from tool names. See docs/zh/application-settings.md.
- Entry applications own conversation journals, titles, switching, prompts, waiting and delivery receipts in private data. They call Agent context/run/get/stream/write/respond/interrupt with their real identity; tool selection remains restricted to the original caller's admitted catalog. The kernel retains the single Run queue, budgets, authorization and stop evidence. `history`, `chat`, `provider`, `executions`, `content` and `memory` are not public kernel targets. Memory-provider discovery, opt-out, redaction and save watermarks belong to applications. An unknown stop still occupies execution capacity.
- How a need is handled is decided by the agent from context, never by keyword routing to
  hard-coded templates. The choice is visible and correctable.
- Providers own file, shell, web and session tools; runs reach app data through routed module tools (`m_<module>_<tool>`) and the admitted caller's bounded content read. There is no global `content.read`, `history.file` or `chat/` attachment namespace. Cross-app files use the owning app's declared tool; captured Run outputs go to the real receiving app's content. Do not add duplicate Chrona web/shell tools for Providers.
- Execution uses trusted local processes: unset/empty or `CHRONA_STEWARD_EXECUTION_MODE=trusted-local`. The retired `required-isolation` mode and `CHRONA_STEWARD_SANDBOX_BWRAP` setting explicitly fail configuration validation. Local OS permissions are not constrained by Manifest declarations; routed permissions are not malicious-code isolation. Candidate material is stored under `<dataDir>/platform`. Runtime declarations select interpreters and optional checks; host system programs and browsers must already be installed.
- The ordinary Author application exposes `prepare/write/read/list/import/export/stage/source/submit/receipt`. The current Agent develops and builds in its task workspace; Author imports explicit source and binary selections, exports exact version materials and never invokes a compiler. With `chrona-material.json`, Git retains source/build inputs and artifact digests; immutable artifact storage retains the runtime bytes. `.gitignore` belongs to source and does not choose the release artifacts. Restore/check/install paths verify exact artifact bytes and executable modes; build notes are not independent reproducibility proof. Explicit object entries select a module-relative executable or installed host interpreter with literal arguments, while legacy script entries remain supported. See docs/zh/author-version-materials.md for implementation and acceptance status. `prepare` returns `kind: "material-preparation"`, a pure admission draft and guidance for the current conversation Agent to write source and submit through Author. It starts no separate model or Run. Owner admission binds an approved submitter, the complete target set and exact active bases; `modules.source/submit/candidate-check` operate only on that admission and fixed receipts. Admission does not authorize model execution. No public build/propose/install/distribution/group API or automatic model authoring is supported. Candidate checks validate supplied material, with offline author tests and startup/SDK checks; existing-data migration, restore, changed credentials and deletion retain their approval guards. Do not infer approval or activation from a pending receipt.
- `modules.health/diagnostics` expose observed runtime and bounded fault evidence, never application self-reports or active business probes. There is no `modules.report-health` or Manifest `healthCheck`. Runtime connection is not business readiness; missing evidence is unknown. Unknown external effects are not replayed. Keep existing activation rollback guards: only the matching unverified activation before business delivery, approved valid versions, unchanged data schema and no migration/restore or group activation; never replay work or recursively roll back restored code.
- Current Provider: Pi RPC. The isolated model-completion gateway's token-limit extension is verified against Pi 1.5.0 only and accepts only provider payloads with a supported native output-token cap. Codex and unsupported models fail closed for model completion; ordinary foreground RPC is unaffected. This is a source limitation, not a completed model acceptance gate. Internal build-native `chronaToolInputSchemas` contains only `chrona_reply`; ordinary work uses application-owned Agent contexts and routed tools. Kernel settings contain hard model budgets, usage and budget timezone; Agent privately selects model/thinking and preferred timeout within those caps. Application preferences and configuration stay in the owning app. Prose does not schedule or deliver; successful tools and persisted receipts establish effects.
- Public `approvals` exposes only `list/resolve/request/status`; `resolve` accepts only `approval` and `decision`, with no public scope selector. Approval actions are exactly `activate_module/delete_data/modify_external`. Decisions apply to the bound approval and payload; module requests resume their waiting call without creating generic or standing grants. There is no public grants/revoke API. Retained internal policy/storage types do not grant public authority. External text can never grant anything.
- Notify is an ordinary application in `external/notify`, owning notification wording, daily cap, quiet hours, digest, channels and delivery. App-originated notifications use `notify.send`; channel adapters such as `qq.deliver` are module tools. Kernel state changes persist finite facts transactionally; the kernel never calls a notification app. A single owner-selected app consumes `activity.facts/ack/withdrawals`: persist privately, acknowledge, then deliver; reconcile durable withdrawals before recovered delivery. Initial installation may seed Notify once; explicit null and later selections persist. See `docs/zh/kernel-notification-facts.md` and the current boundary inventory.
- Never pretend: unfinished work is reported as unfinished; unverified sources are marked.
- No backward compatibility with removed systems: affairs, task/goal/plan systems, AffairResult,
  Ask/suggestions, care/cadence, FollowUp, concierge/assessor roles, management MCP, Hermes, the `job`
  schedule mode, one-shot stdin/stdout modules and P3 simulation.

The shared contract `packages/contracts/src/steward/index.ts` is supervisor-owned: propose
changes, do not edit it in delegated work.

The ordinary optional owner MCP application (`external/mcp`) serves authenticated POST `/api/mcp` after checked installation. It owns its conversations and memory preferences, discovers current user tools, and binds application calls to the discovered identity and contract. The current conversation Agent can author material through Author and submit it under owner-issued fixed admission; MCP exposes no legacy automatic-build, public calendar, standing-grant or central application-settings interface. Only Remind remains paused as a whole application. Mind's ordinary optional implementation and isolated acceptance are complete; local deployment is recorded in docs/zh/mind-implementation.md, with automatic checks and notifications disabled. Editor is retired and removed; see docs/zh/editor-retirement.md. Coding and coding-web use one application command protocol; their fresh isolated acceptance is recorded in docs/zh/coding-peer-clients-implementation.md; this does not establish deployment or real-model acceptance. Coding owns conversations and receipts; clients own selection and drafts. Projects are mediated by Agent with the original Coding principal, never an owner promotion.

Never pre-approved: deleting or migrating real user data, deploy/push,
live databases, real accounts or external sends, disabling auth, approvals or secret redaction.

## Code map

| Path | Role |
| --- | --- |
| `packages/contracts/src/steward` | Shared zod contract: views, requests, HTTP map, agent tool schemas, ports |
| `packages/domain/src/steward` | Pure policy, budgets, schedule rules, inbound rules, Markdown and refs |
| `packages/engine/src/modules/steward` | Kernel identity/routing/lifecycle, candidate receipts, approvals, budgets, Run queue, stop evidence, private hosts; application implementations in builtin/external |
| `packages/integrations/src/steward` | Host adapters, module sandbox and SDK |
| `packages/pi` | Pi provider and completion executor |
| `packages/pi/resources` | Pi extension that forwards tool calls to Chrona's loopback agent endpoint |
| `packages/db` | Prisma client, SQLite migration runner, backup/restore |
| `apps/server` | Hono app: `/api/steward-agent` (Provider tool bridge), `/health`, the `listen` proxy (API key checked for `/api/*`), rescue console, runtime (tick, Provider queues) |
| `packages/engine/src/modules/steward/builtin` | Sole immutable builtin application `agent`, with Pi adapter and private model policy |
| `packages/engine/src/modules/steward/external` | Ordinary default Web/Notify/QQ/Author; optional MCP/Files/Events/memory-local/Coding/coding-web; Mind implemented and locally deployed with automation disabled; Remind source retained, integration paused; Editor retired and removed |
| `packages/cli` | `chrona start / backup / restore / doctor / qq bind-code` |

Dependency direction: `apps → packages/engine → packages/domain → packages/contracts`;
routes validate and delegate; domain has no I/O.

## Tech stack

- Web page: the ordinary `web` application (`external/web`: `index.html`, `app.js`, `pages.js`, `style.css`). All system and registered app pages share the React/json-render renderer in `src/pages.tsx`, built by `build.ts`; system specs live in `src/system/` and alone receive the system adapter. `app.js` keeps authentication, requests, routing and the single SSE connection; its own `/api/web` uses routed calls.
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

## Material submission and private rescue

`modules.build-owner`, MCP `chrona_build` and the other former public build/distribution tools are removed. The current conversation Agent uses its existing Run and budgets to develop, build and test in its workspace, then imports explicit source/artifact materials through Author. Preserve source, locks, build scripts and `.gitignore` for future edits; export the admitted exact prior version before rebuilding an update. Author itself does not start a model or automatically obtain admission; the real owner-entry caller issues admission for the current approved Author identity and complete target set. Use exact `modules.admit-candidates` / `source` / `submit` / `candidate-check` contracts and preserve request keys after lost replies. Private stopped-service rescue is a separate host operation with exact identity/hash, approval and data guards; it grants no normal public build authority or permission to touch live user data. Final development gate results are pending in the permanent-boundary implementation record.

## Keep implementations minimal

These rules apply to the coordinator and every delegated worker.

- Place business functionality in ordinary applications first. Preinstallation is a delivery choice within the same application category, not extra authority. Add a narrow kernel/system primitive only when an actual requirement cannot safely be met in an application; both the kernel and its system modules must remain minimal.
- Prefer existing application owners for business policy, presentation, aggregation and workflow. Move toward a more privileged layer only when a concrete requirement cannot be met through existing routed calls; document that requirement. Reuse alone does not justify promotion.
- Kernel/system modules expose narrow, governed primitives. The kernel itself contains only the irreducible trust root, routing and lifecycle mechanisms that cannot safely live behind those primitives. Keep caller identity, permission enforcement, budgets, leases, cancellation and actual-stop evidence at their required enforcement boundary.
- Acceptance check: changing a business strategy or adding an application should normally require only module changes. Do not replace removed business code with a speculative hook framework or duplicate runtime.

- Validate raw external input and persisted data at their actual trust boundary. Within the same operation, pass the parsed value onward; do not repeat schema parsing, enum membership checks, or defensive type conversions on trusted internal values.
- Read and validate a database identity once per write transaction, then reuse that row. Recheck after a separate approval, queued delivery, or asynchronous lifecycle boundary when the state can actually change; preserve authorization, idempotency and data-loss protections.
- Add a defensive branch, fallback or retry only for an explicit requirement, a reachable current failure, or a documented trust/concurrency boundary. Otherwise remove it. Propagate unexpected failures instead of silently substituting success or empty data.
- Test doubles implement the smallest public contract needed by their consumers. Do not prebuild a future storage engine, scheduler, quota allocator or recovery system inside a fake. Prefer reusable input/output cases over tests coupled to fake-private methods.
- Extract helpers for a clear responsibility or useful reuse. Do not add forwarding layers, wrappers or abstractions merely to move a lint complexity score; simplify the control flow while preserving behavior.
- Review connected callers and delete unnecessary checks and code before accepting a change. A request for proof must establish user-visible behavior or a real boundary, not mandate speculative implementation details.
- Run the checks appropriate to the changed behavior. After they pass, repeat or broaden them only for new changes, failures or a concrete unresolved concern; do not add another approval loop for work already authorized.

## Checks

- Heavy commands use a lot of memory: run them one at a time, memory-capped, e.g.
  `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit`.
- Targeted first: `bun test <paths>`. Full: `bun run typecheck`, `bun run lint`, `bun run test:bun`, `bun run test:api` (all server tests); check page changes in a real browser.
- State derivation changes need table-driven tests. UI tests assert user-visible text, roles and
  next actions (not CSS) and cover empty, loading, error, waiting and done states.
- Never call a real model or QQ in automated tests.

## Web page principles

- The web page is Chinese-first and all pages share the json-render components; keep the static page data-free (data comes from `/api/web` with the user's key).
- Web owns the host shell/theme/navigation for every authenticated page. Pages declare `layout: document|workspace`; never infer host styling from child components. App-private declarative `components` travel with `web.page-set`, expand before normal catalog/tool checks, and carry no extra authority or browser code. Separately, trusted executable components register through `web.component-set`, bind to the real application's identity and active version, and load directly in the browser with cleanup on unmount. Their routed callbacks still use page and tool contract checks; this is not malicious-code isolation. See [executable component contracts](docs/zh/web-executable-components.md). Use explicit `Composer.on.submit` and application-provided `WorkspaceHeader.statusTone`; see [Web composition contracts](docs/zh/web-components-and-shell.md).
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

