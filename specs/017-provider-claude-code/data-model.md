# Data model 017 — Claude Code execution provider

Scope of data changes for [`spec.md`](./spec.md). Short by design: this feature
is mostly behavioral and reuses existing persistence.

## Verdict: no DB schema migration required

The `db.aiClient` table already stores:
- `type: string` — open enough to hold `"claude_code"` (the contract union
  `AiClientType` is `… | (string & {})`, and `createProviderClient` switches on
  the string), and
- `config: unknown` (JSON) — holds the new `ClaudeCodeClientConfig` shape without
  a column change.

Therefore a new client type is a **type-system + runtime-wiring** change, not a
schema change. Do not add a Prisma migration for the client record.

> If implementation uncovers a genuine need to persist provider-specific run
> state that `Run` / `ToolInvocation` / existing tables can't hold, **stop and
> surface it** before adding a migration — it would be out of scope for this
> spec and a signal the abstraction is leaking.

## Type-level changes (in `packages/contracts`)

`packages/contracts/src/ai-feature-types.ts`:

```ts
export type AiClientType =
  | "llm" | "hermes" | "debug" | "claude_code" | (string & {});

export interface ClaudeCodeClientConfig {
  binaryPath?: string;   // override Claude Code CLI location
  model?: string;        // default "claude-opus-4-8"; "claude-fable-5" for hardest work
  timeoutMs?: number;
  mcpBaseUrl?: string;   // Chrona /api/mcp base; defaults to this server
}
```

- Add `ClaudeCodeClientConfig` to the `AiClientRecord.config` union.
- Export it from `packages/contracts/src/index.ts` next to `HermesClientConfig`.
- Keep the field set minimal — add a field only when the research gate
  (`plan.md` §0) proves it is needed.

## Config value contract

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `binaryPath` | no | resolve from PATH | Only set when Claude Code isn't on PATH. |
| `model` | no | `claude-opus-4-8` | Exact model-ID string; no date suffix. |
| `timeoutMs` | no | provider default | Per-run wall clock. |
| `mcpBaseUrl` | no | this Chrona server | Where the agent reaches Chrona's MCP tools. |

## Reused, unchanged

- `Run`, `ToolInvocation`, `Approval`, `TaskPlanNodeAttempt`, projections — all
  reused as-is; the provider produces the same `ProviderRunEvent` /
  `ProviderRunSnapshot` shapes the engine already persists for Hermes.
- AI-visible refs and the MCP tool contract — unchanged.

## Env vars (operational, not persisted)

| Var | Purpose | Mirrors |
| --- | --- | --- |
| `CHRONA_CLAUDE_CODE_RECORD_DIR` | Record run tapes for replay tests | `CHRONA_HERMES_RECORD_DIR` |
| `CHRONA_CLAUDE_CODE_STRICT_UNKNOWN_EVENTS` | Throw on unmapped stream items in dev | `CHRONA_HERMES_STRICT_UNKNOWN_EVENTS` |
