# Spec 017 — Claude Code execution provider

> Parent: [`docs/en/milestone-0.2.md`](../../docs/en/milestone-0.2.md) → **WS-B**.
> This spec is the authoritative, implementable expansion of that workstream.
> Where this spec and the milestone doc disagree, the milestone doc's
> guardrails (§5) and non-goals still bind; where this spec and the code
> disagree, **stop and surface it** rather than guessing.

Status: **Ready to implement.** Read this file, then `plan.md`, then `tasks.md`.

---

## 1. Problem

Chrona can hand scheduled work to an AI runtime for execution, but the only real
execution provider is **Hermes** (`packages/providers/hermes`). That gates
adoption to users who run a Hermes gateway. The provider abstraction
(`AgentProviderClient`) was built to be multi-provider, but it has only ever had
one real implementation, so we do not actually know it generalizes.

This spec ships a **second, real execution provider that drives Claude Code** so
that a user who already runs Claude Code can execute Chrona's scheduled work
without installing Hermes — and, in doing so, proves (or fixes) the provider
abstraction.

## 2. Goal

A user adds a "Claude Code" client under **Settings → AI Clients**, binds it to
the `dispatch_task` / `execute_task_node` features, and a scheduled task then
executes through Claude Code, reporting its outcome back through Chrona's
existing MCP tool contract — with no changes to engine *business* logic.

## 3. Background: how a provider plugs in (verified against the codebase)

| Concern | Where | Notes |
| --- | --- | --- |
| Provider interface | `packages/providers/foundation/src/contracts/provider.ts` → `AgentProviderClient` | 8 methods (one optional). Full surface in §5. |
| Foundation exports (schemas, types, replay) | `packages/providers/foundation/src/index.ts` | Import every schema/type/replay helper from `@chrona/providers-foundation`. |
| Reference implementation | `packages/providers/hermes/src/HermesProviderClient.ts` (+ `http.ts`, `sse.ts`, `normalizers.ts`, `types.ts`, `index.ts`) | Mirror this structure. |
| Smallest template | `packages/providers/debug/src/ChronaDebugProviderClient.ts` | Minimal `AgentProviderClient` end-to-end. |
| Engine registry (record → client) | `packages/engine/src/modules/ai/runtime/client-registry.ts` → `createProviderClient(record)` | A `switch (record.type)`; add a `claude_code` branch. |
| Engine health/capability checks | `packages/engine/src/modules/ai/providers.ts` → `checkClientHealth(...)` | Add a branch for the new client type. |
| Client type union + config | `packages/contracts/src/ai-feature-types.ts` → `AiClientType`, `HermesClientConfig` | Add `claude_code` to the union and a `ClaudeCodeClientConfig` interface. |
| AI features (bind targets) | `packages/contracts/src/ai-feature-types.ts` → `AiFeature` | `dispatch_task`, `execute_task_node`, `evaluate_condition_node`, `review_checkpoint_node` are the execution features. |
| Agent ↔ Chrona contract | Chrona MCP surface (streamable HTTP at `/api/mcp`) + AI-visible refs | Tools: `chrona.task.complete`, `chrona.condition.select`, `chrona.node.block`, `chrona.node.fail`, `chrona.wait.complete`. **Reuse — do not invent a new contract.** |
| Existing agent-side plugin | `external-plugins/hermes/` (Python) | Hermes needs a plugin to expose Chrona MCP to the agent. **Claude Code does not** — it consumes MCP servers natively (see §6). |
| Persistence | `db.aiClient` table (config is JSON, type is a string) | No schema migration needed for the client record itself (see `data-model.md`). |

### Key simplification vs Hermes

Hermes reaches Chrona's tools through the Python plugin in
`external-plugins/hermes/`. **Claude Code consumes MCP servers natively**, and
Chrona already exposes its tools over streamable HTTP at `/api/mcp`. So the
Claude Code provider registers Chrona's existing MCP endpoint with the spawned
Claude Code run — there is **no new agent-side plugin to build**. This is the
single biggest scope reduction in this spec; preserve it.

## 4. Decision: how Chrona drives Claude Code

