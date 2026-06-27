# `@chrona-org/agent-cli` — control-plane library

Pure logic for the **Chrona skill-mode** control plane (Spec 018). Used by
`@chrona/cli` to expose `chrona node <verb>` and `chrona task|plan read`
subcommands. The `claude_code` provider mounts a skill into every run, and
the agent invokes the same `chrona` binary to report non-terminal outputs
and terminal outcomes. Scope (`taskId`, `nodeId`, `sessionId`) is **never**
read from the command line — it is resolved server-side from an opaque run
token injected as `CHRONA_RUN_TOKEN` at run start.

## Use it from `@chrona/cli` (preferred)

Install `@chrona/cli` once and run `chrona node <verb>`. `@chrona/cli`
imports this library internally; you do not need a separate `chrona` bin
on your `PATH` for the skill.

## Import as a library

```ts
import { buildControlPayload, sendControlAction } from "@chrona-org/agent-cli";

const { body } = buildControlPayload(["node", "fail", "--error", "boom"]);
const result = await sendControlAction(body, { env: process.env, fetchImpl: fetch });
```

## Standalone `chrona` binary (legacy)

Earlier versions of this package exposed a `chrona` bin entry. That was
removed in favor of the unified `@chrona/cli` binary so the host CLI and
the skill CLI are the same command. Callers that previously installed
`@chrona-org/agent-cli` for the bin should now install `@chrona/cli`
and call `chrona node <verb>`.
## Environment

| Variable             | Required | Notes                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `CHRONA_BASE_URL`    | yes      | Chrona server base URL (e.g. `http://127.0.0.1:8787`).                |
| `CHRONA_RUN_TOKEN`   | yes      | Opaque run-scoped token. Bound to one `(taskId, nodeAttemptId, ...)`. |

If either is missing, the CLI exits non-zero with a clear message on
stderr. The agent is the operator; the exit code is its only feedback.

## Usage

The CLI accepts flag-based argv. **Task / node ids are never accepted on
argv** — they are resolved server-side from the run token. Only payload
fields (e.g. `--summary`, `--error`, `--branch`) and file paths (e.g.
`--patches-file`, `--diagnostics-file`) are read from argv.

### Node actions

```text
chrona plan output        --patches-file <path> [--summary <s>]
chrona node complete      [--summary <s>]
chrona node condition-select --branch <ref> --summary <s> [--node-id <id>]
chrona node wait-complete --summary <s>
chrona node block         --reason <s> --action-form <json> | --action-form-file <path> [--retryable]
chrona node fail          --error <s> [--diagnostics <json> | --diagnostics-file <path>] [--retryable]
```

`--patches-file` takes a path to a JSON Patch array on disk (the
canonical way to pass large patches without shell-escaping). The
condition-select `--node-id` defaults to `"current"`; the server resolves
the actual id from the run token.

### Reads

```text
chrona task read
chrona plan read
```

### Examples

```bash
# Plan output — write JSON Patch operations to disk, then post them.
chrona plan output --patches-file /tmp/output-patches.json --summary "wrote card"

# Node fail with structured diagnostics.
chrona node fail --error "command exited 1" --diagnostics '{"exitCode":1}'

# Condition select — point the engine at a branch.
chrona node condition-select --branch B20260614-01-A --summary "took path A"

# Read the current task or plan.
chrona task read
chrona plan read
```

## Wire format

Every command POSTs to `<CHRONA_BASE_URL>/agent/control` with
`Authorization: Bearer ${CHRONA_RUN_TOKEN}` and a JSON body of
`{ kind, payload }` validated by `agentControlActionBodySchema` in
`@chrona/contracts`. The `kind` values are:

| Command                         | Wire `kind`        |
| ------------------------------- | ------------------ |
| `chrona plan output`            | `plan_output`      |
| `chrona node complete`          | `complete`         |
| `chrona node condition-select`  | `condition_select` |
| `chrona node wait-complete`     | `wait_complete`    |
| `chrona node block`             | `block`            |
| `chrona node fail`              | `fail`             |
| `chrona task read`              | `task_read`        |
| `chrona plan read`              | `plan_read`        |

The server maps each `{ kind, payload }` to the existing engine
`submitNodeResult(...)` action via the same shared mapper MCP uses. No new
engine business logic is added; this CLI is a transport.

## Why no task/node IDs on argv

The agent **never** names a `taskId` or `nodeId` it discovered — those
identifiers do not need to leave the server, and exposing them in argv
leaks through shell history and process listings. Scope is bound to the
run token; the server resolves it in one DB lookup.

## Library usage

The package is also importable as a library:

```ts
import { run, buildControlPayload, sendControlAction } from "@chrona-org/agent-cli";
import { readFileSync } from "node:fs";

const { body } = buildControlPayload(["node", "fail", "--error", "boom"]);
const result = await sendControlAction(body, {
  env: process.env,
  fetchImpl: fetch,
});
```

## Testing

```bash
bun test packages/agent-cli
bunx tsc --noEmit -p packages/agent-cli/tsconfig.json
```

Tests use `bun:test`. `buildControlPayload` is exercised without any
network; `run` injects a `fetchImpl` so the request shape is asserted
end-to-end without touching the real network.
