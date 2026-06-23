# Plan 018 — Skill-based provider control plane

Implementation plan for [`spec.md`](./spec.md). File-level, referencing real
symbols verified in the codebase. Work top to bottom; `tasks.md` is the ordered,
testable checklist derived from this plan.

All file:line refs below were verified against the repo at spec-authoring time;
if a symbol has moved, **find the real symbol and update this plan** rather than
coding against a stale ref.

---

## §0. Research / coordination gate (BLOCKING — complete before code)

Do not write the migration until these are confirmed and recorded **in this
section**. Three are about agent runtimes (skill/CLI hosting), one is internal.

### §0.1 — Claude Code skill + CLI hosting surface

- [ ] Confirm, via `claude-code-guide` (NOT training memory — these drift), the
      **current** mechanism to:
      - Mount a skill into a headless `claude -p` / Agent SDK run (directory
        convention, a CLI flag, or an SDK `options` field). Record the exact
        field/flag.
      - Make a bundled CLI available on the run's `PATH` (cwd-relative bin, env
        `PATH` prepend, or skill-bundled executable).
      - Confirm injected process `env` (we set it at `spawn`) is visible to the
        agent's tool shell (Bash tool) — i.e. the agent's `Bash` sees
        `CHRONA_RUN_TOKEN`. This is the load-bearing assumption for claude_code.
- [ ] Record: does mounting a skill *reduce* the per-run context vs MCP
      `tools/list`? Capture the before/after token shape so Acceptance §10's
      "measured context reduction" is real, not assumed.

### §0.2 — Hermes decision for this milestone

- [x] **Decision:** Hermes gateway/API Server stays on `controlPlane: "mcp"` in
      this milestone. Do not implement Hermes skill mode here.
- [x] Rationale: documented Hermes `/v1/runs` accepts `input`, `session_id`,
      `instructions`, `conversation_history`, and `previous_response_id`; it does
      not document per-run env landing or per-run skill preload. Passing
      `CHRONA_RUN_TOKEN` through `instructions` would expose the token to the
      model and session storage. Hermes skills support installed/external skills
      and env passthrough at profile/config/skill-load scope, not a safe
      per-node-attempt token handoff.
- [x] Future options: add a Hermes API Server contract for per-run env + skill
      preload, or design a separate local Hermes CLI provider using
      `hermes chat --skills` / `hermes -z`, where Chrona owns subprocess env.

### §0.3 — Run-token model

- [ ] Decide the run token's binding and validation (spec §7.1). Two options:
      - **(Recommended) Opaque token row** in a small store mapping
        `token → { taskId, nodeAttemptId, sessionId, runtimeRunRef, expiresAt }`,
        minted at run start, validated by the control route. Decide storage in
        `data-model.md` (likely a new lightweight table or reuse of `run`).
      - **(Lighter, weaker)** Reuse the existing `runtimeSessionRef`/`runtimeRunRef`
        as the token and let `resolveInputContext`'s existing `db.run` lookup
        resolve scope. This avoids new storage but couples the token to the
        session ref and offers no expiry/revocation. Acceptable only for a local
        claude_code prototype; production skill mode should use the opaque token
        row.
- [ ] Decide auth: does `POST /agent/control` use `apiKeyAuth()` (the existing
      `API_KEY` Bearer, with the run token in the body) **or** a dedicated
      run-token validator (run token *is* the Bearer)? Recommended: run token is
      the Bearer; the validator resolves scope and authorizes in one step,
      tightening vs today's shared `API_KEY`.

### §0.4 — Gate result

- [ ] All of §0.1 and §0.3 filled; §0.2 is decided as Hermes-MCP-only for this
      milestone.
      **No engine business-logic change may be introduced by the answers**; if
      one appears necessary, stop and surface it (this spec's central
      constraint).

---

## §1. New package: `packages/agent-cli` (the `chrona` CLI)

Bundled control binary the agent runs. Keep it tiny and dependency-light so it
ships inside a skill and starts fast.

```
packages/agent-cli/
  package.json            # name "@chrona/agent-cli", bin: { "chrona": "./dist/chrona.js" } (or src entry for bun)
  src/
    main.ts               # argv parse → subcommand dispatch
    commands/
      node-output.ts
      node-complete.ts
      node-condition-select.ts
      node-wait-complete.ts
      node-block.ts
      node-fail.ts
      task-read.ts
      plan-read.ts
    client.ts             # reads CHRONA_BASE_URL + CHRONA_RUN_TOKEN; POST /agent/control; GET reads
    payloads.ts           # builds the same payload shapes the MCP tools used (mirror dispatch.ts bodies)
    main.test.ts          # arg-parse + payload-construction tests (no network)
```

