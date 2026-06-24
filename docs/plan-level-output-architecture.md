# Plan-Level Output Architecture

Chrona execution output becomes one shared plan-level json-render document per `TaskPlanRun`. Node-local outputs are removed. Executable nodes may patch the shared plan output, but no runtime, API, prompt, read model, or UI may expose output as node-owned data.

This is a clean cutover. No compatibility layer. No legacy `chrona_node_output` alias. No `{ spec, mode }` payload. No `NodeResult.outputs` fallback. Existing node-local output data is intentionally abandoned when code migrates to the new model.

## Goals

- One user-visible output per `TaskPlanRun`.
- Output belongs to the plan run, not to any node result.
- Any executable node may add, replace, move, copy, test, or remove content in the shared output.
- Output changes use json-render SpecStream semantics: RFC 6902 JSON Patch operations over one json-render Spec.
- Runtime prompts expose AI-visible refs only; agents never emit backend IDs.
- UI renders plan output at task/work/plan level, never inside individual node result panels.
- Public agent tool name reflects the new owner: `chrona_plan_output`.

## Non-goals

- No `chrona_node_output` compatibility alias.
- No support for old `{ spec, mode }` payloads.
- No fallback rendering of `NodeResult.outputs`.
- No old output copying into `planOutput` unless a separate one-time destructive migration is explicitly requested.
- No new Prisma table unless `TaskPlanRun.planRun` JSON becomes too large later.

## Current code to replace

| Area | Current file | Required change |
| --- | --- | --- |
| MCP tool registry/schema | `packages/contracts/src/api/mcp-task-tools.schema.ts` | Delete `chrona.node.output`; add `chrona.plan.output`; public tool becomes `chrona_plan_output`; payload is `{ patches, summary? }`. |
| Public/control action kinds | `packages/contracts/src/api/mcp-task-tools.schema.ts` | Rename control kind from `output` to `plan_output` if control actions remain exposed. |
| Runtime action type | `packages/contracts/src/plan-runtime/commands.ts` | Replace `submit_node_output` with `update_plan_output`. |
| Node result type | `packages/contracts/src/plan-runtime/node-result.ts` | Remove `NodeResultOutput` and `NodeResult.outputs`. |
| Execution persistence | `packages/engine/src/modules/plan-execution/use-cases/submit-terminal-node-result.ts` | Replace node-result output writes with plan-output patch writes. |
| Plan run store | `packages/engine/src/modules/plan-execution/persistence/plan-run-store.ts` | Persist `planOutput` inside mutable run record. |
| Agent tool mapping | `packages/engine/src/modules/agent-tools/node-result-action.ts` | Map `chrona.plan.output` to `update_plan_output`; remove `chrona.node.output`. |
| Runtime prompt | `packages/engine/src/modules/plan-execution/runtime/node-runtime-prompts.ts` | Teach `chrona_plan_output` SpecStream patches, not `chrona_node_output` complete specs. |
| Runtime input | `packages/engine/src/modules/plan-execution/runtime/node-runtime-refs.ts` | Expose shared `context.planOutput`; previous results include summaries only. |
| Runtime terminal parsing | `packages/engine/src/modules/plan-execution/runtime/node-ai-capabilities.ts` | Remove output extraction from terminal actions. |
| Agent CLI | `packages/agent-cli/src/payloads.ts` and README/tests | Rename `chrona node output` to `chrona plan output`; require `--patches-file`. |
| Frontend graph model | `apps/web/src/components/tasks/plan/task-plan-view-model.ts` and `task-plan-graph/types.ts` | Remove `resultOutputs`; expose plan-level output separately. |
| Work page output | `apps/web/src/components/tasks/workspace/**` | Render `planOutput.spec` at work/plan level. |
| Dashboard output | `packages/engine/src/modules/pages/get-dashboard.ts` | Read latest output from current/latest plan run `planOutput`, not artifacts or node outputs. |

## Data model

Store plan output in existing `TaskPlanRun.planRun` JSON under `mutableGraph.planOutput`.