> **Mandatory research gate (do this first, in the plan phase).** Before writing
> the adapter, consult the `claude-code-guide` reference for the **current**
> Claude Code headless / Claude Agent SDK invocation surface, streaming event
> format, MCP-server registration, permission/approval handling, and the exact
> npm package name + entry function. Do **not** rely on training memory for
> these specifics — they drift. The claude-api skill covers the Anthropic
> Messages API and Managed Agents, **not** the Claude Code CLI/Agent SDK; use
> `claude-code-guide` for that. Record the confirmed surface in `plan.md` §0
> before coding.

**Primary approach (recommended): Claude Code headless via the Claude Agent
SDK / `claude -p` stream-json**, running locally as "the coding agent the user
already has." This matches the milestone thesis ("any Claude Code user…") and
keeps execution on the user's machine, consistent with Chrona's local-first
positioning.

**Alternative to evaluate in the research gate, not assume:** Anthropic
**Managed Agents** (server-hosted agent loop + session event stream + MCP via
vaults) maps almost 1:1 onto `AgentProviderClient` (sessions↔`createSession`,
`sessions.events.stream`↔`streamRun`, `sessions.archive`/interrupt↔`cancelRun`)
and would be cleaner to implement — but it is a different deployment model
(Anthropic-hosted, API-billed, not the user's local Claude Code). **Default to
the local headless approach;** only switch to Managed Agents if the research
gate finds the local surface cannot satisfy §5 cleanly, and record that decision
in `plan.md` §0.

Model defaults when the adapter spawns Claude Code: `claude-opus-4-8` by
default; allow the user to configure the model (and offer `claude-fable-5` for
the most demanding work). Use exact model-ID strings — never append date
suffixes.

## 5. The contract to implement: `AgentProviderClient`

`packages/providers/claude-code/src/ClaudeCodeProviderClient.ts` must implement
this interface (verbatim from `foundation/src/contracts/provider.ts:495`):

```ts
interface AgentProviderClient {
  readonly provider: string;                                   // "claude_code"
  getCapabilities(): ProviderCapabilities | Promise<ProviderCapabilities>;
  checkHealth(input?: HealthCheckInput): Promise<ProviderHealth>;
  createSession(input?: CreateSessionInput): Promise<ProviderSessionRef>;
  startRun(input: StartRunInput): Promise<ProviderRunRef>;
  streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent>;
  getRun(input: GetRunInput): Promise<ProviderRunSnapshot>;
  cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot>;
  resolveApproval?(input): Promise<ProviderApprovalResolution>; // optional
}
```

### Method-by-method mapping (the spec's core)

| Method | Maps to (Claude Code) | Required behavior |
| --- | --- | --- |
| `provider` | constant | `"claude_code"` — must equal the `AiClientType` value and the registry switch case. |
| `getCapabilities()` | static | Return `ProviderCapabilities`: `supportsSessions`, `supportsStreaming: true`, `supportsRunLookup`, `supportsCancellation: true`, `supportsToolCalls: true`, `supportsPreviousResponse` (set per real capability; do not over-claim). Populate `approval` only if approval is wired. |
| `checkHealth(input?)` | detect Claude Code availability | Probe that the Claude Code binary/SDK is present and runnable; return `ProviderHealth` with `ok`, `provider`, `checkedAt`, `latencyMs`, and a precise `reason` on failure (mirror Hermes's reason strings — actionable, e.g. "Claude Code CLI not found on PATH; install … "). |
| `createSession(input?)` | new run workspace/session | Return a `ProviderSessionRef`. A virtual session (as Hermes does) is acceptable if Claude Code is launched per run; `sessionKey` must round-trip. |
| `startRun(input)` | launch a headless Claude Code run | Build the prompt from `StartRunInput.instructions` + `input` (a `ProviderRunInput`); register Chrona's MCP endpoint scoped to this run (see §6); return a `ProviderRunRef` with a stable `runId`, `status: "running"`, and `stream: { supported: true, reconnectable: <real> }`. Honor `signal`/`timeoutMs`. Record a replay start record when `CHRONA_CLAUDE_CODE_RECORD_DIR` is set (mirror Hermes's `CHRONA_HERMES_RECORD_DIR`). |
| `streamRun(input)` | adapt Claude Code's stream | Yield `ProviderRunEvent`s mapped from Claude Code's streaming output. Map terminal events to `run_completed` / `run_failed` / `run_cancelled` and `return` after a terminal event (as Hermes does). On interrupted stream, throw a **retryable** provider error so the caller can reconnect or reconcile via `getRun`. |
| `getRun(input)` | poll run state | Return a `ProviderRunSnapshot` with `status` (one of the `ProviderRunStatus` enum), `outputText`/`output`, `usage` if available, and `error` on failure. |
| `cancelRun(input)` | terminate the run | Kill/stop the run; return a terminal `ProviderRunSnapshot`. |
| `resolveApproval?(input)` | optional | Implement only if Claude Code exposes an interactive approval surface that Chrona approvals should drive. **It is optional — omit it** if not cleanly supported; do not fake it. |

### Event mapping target (`ProviderRunEvent` discriminated union)

Map Claude Code stream items onto these event `type`s (from
`foundation/src/contracts/provider.ts`): `run_started`, `text_delta`,
`tool_call`, `tool_started`, `tool_completed`, `tool_result`,
`reasoning_delta`, `approval_required`, `run_completed`, `run_failed`,
`run_cancelled`, `raw_event`. Anything unrecognized maps to `raw_event` (do not
drop it). Follow `packages/providers/hermes/src/normalizers.ts` as the pattern
for normalization, and keep an env-gated strict-unknown-event mode like Hermes's
`CHRONA_HERMES_STRICT_UNKNOWN_EVENTS` (use `CHRONA_CLAUDE_CODE_*`).

## 6. Exposing Chrona's tools to the Claude Code run

The agent reports outcomes through Chrona's **existing** MCP tools and
**AI-visible refs** — it must never see backend DB IDs. Concretely:

1. `startRun` configures the spawned Claude Code run with an MCP server pointing
   at this Chrona instance's `/api/mcp` endpoint (mechanism — `.mcp.json`,
   `claude mcp add`, or an Agent SDK option — to be confirmed in the research
   gate and recorded in `plan.md` §0).