- **Scope from env only.** `client.ts` reads `CHRONA_BASE_URL` and
  `CHRONA_RUN_TOKEN`; it never accepts a task/node/session id from argv. If
  either env var is missing, exit non-zero with an actionable message (the agent
  surfaces it).
- **Payload parity.** `payloads.ts` must produce, for each terminal kind, the
  exact `payload` the MCP tool produced — cross-reference
  `packages/engine/src/modules/agent-tools/dispatch.ts:35` case bodies:
  - `output` → `{ outputs, mode?, summary? }`
  - `complete` → `{ summary?, input? }` (note: the engine field is `input` for
    the node output on completion — see `complete_manual_node` action,
    `terminalKind: "task"`)
  - `condition_select` → `{ branchRef, summary?, decision?, feedback?, prompt? }`
  - `wait_complete` → `{ summary?, input? }` (`terminalKind: "wait"`)
  - `block` → `{ reason, actionForm? }`
  - `fail` → `{ error }`
- `--output-file` / `--outputs-file` read JSON from disk (the agent writes a file
  then references it) to avoid shell-escaping large JSON on the command line.
- The CLI runtime: prefer a single-file Bun/Node script with **zero runtime deps**
  (use built-in `fetch`, `fs`, `process`). This makes bundling into a skill
  trivial and avoids a node_modules install on the agent host.

## §2. New package: `packages/skills/chrona-node` (the skill)

```
packages/skills/chrona-node/
  SKILL.md                # minimal frontmatter + body (progressive disclosure)
  bin/                     # the bundled chrona CLI (built artifact or symlink to @chrona/agent-cli)
  references/              # optional: per-node-type detail pages the body links to
```

- `SKILL.md` **frontmatter** (the only thing always in context): `name`,
  one-line `description`, `when-to-use` ("you are executing a Chrona plan node").
  Keep it to a few dozen tokens.
- `SKILL.md` **body** (disclosed on open): migrate the *invariant* execution
  instructions — the durable parts of `GENERATE_PLAN_SYSTEM_PROMPT` /
  the node-runtime prose in
  `packages/engine/src/modules/plan-execution/runtime/node-runtime-prompts.ts`
  and `packages/contracts/src/ai-feature-specs.ts` — rewritten to instruct the
  agent to **end the node by running the `chrona` CLI** (with the per-node-type
  terminal verbs from `NODE_RUNTIME_TERMINAL_TOOLS`,
  `node-runtime-prompts.ts:9`). Do **not** bake the dynamic per-node task text
  into the skill; that still arrives via `StartRunInput.instructions`.
- Source-of-truth note: the invariant prose now lives in two places (system
  prompt for MCP mode, skill body for skill mode). To avoid drift, extract the
  shared invariant text into one exported const in `ai-feature-specs.ts` and have
  both the system-prompt builder and the skill build read from it (the skill
  build can generate `SKILL.md` body from that const). Decide the build wiring in
  T-skill.

## §3. Contracts

`packages/contracts/src/ai-feature-types.ts`:

- Add the transport selector to the client config (spec §8):
  ```ts
  export type ControlPlaneMode = "mcp" | "skill";
  ```
  Add `controlPlane?: ControlPlaneMode` (default `"mcp"`) to
  `ClaudeCodeClientConfig`. Hermes stays MCP-only in this milestone; either leave
  `HermesClientConfig` unchanged or only allow `"mcp"` with validation that
  rejects `"skill"` as unsupported.
- If §0.3 chooses the dedicated run-token store, add the token + control-action
  payload types here (or in a focused contracts module) so the CLI, the route,
  and the engine share one definition. Mirror the existing
  `chronaPublicToolPayloadSchemas` shapes (`mcp-task-tools.schema.ts`) so payload
  parity is type-enforced, not hand-maintained.

## §4. Server: run-token mint + control route

### §4.1 Mint the run token at run start