```ts
export type PlanOutputPatch =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; path: string; from: string }
  | { op: "copy"; path: string; from: string }
  | { op: "test"; path: string; value: unknown };

export type PlanOutputRevision = {
  id: string;
  nodeId: string | null;
  nodeLayerId?: string | null;
  attemptId?: string | null;
  sessionId?: string;
  summary?: string;
  patches: PlanOutputPatch[];
  createdAt: string;
};

export type PlanOutputState = {
  spec: Spec | null;
  revision: number;
  updatedAt: string | null;
  updatedByNodeId: string | null;
  history: PlanOutputRevision[];
};
```

`MutablePlanRuntimeRecord` becomes:

```ts
type MutablePlanRuntimeRecord = {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  planOutput: PlanOutputState;
};
```

Default for new plan runs:

```ts
{
  spec: null,
  revision: 0,
  updatedAt: null,
  updatedByNodeId: null,
  history: []
}
```

### Existing data cutover

- New code ignores existing `NodeResult.outputs`.
- Persistence serializers stop writing `NodeResult.outputs`.
- Runtime projections should normalize loaded results by dropping `outputs` if old JSON contains it.
- No UI fallback reads old outputs.
- No compatibility route/tool accepts old output payloads.

## MCP tool contract

Delete old tool names:

- Public: `chrona_node_output`
- Internal: `chrona.node.output`

Add new tool names:

- Public: `chrona_plan_output`
- Internal: `chrona.plan.output`

Payload:

```ts
{
  patches: PlanOutputPatch[];
  summary?: string;
}
```

Rules:

- `patches` MUST be non-empty.
- Paths are JSON Pointer paths into one json-render Spec.
- Allowed top-level targets: `/root`, `/elements`, `/elements/{id}`, `/elements/{id}/props`, `/elements/{id}/children`, `/state`.
- First output update must create a valid Spec with `root` and referenced elements.
- Final Spec after all patches must pass `validateChronaSpec()`.
- Agents must use Chrona plan-output catalog component names and props only.
- Agents must not emit backend IDs in element IDs, props, summaries, or paths.
- `{ spec, mode }` is invalid.
- Markdown-only text is invalid.

Tool description:

```text
Patch shared plan-level user-visible output as json-render SpecStream patches. Submit { patches, summary }. Patches are RFC 6902 JSON Patch operations over the current plan output Spec. Use paths like /root, /elements/root, /elements/root/children, /elements/summary/props/text. Do not submit complete node-local outputs, markdown-only text, legacy spec/mode fields, or backend IDs. Final Spec after applying patches must be valid against Chrona plan-output catalog.
```

## Runtime action contract

Replace `submit_node_output` with `update_plan_output` in `ExecutionActionInput`:

```ts
{
  action: "update_plan_output";
  sessionId?: string;
  nodeId?: string;
  patches: PlanOutputPatch[];
  summary?: string;
  idempotencyKey?: string;
}
```

Mapping:

- `packages/engine/src/modules/agent-tools/node-result-action.ts` maps `chrona.plan.output` to `update_plan_output`.
- It must not map `chrona.node.output`.
- `complete_manual_node`, `condition_select`, `wait_complete`, `block_current_node`, and `fail_current_node` no longer accept or forward `outputs`.

## Patch application

`updatePlanOutput()` owns plan output mutation.

Algorithm:

1. Resolve accepted compiled plan and current `TaskPlanRun`.
2. Resolve current/running node for attribution only.
3. Load `persisted.planOutput`.
4. Apply patches to `planOutput.spec ?? {}` using json-render SpecStream/RFC 6902 utilities from `@json-render/core`.
5. Validate final result with `validateChronaSpec()`.
6. Save updated `planOutput` with incremented `revision` and appended history item.
7. Append main-session event `plan_output_updated`.
8. Return current execution state with latest `planOutput`.

Validation failure rejects the tool call and must not mutate `TaskPlanRun`.