2. The MCP connection must be **scoped to this run** so the agent's tool calls
   resolve to the correct task/run via AI-visible refs (the same scoping Hermes
   gets through its plugin). Confirm how Chrona's MCP surface scopes a session
   today and reuse that mechanism — do not add a parallel one.
3. Authentication to `/api/mcp` must use Chrona's existing API-key/bind safety
   (`API_KEY` / bind rules in `apps/server`), not a new auth path.

## 7. In scope / Non-goals

**In scope:** the `packages/providers/claude-code` package; engine registry +
`providers.ts` health wiring; `AiClientType` + `ClaudeCodeClientConfig` in
contracts; Settings → AI Clients entry with diagnose/test; replay-based
deterministic tests; MCP wiring to `/api/mcp`.

**Non-goals (do not do):**
- No task lifecycle / plan progression / retry / projection logic in the
  provider package (engine owns these — milestone §5 rule 3).
- No new agent contract — reuse the MCP tools + AI-visible refs.
- No second provider (Codex etc.). If the abstraction needs changes to fit
  Claude Code, record them so Codex is cheap later.
- No provider-specific logic in `apps/web` beyond the Settings client entry.
- No DB schema migration unless §`data-model.md` concludes one is unavoidable.

## 8. Acceptance criteria (Definition of Done)

- [ ] `packages/providers/claude-code` implements `AgentProviderClient` with no
      change to engine *business* logic (registry/config/health wiring allowed).
- [ ] `bun run typecheck`, `bun run lint` (no new warnings), and
      `bun run check:boundaries` pass.
- [ ] A user can add, **diagnose**, and bind a Claude Code client to
      `dispatch_task` / `execute_task_node` in Settings → AI Clients.
- [ ] A dispatched task/node executes via Claude Code and reports completion
      through Chrona's existing MCP tool contract (AI-visible refs only).
- [ ] Deterministic replay tests pass under `CHRONA_LLM_FIXTURE_MODE=replay`
      in CI (mirroring how Hermes is tested), wired into `test:ci`.
- [ ] The milestone golden path (`docs/en/milestone-0.2.md` §1.3) passes with
      Claude Code as the configured provider. **Acceptance evidence form:**
      CI-replay dry run in
      `packages/providers/claude-code/src/ClaudeCodeProviderClient.bun.test.ts`
      (T10b describe) + manual run with recording per
      [`manual-checklist.md`](./manual-checklist.md) (per `tasks.md` T10:
      "manual run + recording acceptable as evidence").
- [ ] Spec is traceable: each `tasks.md` step names the acceptance item and/or
      verification it satisfies.
