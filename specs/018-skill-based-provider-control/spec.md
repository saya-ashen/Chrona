# Spec 018 — Skill-based provider control plane

> Parent: builds on [`specs/005-mcp-task-tools`](../005-mcp-task-tools/spec.md)
> (the MCP tool contract this spec migrates away from) and
> [`specs/017-provider-claude-code`](../017-provider-claude-code/spec.md) (the
> provider abstraction this spec re-plumbs). Where this spec and the engine's
> existing *business* logic disagree, **stop and surface it** rather than
> guessing — the engine's plan/execution semantics do not change here, only the
> transport by which an agent learns its task and reports its result.

Status: **Draft — ready to implement after the §0 research gate in `plan.md`.**
Read this file, then `plan.md`, then `tasks.md`.

> **Orientation note (读这一段先).** 这份 spec 把 agent ↔ Chrona 的连接方式从
> "MCP 工具"换成"skill + 一个 `chrona` CLI"。三个关键点,实现时不能搞错:
> 1. **Agent 永远不知道、也不传 task/node id。** 身份范围(scope)由 Chrona 在
>    启动 run 时注入,对模型不可见 —— 和今天 MCP 的做法一致,只是载体不同。
> 2. **控制动作(complete / block / fail / condition-select)走 CLI → HTTP**,
>    打到新的 token-scoped `POST /agent/control`,复用已有的
>    `submitNodeResult` 派发,不新建业务逻辑。
> 3. **本 milestone 只把 `claude_code` 做成 skill mode。** Hermes 现在走
>    gateway/API Server,文档未提供 per-run env / per-run skill preload 字段;
>    因此 Hermes 保持 MCP,之后再评估 Hermes API 扩展或本地 CLI mode。

---

## 1. Problem

Chrona drives execution agents (`claude_code`, `hermes`, `debug`) by exposing its
control plane as **MCP tools** over streamable HTTP at `/api/mcp`. An agent
discovers ~10–19 tool schemas, calls e.g. `chrona.node.complete`, and the engine
advances the plan graph. This works, but has two structural costs:

1. **Context cost that scales with the tool surface.** Every MCP tool schema
   (name, description, full Zod-derived input schema) is loaded into the agent's
   context on the `tools/list` handshake. As Chrona adds tools, every run pays
   for the whole surface on every node execution, whether or not the node needs
   those tools. There is no progressive disclosure.
2. **Per-provider plumbing for the *same* contract.** Each provider needs its own
   wiring to reach the MCP surface: `claude_code` registers an HTTP MCP server in
   its run options; `hermes` ships a **separate Python plugin**
   (`external-plugins/hermes/`) that proxies `tools/call` back to `/api/mcp`.
   Adding a provider means re-solving "how does this agent see Chrona's tools."

**Skills** (a markdown instruction file with progressive disclosure, plus a
bundled CLI the agent runs in its shell) are now broadly supported across the
agent runtimes Chrona targets. A skill loads only its short frontmatter into
context until the agent decides it is relevant, and a single bundled `chrona`
CLI replaces N tool schemas with one command surface the agent already knows how
to use (it has a shell). This directly attacks both costs.

## 2. Goal

Replace the MCP-tool control plane with a **skill + `chrona` CLI** control plane,
such that:

- A node execution loads a **single Chrona skill** (short frontmatter, body
  disclosed on demand) instead of a wall of tool schemas.
- The agent reports every control action (`output`) and terminal outcome
  (`complete`, `condition-select`, `block`, `fail`, `wait-complete`) by running
  the bundled `chrona` CLI, which POSTs to Chrona's token-scoped
  `POST /agent/control` endpoint.
- The agent **never** supplies a task/node/session id. Scope is injected by
  Chrona at run start and resolved **server-side** from an opaque run token — the
  same trust model MCP uses today, moved from an HTTP header / request body onto
  the agent's environment.
- **No engine business logic changes.** `submitNodeResult` and the plan-execution
  state machine are reused verbatim. Only the *transport* into them changes, and
  the *terminal-result detection* path is simplified (see §7).
