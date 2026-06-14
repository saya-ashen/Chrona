# Data model 018 — Skill-based provider control plane

Storage decisions for [`spec.md`](./spec.md) / [`plan.md`](./plan.md). Two new
pieces of state: the **run token** (scope binding) and the **terminal-action
record** (the skill-mode analog of `ProviderRunSnapshot.raw.terminalTool`). Both
are decided in the §0.3 research gate; this file holds the options and the
chosen design.

> **Guiding constraint:** no engine *business-logic* change. These stores are
> transport/attribution state, not plan/execution semantics. If a chosen design
> forces a change to plan-execution logic, stop and surface it.

---

## 1. Run token

Binds an opaque token to one node attempt's scope so the `chrona` CLI can act
without the agent naming any id (spec §7.1 / Pillar C).

### Option A — Dedicated token store (recommended)

A small table (or KV row) minted at run start in
`ai-runtime-invoker.invoke()` and validated by `POST /agent/control`.

| Field | Type | Notes |
| --- | --- | --- |
| `token` | string (opaque, high-entropy) | The Bearer the CLI sends. Index/PK. Never logged. |
| `taskId` | string | Resolved scope. |
| `nodeAttemptId` | string | The attempt this run executes; terminal-action record key. |
| `sessionId` / `runtimeSessionKey` | string | For parity with `resolveInputContext`. |
| `runtimeRunRef` | string? | The `db.run` ref, for cross-checking. |
| `expiresAt` | datetime | Short-lived; expired tokens rejected. |
| `revokedAt` | datetime? | Optional explicit revoke on run end/cancel. |
| `createdAt` | datetime | |

Pros: expiry + revocation; token is independent of session refs; one clear
validation point. Cons: a new table/migration.

### Option B — Reuse existing run refs (lighter, weaker)

Use the existing `runtimeSessionRef` / `runtimeRunRef` on `db.run` as the token
and let the existing `operations.ts:157` `db.run` lookup resolve scope. No new
storage.

Pros: no migration; reuses a verified resolver. Cons: no expiry/revocation; the
"token" is a session ref (longer-lived, broader); weaker isolation. Acceptable
only for a throwaway local claude_code prototype, not for production skill mode.

### DECISION (fill in T0.3)

- [ ] **Chosen:** Option ___ . Rationale: ___ .
- [ ] If Option A: migration file ___ ; PK/index ___ ; expiry policy ___ .
- [ ] Auth: run token **is** the Bearer (recommended) vs `API_KEY` Bearer + token
      in body. Chosen: ___ .

---

## 2. Terminal-action record

The authoritative record of what the agent decided, written by the control route
on terminal kinds, read by `terminalNodeResultFromRecordedAction` at run-end
(spec §7.1, plan §5).

| Field | Type | Notes |
| --- | --- | --- |
| `nodeAttemptId` | string | Key. One terminal action per attempt (last-write or first-write — decide). |
| `kind` | enum | Terminal kinds only: `complete` \| `condition_select` \| `wait_complete` \| `block` \| `fail`. |
| `payload` | json | The same payload shape the MCP tool carried (mirrors `dispatch.ts`). |
| `recordedAt` | datetime | For the run-end ordering guarantee. |

Notes / decisions (fill in T0.3 / T5.1):
- [ ] **Storage:** new small table keyed by `nodeAttemptId`, **or** JSON
      column(s) on the existing node-attempt / run row. Chosen: ___ .
- [ ] **`output` (append) vs terminal kinds:** `node output` is a non-terminal
      partial write (mode `append`/`replace`) and must allow multiple calls before
      one terminal action. It should not occupy the terminal-action record keyed
      by `nodeAttemptId`; store/dispatch it through the existing output path.
      Chosen: ___ .
- [ ] **Multiplicity:** can an attempt have multiple non-terminal `output` writes
      before one terminal action? (Yes — mirror `submit_node_output` semantics.)
      Terminal action: exactly one per attempt; second terminal call → reject or
      idempotent no-op. Chosen: ___ .
- [ ] **Run-end fallback:** if no terminal record exists for the attempt at
      run-end, the result builder returns `undefined` (same as snapshot path) and
      the caller's existing not-completed handling applies. Confirmed: ___ .

---

## 3. No change to existing tables (target)

- `db.aiClient` — `controlPlane` lives inside the existing JSON `config`; **no
  schema migration** for the flag (mirrors how `017` added client config without
  migration). Confirm.
- `db.taskSession`, `db.run`, node-attempt tables — read for scope resolution;
  not restructured. Any new column (Option B token reuse, or §2 JSON column) must
  be additive and nullable.

### DECISION (fill in T0.3)

- [ ] Total new tables: ___ . Total new columns: ___ . Migration file(s): ___ .
- [ ] Confirmed additive + nullable; no backfill required for existing rows
      (existing rows default to `controlPlane: "mcp"`).
