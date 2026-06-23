# Plan 017 — Claude Code execution provider

Implementation plan for [`spec.md`](./spec.md). File-level, referencing the real
symbols verified in the codebase. Work top to bottom; `tasks.md` is the ordered,
testable checklist derived from this plan.

---

## §0. Research gate (BLOCKING — complete before any code)

Do not write the adapter until these are confirmed and recorded **in this
section**. Source: official Claude Code / Agent SDK docs fetched 2026-06-13
(via `claude-code-guide`-style doc sweep; the dedicated `claude-code-guide`
subagent was unavailable due to provider quota, so this section was filled
by fetching the docs directly). The `claude-api` skill does **not** cover
the Claude Code CLI/Agent SDK.

> **Convention used below:** UNVERIFIED = could not confirm from fetched
> docs; treat as assumption to be revisited when SDK details settle.

### §0.1 — Invocation surface

- [x] **Decision:** Use the **Claude Agent SDK** for TypeScript
      (`@anthropic-ai/claude-agent-sdk`) as the primary driver. The SDK is a
      typed wrapper over the `claude -p` subprocess and is the documented
      recommendation for programmatic Node/Bun use. Fall back to spawning
      `claude -p` directly only if the SDK package cannot be installed in
      this workspace (we will verify in T2).
      - Entry: `query({ prompt, options })` returns an `AsyncIterable<SDKMessage>`.
      - Also exports `ClaudeSDKClient` for stateful/multi-turn cancellation.
      - Subprocess escape hatch: `claude -p --output-format stream-json
        --verbose --include-partial-messages` (the `--include-partial-messages`
        flag is what unlocks token-level deltas in `stream_event`).
      - Sources: docs at `code.claude.com/docs/en/cli-reference`,
        `…/agent-sdk/typescript`, `…/agent-sdk/streaming-output`,
        `…/headless`, `…/agent-sdk/sdk-overview`.
      - UNVERIFIED: exact current SDK npm version (npmjs.com returned 403
        during doc fetch); pin to `"@anthropic-ai/claude-agent-sdk":
        "latest"` for T2 and lock once installed.

### §0.2 — Streaming format (CLI `--output-format stream-json` + SDK)

- [x] **Mapping table** (Claude Code `type` → Chrona `ProviderRunEvent.type`).
      Source: SDK TypeScript reference + `agent-sdk/streaming-output` pages.

  | Claude Code stream item | Chrona `ProviderRunEvent.type` |
  | --- | --- |
  | `system` / `subtype: "init"` | `run_started` (carry `session_id`, `model`, `tools[]`, `mcp_servers[]` in raw) |
  | `system` / `subtype: "status"` (e.g. `compacting`) | `raw_event` |
  | `assistant` message with `content[].type === "text"` block | emit one `text_delta` per text block, then a follow-up `raw_event` carrying the full block |
  | `assistant` message with `content[].type === "tool_use"` block | `tool_call` (then `tool_started` on first delta) |
  | `stream_event` / `content_block_start` (`content_block.type === "tool_use"`) | `tool_started` (id from `index`+block id) |
  | `stream_event` / `content_block_delta` / `text_delta` | `text_delta` |
  | `stream_event` / `content_block_delta` / `input_json_delta` | append into the in-flight `tool_call.input` buffer; emit `raw_event` per delta for completeness |
  | `stream_event` / `content_block_stop` (after `tool_use`) | `tool_completed` |
  | `user` message with `content[].type === "tool_result"` block | `tool_result` (carry `tool_use_id`, `is_error`, content) |
  | `stream_event` / `message_delta` carrying reasoning/thinking | `reasoning_delta` (UNVERIFIED — Anthropic thinking deltas are wrapped in `stream_event`; treat as `text_delta` if shape is plain text, `raw_event` otherwise) |
  | `result` / `subtype: "success"` | `run_completed` (map `result`, `total_cost_usd`, `usage`, `stop_reason`) |
  | `result` / `subtype: "error_max_turns" \| "error_max_budget_usd" \| "error_max_structured_output_retries"` | `run_failed` (carry `errors[]`, `stop_reason`) |
  | `result` / `subtype: "error_during_execution"` (and adapter initiated cancel) | `run_cancelled` if cancel was requested, else `run_failed` |
  | `approval_required` / `permission_prompt` mid-stream | `approval_required` (UNVERIFIED — only emitted when mode ≠ `bypassPermissions`; we will not set that mode in the adapter) |
  | Anything unrecognized | `raw_event` (do not drop) |

  Validator: every emitted `ProviderRunEvent` is parsed with
  `providerRunEventSchema.parse()` in dev (Hermes pattern). A
  `CHRONA_CLAUDE_CODE_STRICT_UNKNOWN_EVENTS=1` env switch mirrors
  `CHRONA_HERMES_STRICT_UNKNOWN_EVENTS` and throws on unrecognized `type`.