Use guarded writes (`savePlanRunGuarded`) for output updates so concurrent node/tool updates cannot silently overwrite the shared document. Conflict reloads current state and retries patch application once. If retry still conflicts, return conflict error.

## Read model changes

Add plan output to execution/work read models:

```ts
type PlanExecutionResult = {
  // existing fields
  planOutput: {
    spec: UiDocument | null;
    revision: number;
    updatedAt: string | null;
    updatedByNodeId: string | null;
  };
};
```

Work page read model exposes same shape. `GET /api/work/:taskId` is primary UI source for rendered plan output.

Node read/current execution context includes plan output for agents:

```ts
type NodeRuntimeInputContext = {
  relevantPreviousResults: Array<{
    nodeRef: string;
    title: string;
    summary?: string;
  }>;
  globalSummary?: string;
  planOutput: {
    revision: number;
    spec: Spec | null;
    updatedAt: string | null;
    lastSummary?: string;
  };
};
```

## Runtime prompt changes

Task-node instructions must mention only `chrona_plan_output` for user-visible deliverables.

Required prompt content:

- `chrona_plan_output` patches shared plan-level output.
- Use SpecStream/RFC 6902 JSON Patch operations.
- Current plan output is available in `Current Node Context JSON.context.planOutput`.
- Patch narrowly when output exists.
- Bootstrap with `/root` and `/elements/...` when output is empty.
- Call `chrona_node_complete` only after needed `chrona_plan_output` patches succeed.
- Stop after terminal action succeeds.

Example tool call payload:

```json
{
  "patches": [
    { "op": "add", "path": "/root", "value": "root" },
    {
      "op": "add",
      "path": "/elements/root",
      "value": {
        "type": "Stack",
        "props": { "direction": "vertical", "gap": "md" },
        "children": ["title", "summary"]
      }
    },
    {
      "op": "add",
      "path": "/elements/title",
      "value": {
        "type": "Heading",
        "props": { "text": "Result", "level": "h3" },
        "children": []
      }
    },
    {
      "op": "add",
      "path": "/elements/summary",
      "value": {
        "type": "Markdown",
        "props": { "content": "Completed findings." },
        "children": []
      }
    }
  ],
  "summary": "Initialized plan output"
}
```

Remove prompt text that says:

- call `chrona_node_output`.
- submit complete Spec as `spec`.
- use `mode: "replace"`.
- do not output JSONL/RFC 6902 patches.
- node output catalog only inside `chrona_node_output.spec`.

## Frontend behavior

Plan output renders at plan/work level.

Work page:

- Add main `PlanOutputPanel` or reuse existing json-render renderer wrapper.
- Render `planOutput.spec` with Chrona UI registry.
- Empty state: no plan output yet.
- Header shows revision and last updated node label when known.

Node inspector:

- Do not render `resultOutputs`.
- Show node summary, status, attempts, evidence, selected branch, block form, and terminal action state.
- If node updated output, show revision/history summary from `planOutput.history` filtered by `nodeId` if that history is exposed.

Dashboard/latest output:

- Use latest `planOutput.spec` from latest active/completed plan run.
- No node-output fallback.
- Do not treat artifacts as plan output unless they are separately attached artifacts, not the primary output document.

## Deletions

Remove these concepts from final code:

- Public tool `chrona_node_output`.
- Internal tool `chrona.node.output`.
- Public/control action kind `output` if it only means node output; replace with `plan_output`.
- `NodeResultOutput` type.
- `NodeResult.outputs` field.
- `resultOutputs` frontend node model field.
- `stringifyResultOutput()` helper if no longer used.
- `outputs` from `conditionSelectPayloadSchema` and `waitCompletePayloadSchema`.
- `outputs` extraction in `node-ai-capabilities.ts` terminal payload parsing.
- Tests asserting node-local output accumulation.
- Manual model node-output lab names and checks; replace with plan-output patch lab.
- Agent CLI `chrona node output` command and docs; replace with `chrona plan output`.

## Tests to update