- The MCP control plane can be **kept in parallel behind a flag** during rollout;
  in this milestone Hermes keeps using MCP while `claude_code` proves skill mode.

## 3. Background: how the control plane connects today (verified against the codebase)

| Concern | Where (file:symbol) | Today's behavior |
| --- | --- | --- |
| Tool surface definition | `packages/contracts/src/api/mcp-task-tools.schema.ts` → `chronaToolNames` | 19 internal tool names; a public subset is exposed externally (snake_case). |
| MCP HTTP server | `apps/server/src/routes/mcp/mcp.routes.ts` | `registerTool()` per tool; handler resolves session, calls `engine.agentTools.execute({toolName, input})`. |
| Session resolution | `mcp.routes.ts:119` → `sessionIdFrom(input, extra)` | Extracts `sessionId` from `input.sessionId` / `_meta.sessionId` / `extra`. **The agent/plugin supplies it.** |
| Scope resolution | `packages/engine/src/modules/agent-tools/operations.ts:157` → `resolveInputContext()` | `sessionId` → `db.taskSession` (by `id` or `sessionKey`) → `task`; fallback `db.run` by `runtimeSessionRef`/`runtimeRunRef`. Yields `taskId` + `workspaceId`. |
| Control dispatch | `packages/engine/src/modules/agent-tools/dispatch.ts:35` | `switch (toolName)` → `deps.execution.submitNodeResult({ taskId, commandContext, action })`. **This is the engine seam we reuse.** |
| Auth | `apps/server/src/middleware/auth.ts:15` → `apiKeyAuth()` | If `API_KEY` env set, requires `Authorization: Bearer ${API_KEY}`; skips `/health`. Same key gates the task HTTP routes. |
| claude-code transport | `packages/providers/claude-code/src/runner.ts:278` (CLI spawn), `ClaudeCodeProviderClient.ts:260` (`buildRunner`) | Local subprocess. `env: { ...process.env, ...(cfg.env ?? {}) }`. Registers `/api/mcp` as an HTTP MCP server with `mcpRunToken` (`chrona-run-${ISO}`) Bearer. |
| hermes transport | `packages/providers/hermes/src/HermesProviderClient.ts:444` → `buildRunBody` | Remote gateway. POST `/v1/runs` body `{ input, session_id, instructions, conversation_history, previous_response_id }`. SSE stream `/v1/runs/{id}/events`. |
| hermes tool bridge | `external-plugins/hermes/tools.py` | Python plugin reads `CHRONA_MCP_URL`, proxies `tools/call` back to `/api/mcp`, injects `sessionId` + `actorId=hermes:<sid>`. |
| Terminal-result detection | `packages/engine/src/modules/plan-execution/runtime/node-ai-capabilities.ts:55` → `terminalToolNameFromSnapshot()` | After a provider run ends, scans `ProviderRunSnapshot.raw.terminalTool.name` / `terminal_tool_name` / `structuredPayload.terminalToolName` to build a `NodeExecutionResult`. **This is the path that simplifies (§7).** |
| Node terminal tool sets | `packages/engine/src/modules/plan-execution/runtime/node-runtime-prompts.ts:9` → `NODE_RUNTIME_TERMINAL_TOOLS` | Per node type (`task`/`condition`/`checkpoint`/`wait`), which terminal tools are valid. |
| Instructions (skill content source) | `packages/contracts/src/ai-feature-specs.ts` → `PreparedAiFeatureSpec.instructions`, `SUGGEST_SYSTEM_PROMPT`, `GENERATE_PLAN_SYSTEM_PROMPT` | The prose currently sent as the system prompt; the durable parts become `SKILL.md` body. |

### Two facts that de-risk the whole migration

- **Scope is already server-resolved from an opaque key, not trusted from the
  model.** `resolveInputContext` looks `sessionId` up in the DB; the agent never
  names a `taskId` that the engine trusts directly. Moving that key from an MCP
  request field onto an injected env var is a **lateral** change in trust, and in
  fact a *tightening*: today `sessionIdFrom` accepts a client-supplied
  `sessionId`; an injected env token the model cannot alter is stricter.