### §0.3 — MCP registration (run-level scope)

- [x] **Mechanism:** SDK `query({ options: { mcpServers: { chrona: {…} } } })`
      accepts the same JSON shape as `--mcp-config`. Format per run:
      ```jsonc
      {
        "mcpServers": {
          "chrona": {
            "type": "http",
            "url": "<chronaBaseUrl>/api/mcp",
            "headers": { "Authorization": "Bearer <run-scoped token>" }
          }
        }
      }
      ```
      - **Verified against `@anthropic-ai/claude-agent-sdk@0.3.177`**
        (`node_modules/.../sdk.d.ts`):
        `Options.mcpServers?: Record<string, McpServerConfig>` where
        `McpServerConfig` includes `McpHttpServerConfig { type: 'http', url, headers?, tools?, timeout?, alwaysLoad? }`.
        Both `url` and `headers` are wired through unchanged.
      - **Run-scoping is enforced** by passing `mcpServers` in the per-call
        options (no `claude mcp add`); for the CLI fallback we also pass
        `--strict-mcp-config` to ignore any user-global `~/.claude.json` MCP
        registrations. UNVERIFIED that `--mcp-config` itself never persists
        to `~/.claude.json`; `--strict-mcp-config` is the explicit lock.
      - `allowedTools` is set to `["mcp__chrona__*"]` (or the resolved tool
        names recorded in `system.init.tools`) so the Chrona MCP tools are
        the only ones the agent can call — keeps the agent on the Chrona
        contract.
      - The `Authorization: Bearer <token>` is a per-run token minted by the
        server, reusing Chrona's existing MCP auth path (no new auth surface).
      - Source: `code.claude.com/docs/en/mcp`, `…/cli-reference`,
        `…/agent-sdk/tool-search`.

### §0.4 — Approval surface

- [x] **Decision:** **Omit `resolveApproval` for v0.2.** The adapter launches
      Claude Code with `permissionMode: "bypassPermissions"` (SDK option) or
      `--permission-mode bypassPermissions` (CLI fallback). Reasoning:
      - The doc-stated goal of `bypassPermissions` is exactly "CI / automated
        environments that must not hang on a prompt." It does not pause.
      - The Chrona Inbox flow already exists for the cases that genuinely
        need a human (milestone §1.3 — "if a node blocks / needs approval,
        an Inbox item explains WHY"). A `permission_prompt` from Claude Code
        is an agent-tool-level approval (Bash, file edit), not a Chrona
        task/plan approval — we intentionally route that through Chrona's
        policy engine, not Claude Code's permission system.
      - The SDK does expose `PreToolUse` hooks, but using them would either
        re-implement Chrona's approval surface inside the adapter (out of
        scope per spec §7) or duplicate the bypass-mode behavior.
      - `--allowedTools` is used to **scope** the tool surface (see §0.3),
        not to model approvals.
      - `resolveApproval` is optional on the interface; omitting it is
        allowed and explicit per the spec.
      - This decision is recorded here so a future spec (v0.3) can add a
        real `PreToolUse`-driven approval bridge if the Inbox surface
        proves insufficient.

### §0.5 — Cancellation

- [x] **Mechanism:**
      - **SDK path (default):** `query({ prompt, options })` returns a
        `Query` object that **extends `AsyncGenerator<SDKMessage, void>` and
        has an `interrupt(): Promise<void>` method** (verified against
        `@anthropic-ai/claude-agent-sdk@0.3.177`,
        `node_modules/.../sdk.d.ts:2230`). The runner keeps the `Query`
        reference in the run handle. On `cancelRun` we call
        `query.interrupt()`; the generator's `return()` cleans up the
        subprocess. A `cancelRequested` flag is also stored in the handle
        so the normalizer can map the terminal `error_during_execution`
        result to `run_cancelled`.
      - **CLI fallback:** SIGTERM the spawned subprocess; the `claude -p`
        child exits with `result`/`subtype: "error_during_execution"`.
      - **Terminal mapping:** the adapter tracks a `cancelRequested` flag.
        When a `result` with `subtype: "error_during_execution"` arrives,
        map to `run_cancelled` if the flag is set, else `run_failed`. The
        snapshot returned from `cancelRun` is built from the captured event
        tail (Hermes pattern).
      - Note: docs we initially fetched mentioned `ClaudeSDKClient` with
        `.interrupt()` and `.receive_response()` — in the installed
        `0.3.177` SDK the equivalent is the `Query` object returned by
        `query()` itself. The `Query` shape is what the runner uses.
      - Source: `code.claude.com/docs/en/agent-sdk/typescript`,
        installed SDK `sdk.d.ts` `Query` interface.

