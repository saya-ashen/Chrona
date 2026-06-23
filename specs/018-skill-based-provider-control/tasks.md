# Tasks 018 — Skill-based provider control plane

Ordered, testable checklist derived from [`plan.md`](./plan.md). Each task names
the acceptance item (spec §10) and/or the plan section it satisfies. Do them in
order; a task is done only when its **Verify** passes.

Legend: **AC-n** = Acceptance criterion n in `spec.md` §10.

---

## T0 — Research / coordination gate (BLOCKING)

> Satisfies: plan §0. Nothing below starts until T0 is recorded in `plan.md` §0.

- [ ] **T0.1** Confirm claude_code skill-mount + CLI-on-PATH + env-visible-in-
      agent-shell surface via `claude-code-guide`. Record exact flag/field in
      `plan.md` §0.1.
- [x] **T0.2** Hermes gateway/API Server stays on `controlPlane: "mcp"` this
      milestone. Record future paths only: documented per-run env + skill preload
      API extension, or separate local Hermes CLI provider.
- [ ] **T0.3** Decide run-token binding/validation + control-route auth; record in
      `plan.md` §0.3 and finalize storage in `data-model.md`.
- **Verify:** `plan.md` §0.1 and §0.3 have no open UNVERIFIED on load-bearing
  claude_code items; §0.2 explicitly says Hermes is MCP-only for this milestone.
  No answer introduces an engine business-logic change.

## T1 — Contracts: `controlPlane` flag + shared types

> Satisfies: AC-6; plan §3.

- [ ] **T1.1** Add `ControlPlaneMode = "mcp" | "skill"` and
      `controlPlane?: ControlPlaneMode` (default `"mcp"`) to
      `ClaudeCodeClientConfig` in `packages/contracts/src/ai-feature-types.ts`;
      export from `packages/contracts/src/index.ts`. Hermes remains MCP-only;
      reject or hide `skill` for Hermes config until a future spec enables it.
- [ ] **T1.2** Add the control-action payload types (`kind` + per-kind `payload`)
      mirroring `chronaPublicToolPayloadSchemas` in
      `packages/contracts/src/api/mcp-task-tools.schema.ts`, plus the run-token
      type if §0.3 chose the dedicated store.
- **Verify:** `bun run typecheck` passes; the new payload schemas structurally
  match the `dispatch.ts` case bodies (add a type-level test or a comment-linked
  assertion).

## T2 — `chrona` CLI package (no agent needed)

> Satisfies: AC-1; plan §1.

- [ ] **T2.1** Scaffold `packages/agent-cli` (`@chrona/agent-cli`, `bin.chrona`,
      zero runtime deps, ESM).
- [ ] **T2.2** `client.ts`: read `CHRONA_BASE_URL` + `CHRONA_RUN_TOKEN` from env;
      `POST <base>/agent/control` with `Authorization: Bearer <token>`; non-zero
      exit + actionable message when env missing. **Never** read an id from argv.
- [ ] **T2.3** `payloads.ts` + `commands/*`: implement `node output|complete|
      condition-select|wait-complete|block|fail`, `task read`, `plan read` using
      the shared payload types from T1.2. `--output-file/--outputs-file` load JSON
      from disk.
- [ ] **T2.4** `main.test.ts`: argv → payload parity for every subcommand; missing
      env → non-zero; file-load path. No network.
- **Verify:** `bun test packages/agent-cli` green; manually
  `CHRONA_BASE_URL=… CHRONA_RUN_TOKEN=… chrona node fail --error x` builds the
  expected request (assert via a local stub server in the test).

## T3 — Run-token mint at run start

> Satisfies: AC-3; plan §4.1.

- [ ] **T3.1** In
      `packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts`
      (`invoke()`), mint the run token bound to
      `{ taskId, taskSessionId, node.id, nodeAttemptId, runtimeSessionKey }`
      (storage per §0.3) and pass it to the provider via config/`StartRunInput`.
- **Verify:** engine test asserts a token is minted per run and resolves back to
  the exact scope; token for run A does not resolve to run B's scope.

## T4 — `POST /agent/control` route + shared resolver/mapper

> Satisfies: AC-3; plan §4.2.

- [ ] **T4.1** Extract the session→task resolution from
      `operations.ts:157` (`resolveInputContext`) into a shared helper usable by
      both MCP and the new route.
- [ ] **T4.2** Extract the `toolName/kind → submitNodeResult action` mapping from
      `dispatch.ts:35` into a shared function; refactor MCP dispatch to call it
      (no behavior change to MCP).
- [ ] **T4.3** Add `apps/server/src/routes/.../agent-control.routes.ts`:
      run-token auth → resolve scope → shared mapper → `submitNodeResult` →
      record terminal action (T5.1) → JSON ack. Keep the route thin.
- **Verify:** server test — valid token drives the right action; task-A token
  cannot mutate task B (returns error, no state change); unknown/expired token →
  401/403; MCP dispatch tests still green after the T4.2 refactor.

## T5 — Terminal-action record + recorded-action result builder

> Satisfies: AC-4; plan §5.