Wherever the run is created and the provider client is invoked
(`packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts` — `invoke()`
creates the `db.run` and has `taskId`, `taskSessionId`, `node.id`,
`nodeAttemptId`, `runtimeSessionKey` in hand, verified), mint the run token and
bind it to that scope (§0.3 storage). Pass the token down to the provider via
the provider config/`StartRunInput` so the `claude_code` provider can inject it
into subprocess env.

- This is the **single place** scope is captured; everything downstream is
  token-resolved. The invoker already knows the full scope — this is wiring, not
  new logic.

### §4.2 The control route

`apps/server/src/routes/` — add a thin route (mirror the thinness of
`apps/server/src/routes/tasks/execution.routes.ts`):

```
POST /agent/control
```

- Auth: run-token validator (§0.3) — reject unknown/expired tokens.
- Resolve `{ taskId, nodeAttemptId, sessionId, workspaceId }` from the token.
  Reuse the resolution shape of
  `packages/engine/src/modules/agent-tools/operations.ts:157`
  (`resolveInputContext`) — extract its session→task lookup into a shared helper
  if needed so both MCP and skill paths use one resolver.
- Map `{ kind, payload }` → `submitNodeResult({ taskId, commandContext, action })`
  using the **same** action construction as
  `packages/engine/src/modules/agent-tools/dispatch.ts:35`. Factor that
  `toolName → action` mapping into a shared function callable from both the MCP
  dispatch and the new route, so the two transports cannot diverge.
- On terminal kinds, **record the terminal-action** (§5.1) before/within the same
  transaction as `submitNodeResult`.
- Return a small JSON ack: `{ ok: true, kind }` or `{ ok: false, error }`.
- Read commands (`task read`, `plan read`): either fold into `/agent/control`
  with read `kind`s, or let the CLI call the existing read routes with the run
  token. Prefer routing reads through the same token-scoped surface for one auth
  point.

## §5. Engine: terminal-action record + recorded-action result builder

### §5.1 Record the terminal action

When the control route processes a terminal kind, persist
`{ nodeAttemptId, kind, payload, recordedAt }` (§0.3 / `data-model.md` decide
storage — could be a column/JSON on the node-attempt or run row, or a small
table). Keyed by `nodeAttemptId` (the attempt the token is bound to).

### §5.2 Recorded-action result builder

`packages/engine/src/modules/plan-execution/runtime/node-ai-capabilities.ts`:

- Add `terminalNodeResultFromRecordedAction(input)` as a sibling to the existing
  `terminalNodeResultFromSnapshot` (`node-ai-capabilities.ts:55`+). It reads the
  recorded terminal action for `input.attempt.id` and returns the **same**
  `NodeExecutionResult` union the snapshot path returns:
  - `complete` / `wait_complete` → `{ status: "done", output, summary, evidence }`
  - `condition_select` → condition selection result (mirror
    `conditionSelectionResultFromSnapshot`)
  - `block` → `{ status: "blocked", reason, evidence }`
  - `fail` → `{ status: "failed", error, evidence }`
  - none recorded → `undefined` (same semantics as snapshot returning undefined).
- In the result-resolution call site (where `terminalNodeResultFromSnapshot` is
  invoked after a run ends), branch on the client's `controlPlane`:
  - `"skill"` → `terminalNodeResultFromRecordedAction`
  - `"mcp"` → `terminalNodeResultFromSnapshot` (unchanged)
  Thread the mode through `NodeAiCapabilityInput` (it already carries
  client/runtime context — add the flag there).

### §5.3 Do not delete the snapshot path

Keep `terminalToolNameFromSnapshot` and `terminalNodeResultFromSnapshot` intact
for MCP mode until every provider is migrated (spec §8). This spec adds a
parallel path; it does not remove the old one.

## §6. Provider injection

### §6.1 claude_code (`packages/providers/claude-code`)

- `ClaudeCodeProviderClient.buildRunner` / `startRun`
  (`ClaudeCodeProviderClient.ts:260`): when `controlPlane === "skill"`, populate
  `cfg.env` with `CHRONA_BASE_URL` and `CHRONA_RUN_TOKEN` (from §4.1), and add the
  skill-mount flag/option confirmed in §0.1. When `"mcp"`, keep the current MCP
  server registration unchanged.
- `runner.ts:278` already spreads `cfg.env` into the spawn — no change there
  beyond ensuring the new vars are in `cfg.env`.
- Ensure the `chrona` CLI + skill dir are present on the run's filesystem/`PATH`
  (§0.1 decision). Since claude_code runs on Chrona's host, this can be a known
  install path or a path bundled with the provider package.

