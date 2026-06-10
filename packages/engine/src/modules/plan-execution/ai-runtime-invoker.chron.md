---
chronicle_version: 1
scope: "file"
source: "ai-runtime-invoker.ts"
owner_feature: "Plan Execution"
owner_capability: "Ai Runtime Invoker"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "2946b91158258971"
  last_scanned_commit: ""
symbols:
  - id: "AiRuntimeInvoker"
    source_name: "AiRuntimeInvoker"
    kind: "class"
    describe: true
  - id: "runProviderRequest"
    source_name: "runProviderRequest"
    kind: "function"
    describe: true
---
# ai-runtime-invoker

<!-- ai:start -->
Bridges plan-execution node runtime calls to the configured AI provider runtime, records Chrona run/provider-run audit facts, persists provider events and chat history, and returns provider snapshots back to graph node executors.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `AiRuntimeInvoker` | class | 8 | ai-selected:plan-execution-provider-runtime-boundary | `export class AiRuntimeInvoker` |
| `runProviderRequest` | function | 7 | ai-selected:plan-execution-provider-runtime-boundary | `export async function runProviderRequest( providerClient: NonNullable<Awaited<ReturnType<typeof requireAiClient>>["providerClient"]>, request: ExecutionProviderRequest, options:` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:AiRuntimeInvoker:start -->

### `AiRuntimeInvoker`

<!-- ai:start -->
Role: Owns the durable runtime invocation lifecycle for AI-backed execution nodes. It creates Chrona `Run` rows, resolves provider clients, builds execution gateway requests, links optional provider-run records, and normalizes provider snapshots into `AiRuntimeInvocation` results.

Behavior: Creates a pending run, requires the selected AI client to expose a provider runtime, starts the provider request with the node idempotency key, persists provider runtime events/history, then marks the run running or failed from the terminal snapshot. On errors it updates the Chrona run and any idempotent provider-run record as failed before rethrowing.

Inputs/outputs: Input is an `AiRuntimeInvocationInput` containing task/session/runtime identifiers, feature spec, runtime input, provider client id, optional node-attempt/provider-run context, runtime-event callback, and abort signal. Output contains the Chrona run id, provider run/session refs, conversation entry ids, and the collected `ProviderRunSnapshot`.

Invariants:
Provider runtime support is mandatory. Runtime session ids must be present in provider snapshots. Run/provider-run audit rows are written before results are returned; failures are not hidden as successful invocations.

Coverage:
Coverage status: Partial

Covered:
- Direct provider-request tests cover transient stream interruption handling, single `startRun`, one reconnect, provider snapshot reconciliation, running fallback, and non-transient rethrow behavior.
- Direct AI capability and condition executor tests exercise `AiRuntimeInvoker` as the runtime boundary used by node execution flows.

Missing or weak:
- No direct test constructs `AiRuntimeInvoker.invoke` end-to-end with database run updates, provider-run audit persistence, history persistence, and failure-row updates in one scenario.
<!-- ai:end -->

<!-- generated:tests:start AiRuntimeInvoker -->
Direct tests:
- packages/engine/src/modules/plan-execution/node-ai-capabilities.bun.test.ts
- packages/engine/src/modules/plan-execution/node-executors/condition-executor.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end AiRuntimeInvoker -->

<!-- symbol:AiRuntimeInvoker:end -->

<!-- symbol:runProviderRequest:start -->

### `runProviderRequest`

<!-- ai:start -->
Role: Runs one already-built execution provider request against a provider client and collects the provider event stream into a final snapshot.

Behavior: Starts a provider run with streaming enabled and an idempotency key, persists the provider run reference, streams raw events into callbacks/persistence, and returns a terminal `run_completed` or `run_failed` snapshot. If the stream ends or disconnects with a transient provider error, it retries the stream once, then polls `getRun` to reconcile authoritative provider state.

Inputs/outputs: Input is a provider runtime client, an `ExecutionProviderRequest`, and optional run/idempotency/provider-run/event-persistence/signal settings. Output is a `ProviderRunSnapshot` with provider ids, session id, status, output or error, usage, structured payload, and optional raw terminal data.

Invariants:
`startRun` is called once per request; reconnects reuse the original provider run id/session id. Missing terminal events are treated as incomplete streams, not success. Non-transient errors are rethrown without polling.

Coverage:
Coverage status: Partial

Covered:
- Direct tests cover interrupted streams that remain running, complete while disconnected, cannot be polled, or fail with non-transient errors.

Missing or weak:
- Direct tests do not cover event persistence, provider-run record updates, abort handling, completed/failed event payload shaping, or terminal tool raw metadata.
<!-- ai:end -->

<!-- generated:tests:start runProviderRequest -->
Direct tests:
- packages/engine/src/modules/plan-execution/ai-runtime-invoker.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end runProviderRequest -->

<!-- symbol:runProviderRequest:end -->