- **The engine dispatch seam already exists; the new route is only a safer
  transport.** `dispatch.ts` already maps Chrona tool intents to
  `submitNodeResult(...)`. `POST /agent/control` derives scope from the run token
  and calls that same mapping instead of exposing `taskId` in the route.

## 4. Core design: three pillars

### Pillar A — A single Chrona skill replaces the tool-schema wall

Ship one skill (`chrona-node`) whose `SKILL.md` frontmatter is tiny (name +
one-line description + when-to-use). Its body — disclosed only when the agent
opens it — contains the durable instructions currently in
`ai-feature-specs.ts` / `node-runtime-prompts.ts`, plus the `chrona` CLI usage.
The **per-node dynamic prompt** (the specific task, node title, runtime input)
continues to flow through the provider's normal prompt/instructions channel
(`StartRunInput.instructions`); the skill holds only the *invariant* "how to be a
Chrona execution node" knowledge. Net context change: from N tool schemas every
run → one skill's frontmatter until opened.

### Pillar B — The bundled `chrona` CLI replaces tool calls

The skill bundles a `chrona` CLI (one binary/script). The agent ends a node by
running, e.g.:

```
chrona node complete --output-file ./result.json
chrona node condition-select --branch <branchRef> --summary "..."
chrona node block --reason "need credential X" --action-form '{...}'
chrona node fail  --error "build failed: <detail>"
chrona node output --outputs-file ./partial.json --mode append
chrona node wait-complete --summary "..."
chrona task read     # read-only context fetch
chrona plan read
```

Each subcommand maps 1:1 onto an existing dispatch action (§6). The CLI reads
scope + token from its environment (Pillar C), constructs the request the MCP
tool would have constructed, and POSTs to the Chrona HTTP route. **The CLI is the
only thing that knows the HTTP shape; the agent only knows the verbs.**

### Pillar C — Scope is injected, never modeled

At run start Chrona mints a **run-scoped token** and makes it, plus the Chrona
base URL, available to the agent's shell as environment variables:

```
CHRONA_BASE_URL        # e.g. http://127.0.0.1:3101
CHRONA_RUN_TOKEN       # opaque, run-scoped; server resolves it to task+node+session
```

The CLI sends `Authorization: Bearer ${CHRONA_RUN_TOKEN}` (or a dedicated header,
§6.3) and **no id from the model**. The server resolves the token to the exact
`taskId` / `nodeAttemptId` / `sessionId` (§7.1). The model cannot target another
task because it does not hold, and cannot forge, another task's token.

**This milestone only enables local provider injection for `claude_code`:**

- `claude_code` — Chrona owns the subprocess, so it writes the env directly at
  `spawn` time and mounts the `chrona-node` skill.
- `hermes` — Chrona currently talks to a long-running gateway/API Server via
  `/v1/runs`. The documented API has no per-run env landing or per-run skill
  preload field, and putting `CHRONA_RUN_TOKEN` into `instructions` would expose
  the token to the model/session storage. Hermes therefore stays on MCP in this
  milestone. Future options: a Hermes API extension for per-run env+skills, or a
  separate local Hermes CLI provider that Chrona spawns with env.

## 5. Per-provider scope-injection contract

| Provider | Chrona owns shell? | This milestone | Future path |
| --- | --- | --- | --- |
| `claude_code` | Yes (local subprocess) | Set `CHRONA_BASE_URL`, `CHRONA_RUN_TOKEN` in spawned process `env`; mount the `chrona-node` skill into the run. | — |
| `hermes` | No (gateway/API Server) | Keep `controlPlane: "mcp"`; do not send run token through `instructions` or undocumented body fields. | Add Hermes API support for per-run env + per-run skill preload, or add a local `hermes chat --skills` subprocess provider. |
| `debug` | n/a (in-process fake) | Simulate terminal actions by calling the same HTTP/dispatch path or `submitNodeResult` directly (keep deterministic). | — |

### 5.1 claude_code injection point (verified)

`packages/providers/claude-code/src/runner.ts:278` already merges env:

```ts
const child = spawn(cfg.binaryPath ?? "claude", args, {
  cwd: cfg.cwd ?? process.cwd(),
  env: { ...process.env, ...(cfg.env ?? {}) },   // ← inject CHRONA_* here
  stdio: ["ignore", "pipe", "pipe"],
});
```

`cfg.env` is populated in `ClaudeCodeProviderClient.buildRunner`
(`ClaudeCodeProviderClient.ts:260`), which already mints `mcpRunToken`. The
change: thread the run token + base URL (and scope refs) from
`StartRunInput`/the invoker into `cfg.env`, and add the skill mount (CLI/SDK
flag — confirm in `plan.md` §0). The skill directory and the `chrona` CLI must be
on the spawned run's filesystem (they live on Chrona's host, which is the same
host — this is why local injection is trivial).

### 5.2 hermes status: gateway/API Server stays on MCP for this milestone

`packages/providers/hermes/src/HermesProviderClient.ts:444` builds the documented
Hermes `/v1/runs` body:

```ts
const body: HermesRunBody = {
  input: normalizeRunInput(input.input),
  session_id: input.sessionId,
  instructions: input.instructions,
};
```

Hermes API Server docs document `/v1/runs` inputs as `input`, `session_id`,
`instructions`, `conversation_history`, and `previous_response_id`. They do not
document per-run env variables, per-run skill preload, CLI PATH injection, or
external skill directories. Hermes skills support installed/external skills and
declared env passthrough, but those are profile/config/skill-load level, not a
safe run-scoped token handoff.

Therefore this milestone must not add `chrona_run_token` to Hermes
`instructions`, and must not rely on undocumented `/v1/runs` fields. Hermes keeps
the existing MCP plugin path. Revisit after either:

1. Hermes gateway/API Server exposes a documented per-run env + skill preload
   contract that keeps `CHRONA_RUN_TOKEN` out of model-visible prompt/session
   storage, or
2. Chrona adds a separate local Hermes CLI provider using `hermes chat --skills`
   / `hermes -z`, where Chrona owns the subprocess env.

## 6. The `chrona` CLI surface → HTTP route → dispatch action mapping

Each CLI subcommand reconstructs the request the corresponding MCP tool produced,
then POSTs it. The server-side handler resolves scope from the token (§7.1) and
calls the **same** `submitNodeResult` dispatch used today
(`dispatch.ts:35`), so the engine action types are unchanged.

| CLI command | Replaces MCP tool | Dispatch action (`dispatch.ts`) | HTTP route |
| --- | --- | --- | --- |
| `chrona node output --outputs-file <f> [--mode append\|replace] [--summary <s>]` | `chrona.node.output` | `submit_node_output` | `POST /agent/control` |
| `chrona node complete [--output-file <f>] [--summary <s>]` | `chrona.node.complete` | `complete_manual_node` (`terminalKind: "task"`) | `POST /agent/control` |
| `chrona node condition-select --branch <ref> [--summary <s>]` | `chrona.node.condition_select` | `complete_manual_node` (`terminalKind: "condition"`, `branchRef`) | `POST /agent/control` |
| `chrona node wait-complete [--summary <s>]` | `chrona.node.wait_complete` | `complete_manual_node` (`terminalKind: "wait"`) | `POST /agent/control` |
| `chrona node block --reason <r> [--action-form <json>]` | `chrona.node.block` | `block_current_node` | `POST /agent/control` |
| `chrona node fail --error <e>` | `chrona.node.fail` | `fail_current_node` | `POST /agent/control` |
| `chrona task read` | `chrona.task.read` | (read op via `agentTools.execute`) | `POST /agent/control` or read-specific token-scoped route |
| `chrona plan read` | `chrona.plan.read` | (read op) | `POST /agent/control` or read-specific token-scoped route |

> The `taskId` in the route is **filled by the server from the token**, not by
> the agent. Either (a) the CLI calls a token-scoped route that needs no path id
> (recommended — see §6.3), or (b) the server derives `:taskId` from the token
> and rejects any mismatch with a path id. Pick one in `plan.md` §4; the
> recommended design is a single token-scoped control endpoint.

### 6.3 Recommended: one token-scoped control endpoint