### §6.2 hermes (`packages/providers/hermes`)

- Keep Hermes on the existing MCP plugin path for this milestone.
- Do **not** add `chrona_base_url` or `chrona_run_token` to `HermesRunBody`, and
  do not place run tokens in `instructions`.
- If web/settings accepts provider config for Hermes, reject or hide
  `controlPlane: "skill"` with a clear unsupported-provider message until a
  documented Hermes per-run env + skill preload contract exists.

### §6.3 debug (`packages/providers/debug`)

- For deterministic tests, the debug provider in skill mode should drive the
  control path (or call `submitNodeResult` directly) to simulate the agent's CLI
  calls, so the recorded-action + runtime-fork logic is testable without a real
  agent. Mirror how debug already simulates provider runs.

## §7. Web: Settings → AI Clients

`apps/web/src/components/settings/ai-clients-manager.tsx` (already in this
branch's working set): add a `controlPlane` selector (`mcp` / `skill`) for
`claude_code`. Hermes should either show MCP-only disabled state or reject
`skill` with a clear unsupported-provider message. No protocol logic in web — it
only reads/writes/validates the client record field. Default `mcp`.

## §8. Tests (deterministic, CI-gated)

- **CLI unit** (`packages/agent-cli/src/main.test.ts`): argv → correct payload
  for every subcommand; missing env → non-zero exit; `--output-file` JSON load.
  Assert payload parity against the dispatch.ts shapes (import the shared payload
  builder from §4.2 so parity is enforced).
- **Route** (server test): `POST /agent/control` with a valid token resolves
  scope and calls `submitNodeResult` with the right action; a token bound to task
  A cannot affect task B; unknown/expired token → 401/403.
- **Recorded-action builder** (engine test): each recorded kind →
  the right `NodeExecutionResult`; none recorded → `undefined`.
- **Runtime fork** (engine test): `controlPlane: "skill"` reads the recorded
  action; `"mcp"` reads the snapshot — both yield equivalent graph advancement on
  the debug provider.
- Wire into the `ci` test entry in `scripts/chrona.ts` under the existing fixture
  mode. Mirror Hermes/Claude-Code replay test wiring (`specs/017` §6).

## §9. Sequencing

1. §0 gate (blocking for claude_code: §0.1 and §0.3; §0.2 already records Hermes
   MCP-only for this milestone).
2. §3 contracts (`controlPlane` for claude_code + shared payload/token types) —
   unblocks typing everywhere.
3. §1 `chrona` CLI + §8 CLI tests (TDD; no agent needed).
4. §4 run-token mint + `/agent/control` route + route tests.
5. §5 terminal-action record + recorded-action builder + runtime fork + engine
   tests.
6. §2 skill package (body migrated from the shared invariant const).
7. §6 provider injection (`claude_code` only; Hermes MCP-only validation/doc).
8. §7 Settings selector.
9. Golden-path validation with claude_code in skill mode; measure + record
   context reduction (Acceptance §10).
10. Per-provider, flip default and (later spec) remove MCP path.

## §10. Risks

- **Hermes gateway can't land run-scoped env.** Decision: Hermes stays on MCP in
  this milestone. Future work requires a documented Hermes API extension or a
  separate local CLI provider.
- **Terminal-action vs run-end race (spec §7.1).** Mitigation: the agent's
  terminal CLI call commits before its turn ends; if no record exists at run-end,
  reuse the existing "not completed" handling. Add a test that asserts the record
  exists post-run for the debug provider.
- **Payload drift between MCP and CLI.** Mitigation: one shared `kind → action`
  mapping + shared payload schemas (§4.2); both transports import it. Never
  hand-copy the dispatch bodies.
- **Skill body / system-prompt drift.** Mitigation: single exported invariant
  const feeds both (§2). The skill `SKILL.md` body is generated from it, not
  forked.
- **CLI not on PATH / env not visible in the agent's shell.** This is the whole
  claude_code premise; nail it in §0.1 with a smoke test that runs
  `chrona node fail --error probe` from inside a real Claude Code skill-mode run
  and asserts the engine recorded it.
- **Token leakage.** The run token authorizes mutations on one task. Keep it
  run-scoped + short-lived (§0.3), never log it, and prefer the dedicated-token
  store with expiry over reusing a long-lived session ref.