Contracts:

- `packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts`
  - exposes `chrona.plan.output` and public `chrona_plan_output`.
  - does not expose `chrona.node.output` or public `chrona_node_output`.
  - accepts valid `{ patches, summary? }` payload.
  - rejects `{ spec, mode }`.
  - rejects empty patch list.
  - rejects malformed operation shape.

Agent tools:

- `packages/engine/src/modules/agent-tools/node-result-action.bun.test.ts`
  - maps `chrona.plan.output` / `plan_output` kind to `update_plan_output`.
  - has no mapping for `chrona.node.output`.
- `packages/engine/src/modules/agent-tools/operations.bun.test.ts`
  - dispatch receives `{ action: "update_plan_output", patches }`.

Execution:

- `packages/engine/src/modules/plan-execution/plan-runner.task-executor.external-results.bun.test.ts`
  - node A creates shared output.
  - node B patches same output.
  - completed node result has no `outputs`.
  - invalid final Spec rejects and leaves previous `planOutput` unchanged.
  - concurrent update conflict does not silently drop patches.

Runtime prompt/context:

- `packages/engine/src/modules/plan-execution/node-runtime-refs.bun.test.ts`
  - instructions include `chrona_plan_output` and SpecStream/RFC 6902 patch rules.
  - instructions do not include `chrona_node_output`.
  - instructions do not include legacy `{ spec, mode }` guidance.
  - runtime input includes `context.planOutput`.
  - previous results include summaries only, not output specs.

Frontend:

- `apps/web/src/components/tasks/plan/task-plan-view-model.test.ts`
  - no `resultOutputs` in node data.
  - plan output maps into work/plan view model.
- Work page output panel test:
  - renders plan output spec.
  - renders empty state when `planOutput.spec` is null.

Agent CLI:

- `packages/agent-cli/src/main.bun.test.ts`
  - accepts `chrona plan output --patches-file <path> --summary <s>`.
  - rejects `chrona node output`.
  - rejects `--outputs-file`, `--output-file`, and `--mode` for output submission.

Manual provider lab:

- Replace node-output lab with plan-output patch lab.
- It should assert model calls `chrona_plan_output` with `patches` before terminal completion.
- It should assert persisted `planOutput.spec` validates.

## Implementation order

1. Contracts/types: add `PlanOutputPatch` / `PlanOutputState`; remove node outputs.
2. Tool registry/schema: delete `chrona.node.output`; add `chrona.plan.output`; publish `chrona_plan_output`.
3. Control/action mapping: rename `output` kind to `plan_output`; map to `update_plan_output`.
4. Plan-run persistence: add `planOutput` to mutable run record and guarded save path.
5. Engine use case: replace node-output write with shared output patch application and validation.
6. Execution/read models: expose `planOutput` to current execution and Work page.
7. Runtime prompt/context: teach shared SpecStream patches and expose current plan output.
8. Agent CLI: replace `chrona node output` with `chrona plan output`.
9. Frontend: render plan output at Work page level; remove node output UI.
10. Dashboard/latest output: read plan output, not node outputs or artifacts.
11. Tests/manual lab: update assertions and remove legacy node-output tests.

## Acceptance criteria

- Public tool list contains `chrona_plan_output`.
- Public tool list does not contain `chrona_node_output`.
- Internal tool registry contains `chrona.plan.output`.
- Internal tool registry does not contain `chrona.node.output`.
- Plan output tool only accepts `{ patches, summary? }`.
- `{ spec, mode }` is rejected everywhere.
- No production code writes `NodeResult.outputs`.
- No production UI reads `node.result.outputs`.
- A node can create plan output from empty state with SpecStream patches.
- A later node can patch same plan output without replacing unrelated elements.
- Invalid patches/specs reject before persistence.
- Work page renders one shared plan output for current plan run.
- Runtime prompt instructs `chrona_plan_output`, not `chrona_node_output`.
- Tests prove contract, persistence, runtime prompt, CLI, and UI behavior.