Rather than make the CLI know `:taskId`, add **one** thin route that takes the
action and derives all scope from the token:

```
POST /agent/control
Authorization: Bearer <CHRONA_RUN_TOKEN>
Body: { "kind": "complete" | "output" | "condition_select" | "wait_complete"
              | "block" | "fail",
        "payload": { ... } }     # the same shape the MCP tool payload used
```

Handler:
1. `apiKeyAuth()` (or a run-token validator, §7.1) authenticates.
2. Resolve `{ taskId, nodeAttemptId, sessionId, workspaceId }` from the token
   (reuse `resolveInputContext`'s session→task lookup, keyed on the token's
   bound session/run ref).
3. Map `kind` + `payload` → the `submitNodeResult` action exactly as
   `dispatch.ts` does, and record the terminal action (§7.1).
4. Return a small JSON ack (so the CLI can print success/failure to the agent).

This keeps the CLI dead simple (`POST /agent/control` with a verb), keeps scope
entirely server-side, and gives **one** auth + resolution point to harden.

## 7. Server-side: how the engine learns the terminal result (the load-bearing change)

Today, after a provider run ends, the runtime **reads the agent's terminal
decision back out of the provider's event stream** via
`terminalToolNameFromSnapshot` (`node-ai-capabilities.ts:55`), scanning
`ProviderRunSnapshot.raw` / `structuredPayload`. In skill mode the agent does not
call an MCP tool the provider stream can mark — it runs a CLI that POSTs to
Chrona. So the terminal decision must reach the engine a different way.

### 7.1 Design: Chrona records the terminal action when the CLI calls it

The `POST /agent/control` handler (§6.3) is the authoritative record of what the
agent decided. When it processes a terminal `kind` (`complete`,
`condition_select`, `wait_complete`, `block`, `fail`) it:

1. Resolves scope from the token → `taskId`, `nodeAttemptId`, `sessionId`.
2. Calls `submitNodeResult(...)` (unchanged engine seam).
3. **Persists a terminal-action record** keyed by `nodeAttemptId` (and/or the
   run's `runtimeRunRef`), capturing `{ kind, payload, recordedAt }`. This record
   is the skill-mode analog of `ProviderRunSnapshot.raw.terminalTool`.

The runtime's result builder then changes from "parse the provider snapshot" to
"read Chrona's own terminal-action record for this `nodeAttemptId`":

- New helper (sibling to `terminalNodeResultFromSnapshot`):
  `terminalNodeResultFromRecordedAction({ nodeAttemptId, node, plan, evidence })`
  → builds the same `NodeExecutionResult` shape (`status: done|blocked|failed`,
  `output`, condition selection) the snapshot path builds today.
- Selection logic in the runtime: **if the client/run is in skill mode**, prefer
  the recorded-action path; otherwise fall back to the snapshot path. Gate by the
  same flag that selects skill vs MCP transport (§8).

**Ordering / race:** the agent calls the terminal CLI command and *then* its turn
ends, so the control POST commits before the provider run reaches terminal. By
run-end the record exists. If, at run-end, **no** terminal-action record exists
for the attempt, treat it exactly as today's "no terminal tool detected" case
(`terminalNodeResultFromSnapshot` returning `undefined`) — the caller's existing
not-completed handling applies. Document this guarantee + fallback in `plan.md`.

### 7.2 Why this is a simplification, not just a swap

The recorded-action path removes the brittle triple-fallback scan of
`raw.terminalTool.name` / `terminal_tool_name` / `structuredPayload.terminalToolName`
and makes the terminal result **provider-agnostic**: the engine reads its own DB
record, regardless of whether the agent was claude_code or hermes. The provider
run's only remaining job is "run to terminal and stream events for
observability" — it stops being the carrier of the control decision.

## 8. Rollout: coexistence flag, per-provider

Add a transport selector on the AI client config (contracts) — e.g.
`controlPlane: "mcp" | "skill"` (default `"mcp"` during rollout). The selector
drives three forks:

1. **Provider setup:** skill mode mounts the `chrona-node` skill + injects
   `CHRONA_*` env for providers that Chrona spawns locally; MCP mode keeps
   registering `/api/mcp` (+ hermes plugin).
2. **Prompt assembly:** skill mode trims the tool-usage prose from the dynamic
   prompt (the skill body carries it); MCP mode is unchanged.
3. **Terminal-result read:** skill mode uses the recorded-action path (§7.1); MCP
   mode uses the snapshot path.

This lets `claude_code` move to skills first while Hermes stays on MCP until a
safe Hermes-specific handoff exists. Remove the MCP path per provider only after
its skill path passes the golden path (§9). Do **not** delete
`terminalToolNameFromSnapshot` or the MCP routes until **all** target providers
are off them.

## 9. In scope / Non-goals

**In scope:**
- A `chrona` CLI package (the bundled control binary).
- A `chrona-node` skill package (`SKILL.md` + bundled CLI + invariant
  instructions migrated from `ai-feature-specs.ts` / `node-runtime-prompts.ts`).
- Run-token minting + the token-scoped `POST /agent/control` route (or the
  derive-from-token variant) reusing `apiKeyAuth` and `resolveInputContext`.
- Scope injection: `claude_code` env at spawn. Hermes gateway/API Server remains
  MCP in this milestone; Hermes skill mode is a future integration.
- `controlPlane` config field + Settings surface; per-provider rollout.
- Deterministic tests mirroring the existing replay approach.

**Non-goals (do not do):**
- **No engine business-logic change.** `submitNodeResult`, the action types in
  `dispatch.ts`, and the plan-execution state machine are reused as-is.
- **No removal of the MCP path** in this spec — it stays behind the flag for
  rollback and for any provider whose runtime can't host the skill/CLI yet.
- **No new agent-supplied scope.** The agent never sends a task/node/session id;
  scope is always token-resolved server-side.
- **No Hermes gateway skill mode in this spec.** Gateway/API Server lacks a
  documented per-run env + skill preload contract, so Hermes stays on MCP. Future
  Hermes work belongs in a follow-up spec once that contract exists, or in a
  separate local CLI provider design.
- No change to `apps/web` beyond the `controlPlane` selector on the client form.
- No DB migration unless `data-model.md` concludes the terminal-action record /
  run-token storage requires one (it likely needs a small store — decide there).

## 10. Acceptance criteria (Definition of Done)

- [ ] A `chrona` CLI exists and, given `CHRONA_BASE_URL` + `CHRONA_RUN_TOKEN`,
      can drive non-terminal `output`, every terminal action (`complete`,
      `condition-select`, `wait-complete`, `block`, `fail`), and read context —
      with **no** task/node id passed by the caller.
- [ ] A `chrona-node` skill exists; its `SKILL.md` frontmatter is minimal and its
      body carries the invariant execution instructions + CLI usage.
- [ ] `POST /agent/control` (or the chosen variant) authenticates via the run
      token, resolves `{taskId, nodeAttemptId, sessionId}` server-side, and routes
      to the **existing** `submitNodeResult` actions; an agent-supplied id cannot
      redirect the action to another task.
- [ ] claude_code in skill mode: env injected at spawn, skill mounted, a
      dispatched node executes and reports its terminal outcome via the CLI, and
      the engine advances the graph from the **recorded-action** path (snapshot
      detection not used).
- [ ] Hermes remains on MCP in this milestone. Selecting skill mode for Hermes is
      blocked or rejected with a clear unsupported-provider message until a
      documented Hermes per-run env + skill preload contract exists.
- [ ] The `controlPlane` flag selects transport per provider with the MCP path
      still fully functional when selected.
- [ ] `bun run typecheck`, `bun run lint` (no new warnings), and
      `bun run check:boundaries` pass.
- [ ] Deterministic tests cover: CLI request construction, token→scope
      resolution, recorded-action → `NodeExecutionResult` mapping, and the
      runtime fork — wired into `test:ci` like the existing fixtures.
- [ ] The milestone golden path passes with at least claude_code in skill mode;
      context-size reduction vs MCP mode is measured and recorded (the §1 cost
      this spec exists to remove).
- [ ] Spec is traceable: each `tasks.md` step names the acceptance item it
      satisfies.