- [ ] **T5.1** Persist `{ nodeAttemptId, kind, payload, recordedAt }` on terminal
      kinds within the control-route transaction (storage per `data-model.md`).
- [ ] **T5.2** Add `terminalNodeResultFromRecordedAction(...)` beside
      `terminalNodeResultFromSnapshot` in
      `packages/engine/src/modules/plan-execution/runtime/node-ai-capabilities.ts`;
      same `NodeExecutionResult` union; none-recorded → `undefined`.
- [ ] **T5.3** Fork the result-resolution call site on the client's
      `controlPlane` (thread the flag via `NodeAiCapabilityInput`):
      `"skill"` → recorded-action; `"mcp"` → snapshot (unchanged).
- **Verify:** engine tests — each recorded kind → correct result; none → undefined;
  the fork yields equivalent graph advancement for skill vs mcp on the debug
  provider. `terminalToolNameFromSnapshot` untouched (AC: MCP path intact).

## T6 — `chrona-node` skill package

> Satisfies: AC-2; plan §2.

- [ ] **T6.1** Extract the invariant execution prose into one exported const in
      `packages/contracts/src/ai-feature-specs.ts`; have the existing
      system-prompt builder read from it (no behavior change to MCP prompts).
- [ ] **T6.2** Create `packages/skills/chrona-node/SKILL.md`: minimal frontmatter;
      body generated from / derived from the T6.1 const, rewritten to instruct
      ending a node via the `chrona` CLI with the per-node-type verbs from
      `NODE_RUNTIME_TERMINAL_TOOLS` (`node-runtime-prompts.ts:9`).
- [ ] **T6.3** Bundle the `chrona` CLI into the skill (`bin/`), built from
      `@chrona/agent-cli`.
- **Verify:** skill frontmatter is minimal (record token count); body covers all
  terminal verbs and never embeds dynamic per-node task text; a lint/check that
  the body and the T6.1 const have not drifted.

## T7 — Provider injection

> Satisfies: AC-4, AC-5; plan §6.

- [ ] **T7.1** claude_code: in `ClaudeCodeProviderClient` set `cfg.env`
      `CHRONA_BASE_URL`/`CHRONA_RUN_TOKEN` + skill mount when
      `controlPlane==="skill"`; keep MCP registration when `"mcp"`. Ensure CLI +
      skill on the run's filesystem/PATH (§0.1).
- [ ] **T7.2** hermes: keep existing MCP plugin path unchanged; do not add
      `chrona_base_url`/`chrona_run_token` to `HermesRunBody`; reject or hide
      `controlPlane: "skill"` for Hermes with a clear unsupported-provider
      message.
- [ ] **T7.3** debug: simulate the agent's terminal CLI calls through the control
      path (or direct `submitNodeResult`) for deterministic skill-mode tests.
- **Verify:** claude_code skill-mode integration (replay/fixture or debug-backed):
  a node executes, the CLI is invoked, the engine advances via the recorded-action
  path. Hermes MCP path remains clean and unchanged.

## T8 — Web: control-plane selector

> Satisfies: AC-6; plan §7.

- [ ] **T8.1** Add a `controlPlane` (`mcp`/`skill`) selector for claude_code in
      `apps/web/src/components/settings/ai-clients-manager.tsx`; default `mcp`;
      read/write the record field only. Hermes should show MCP-only disabled
      state or reject `skill` with the same unsupported-provider message.
- **Verify:** existing `ai-clients-manager.test.tsx` updated/green; selecting a
  mode persists to the client record; no protocol logic in web.

## T9 — End-to-end skill-mode golden path + context measurement

> Satisfies: AC-7, AC-8; plan §9.

- [ ] **T9.1** Run the milestone golden path with claude_code in skill mode (or a
      faithful debug-backed stand-in if a real run isn't reproducible in CI),
      asserting the graph advances from recorded actions.
- [ ] **T9.2** Measure per-run context size skill vs mcp (from §0.1's before/after
      shape) and record the reduction in this spec's acceptance evidence.
- [ ] **T9.3** Add a smoke test: from inside a real Claude Code skill-mode run,
      the bundled `chrona` CLI finds its env, reaches `/agent/control`, and the
      engine records the action (proves the §0.1 premise end-to-end).
- **Verify:** golden path green under `CHRONA_LLM_FIXTURE_MODE=replay` in
  `test:ci`; context reduction recorded; smoke test green.

## T10 — Gates + traceability

> Satisfies: AC-7, AC-9.

- [ ] **T10.1** `bun run typecheck`, `bun run lint` (no new warnings),
      `bun run check:boundaries` all pass.
- [ ] **T10.2** Each task above references its AC / plan section (this file);
      confirm no acceptance item is unclaimed.
- **Verify:** all gates green; spec §10 checklist fully satisfied with evidence
  links.

---

## Coexistence / non-removal reminder

This milestone **adds** the skill path behind `controlPlane` for `claude_code`
and leaves the MCP path (routes, `terminalToolNameFromSnapshot`, hermes plugin)
fully functional. Hermes stays MCP-only until a future spec adds a safe Hermes
handoff. Removal of the MCP path is a **later spec**, gated on every target
provider passing its skill-mode golden path. Do not delete MCP code here.