### §0.6 — Local vs Managed Agents

- [x] **Decision: local headless is the default.** Confirmed by the
      "Agent SDK vs Managed Agents" comparison in the docs: local SDK is
      the documented path for agents that operate on the user's filesystem
      and local services — exactly Chrona's use case.
      - Only constraint noted: starting **2026-06-15**, subscription users
        get a monthly quota for SDK/`claude -p` usage; production users
        should configure an API key (we will surface this in the Settings
        UI help text, not block on it).
      - Branding: "your product should maintain its own branding and not
        appear to be Claude Code" — no risk; Chrona is its own product.
      - No Managed Agents fallback is justified; the spec's 8-method
        contract is fully satisfiable locally.
      - Source: `docs.anthropic.com/en/docs/claude-code/sdk` (comparison
        table + license/quota section).

### §0.7 — Gate result

All six checkboxes above are now filled. **No abstraction problem surfaced
that would require an engine change**; everything fits inside the provider
package boundary (milestone §5 rule 3).

**Proceed to T1** only after the human reviews the runner.ts seam shape and
the omitted-`resolveApproval` decision.

---

## §1. New package: `packages/providers/claude-code`

Mirror `packages/providers/hermes` structure; `packages/providers/debug` is the
minimal template.

```
packages/providers/claude-code/
  package.json            # name "@chrona/claude-code", dep @chrona/providers-foundation: workspace:*
  src/
    index.ts              # export { ClaudeCodeProviderClient }, types
    ClaudeCodeProviderClient.ts   # implements AgentProviderClient
    runner.ts             # spawn/drive Claude Code headless (or SDK) — the IO seam
    normalizers.ts        # Claude Code stream item -> ProviderRunEvent / ProviderRunSnapshot
    types.ts              # ClaudeCodeProviderConfig, ClaudeCodeProviderError
    ClaudeCodeProviderClient.bun.test.ts  # replay-based tests
```

- `package.json`: copy `packages/providers/debug/package.json`; set
  `"name": "@chrona/claude-code"`, keep `"@chrona/providers-foundation": "workspace:*"`,
  `"exports": { ".": "./src/index.ts" }`, `"private": true`, `"type": "module"`.
  Register the workspace package in the root `package.json`/`bun` workspace globs
  if providers are not auto-globbed (verify against how `hermes`/`debug` are
  picked up).
- Import all schemas/types/replay helpers from `@chrona/providers-foundation`
  (`AgentProviderClient`, `StartRunInput`, `ProviderRunEvent`,
  `ProviderRunSnapshot`, `providerRunEventSchema`, `appendProviderReplayRecord`,
  `providerReplayRecord`, `replayPathForRun`, `terminalSnapshotFromEvents`, …).
- Keep all Claude Code protocol/transport knowledge **inside this package**
  (milestone §5 rule 3). No Chrona task/plan/schedule semantics here.

### `ClaudeCodeProviderClient.ts`

Implement the 8-method interface per spec §5. Concretely:

- `readonly provider = "claude_code"`.
- Constructor takes a `ClaudeCodeProviderConfig` (binary path/SDK options, model,
  timeout, MCP endpoint base URL + API key). Read the replay record dir from
  `CHRONA_CLAUDE_CODE_RECORD_DIR` (mirror Hermes's `CHRONA_HERMES_RECORD_DIR`).
- `startRun`: build prompt from `instructions` + `input`; configure the Chrona
  MCP server for the run (spec §6); return `ProviderRunRef`; append a replay
  start record when recording.
- `streamRun`: async generator mapping runner output via `normalizers.ts`;
  append replay event records; `return` on terminal events; throw a **retryable**
  `ClaudeCodeProviderError` on interrupted streams.
- `getRun` / `cancelRun`: snapshot/terminate via `runner.ts`.
- `resolveApproval`: include only if the research gate confirmed an approval
  surface; otherwise omit (it is optional on the interface).

### `runner.ts`

The only place that touches the Claude Code process/SDK and the filesystem/MCP
config. Everything above it works in terms of foundation types. This isolation
is what makes the adapter testable via replay without spawning Claude Code.

### `normalizers.ts`

Pure functions: Claude Code stream item → `ProviderRunEvent`; run state →
`ProviderRunSnapshot`. Validate emitted events against `providerRunEventSchema`
in dev (Hermes pattern). Unknown items → `raw_event`.

---

## §2. Contracts: `packages/contracts/src/ai-feature-types.ts`

- Extend the union:
  `export type AiClientType = "llm" | "hermes" | "debug" | "claude_code" | (string & {});`
- Add a config interface next to `HermesClientConfig`:
  ```ts
  export interface ClaudeCodeClientConfig {
    binaryPath?: string;   // override Claude Code CLI location
    model?: string;        // default "claude-opus-4-8"
    timeoutMs?: number;
    mcpBaseUrl?: string;   // Chrona /api/mcp base (defaults to this server)
    // add only fields the research gate proves necessary
  }
  ```
- Add `ClaudeCodeClientConfig` to the `AiClientRecord.config` union and export it
  from `packages/contracts/src/index.ts` (alongside `HermesClientConfig`).
- Do **not** change `AiFeature` — `dispatch_task` / `execute_task_node` already
  exist as bind targets.

## §3. Engine wiring

### `packages/engine/src/modules/ai/runtime/client-registry.ts`

In `createProviderClient(record)`, add:

```ts
if (record.type === "claude_code") {
  const config = record.config as ClaudeCodeClientConfig;
  return new ClaudeCodeProviderClient({ /* map config */ });
}
```

Import `ClaudeCodeProviderClient` from `@chrona/claude-code`. Add an
`EngineClaudeCodeClient` type alongside `EngineHermesClient` if the pattern calls
for it. **No other engine logic changes** — the registry already routes
`requireProviderClient`, `dispatch_task`, etc. through `AgentProviderClient`.

### `packages/engine/src/modules/ai/providers.ts`

Add a `checkClientHealth` branch for `client.type === "claude_code"` that calls
the provider's `checkHealth()` and maps the result to the `{available, reason}`
shape used there (mirror the Hermes branch, including actionable reason strings).

## §4. Server / MCP

- Confirm `/api/mcp` (streamable HTTP) and its session scoping in
  `apps/server/src/routes` and reuse it for the Claude Code run (spec §6).
- Reuse existing `API_KEY` / bind safety; do not add a new auth path.
- If a lightweight "diagnose Claude Code" endpoint is needed for the Settings
  action, add a thin route that calls the engine, keeping the route thin
  (milestone §5 rule 1) — mirror the Hermes diagnose route.

## §5. Web: Settings → AI Clients

- Add a "Claude Code" option to the Add Client flow (mirror the Hermes client
  form in `apps/web/src/components/settings/ai-clients-manager.tsx`).
- Fields from `ClaudeCodeClientConfig`; a **Diagnose / Test availability** action
  that calls the health/diagnose path; bind to `dispatch_task` /
  `execute_task_node` (optionally `generate_plan`).
- No provider protocol logic in the web layer — it only reads/writes the client
  record and shows health (milestone §5 rules 1 & 5).

## §6. Tests (replay-based, deterministic, CI-gated)

- Record real Claude Code run tapes once into `CHRONA_CLAUDE_CODE_RECORD_DIR`,
  commit them as fixtures (mirror the Hermes fixture approach).
- `ClaudeCodeProviderClient.bun.test.ts`: drive the client against tapes via the
  foundation replay helpers (`readProviderReplayTape`, `terminalSnapshotFromEvents`),
  asserting the event mapping and terminal snapshot — no real Claude Code spawn.
- Wire these into the `ci` test entry in `scripts/chrona.ts` so they run under
  `CHRONA_LLM_FIXTURE_MODE=replay` like the existing LLM fixtures.
- Add an engine-level test that `createProviderClient` returns the Claude Code
  client for a `claude_code` record.

## §7. Sequencing

1. §0 research gate (blocking).
2. §2 contracts (unblocks engine + web typing).
3. §1 package skeleton + `runner.ts` seam + `normalizers.ts` + client (TDD
   against recorded tapes from §6).
4. §3 engine registry + health wiring.
5. §4 MCP wiring + diagnose route.
6. §5 Settings UI.
7. §6 finalize tests + CI wiring.
8. Golden-path validation with Claude Code as provider (milestone §1.3).

## §8. Risks

- **Research-gate answers change the shape of `runner.ts`.** Keep all process/SDK
  specifics behind `runner.ts` so the rest of the package is stable regardless.
- **MCP run-scoping.** If Chrona's MCP surface can't currently scope a session to
  a specific run for an externally-launched agent, that is the hardest part —
  surface it early; it may need a (thin) server change, which is acceptable only
  if it stays in the server/engine boundary and is documented.
- **Determinism.** If Claude Code output isn't capturable as a stable tape,
  tests will be flaky — solve at the `runner.ts` seam (record/replay) before
  building UI.
