# Quickstart: MCP Task Tools

## Goal

Verify that agents can advance Chrona Task -> Plan -> Schedule -> Execution state through Chrona-owned tool results without relying on final provider-authored structured JSON.

## Implementation Checklist

1. Add or extend shared contracts in `packages/contracts` for the common tool operation/result envelope and any missing task, plan, schedule, or execution operation inputs.
2. Route MCP/tool transport through server/runtime adapters that only validate input, call Chrona services, and translate results.
3. Reuse existing engine/domain/database paths for task, plan, schedule, and execution mutations.
4. Add idempotency handling for all mutating operations, including duplicate retry tests.
5. Add expected-state or expected-revision rejection for stale plan, schedule, task, and execution mutations.
6. Record accepted and rejected operation context for audit/history without letting provider output override state.
7. Preserve existing human task workspace behavior and terminology.

## Happy Path Scenario

1. Agent calls `chrona.task.read` or `chrona.task.create`.
2. Agent calls `chrona.plan.read` and `chrona.plan.mutate` with a reason and expected revision.
3. Agent calls `chrona.schedule.set` or `chrona.schedule.propose`.
4. Agent calls `chrona.execution.dispatch` using an existing execution action such as `start_manual` or `resume_with_input`.
5. Chrona returns `accepted` tool results with current authoritative state after each mutation.
6. Provider final response may be missing, malformed, or text-only; Chrona state remains correct because tool results were already applied.

## Tool Surface

MCP callers use the standard Streamable HTTP endpoint at `POST /api/mcp`. Clients call JSON-RPC methods such as `initialize`, `tools/list`, and `tools/call`. Read tools may omit `idempotencyKey`; all mutating tools require it. Supported tool names are:

- `chrona.task.read`, `chrona.task.create`, `chrona.task.update`
- `chrona.plan.read`, `chrona.plan.mutate`
- `chrona.schedule.read`, `chrona.schedule.propose`, `chrona.schedule.set`, `chrona.schedule.clear`
- `chrona.execution.read`, `chrona.execution.dispatch`

Provider text, provider tool traces, tool outputs, and optional structured output must be sent as `input.evidence`. Evidence is preserved on the `ChronaToolResult` for audit/diagnostics only; accepted state is derived from Chrona services after the tool operation.

Example mutation:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "chrona.task.update",
    "arguments": {
      "workspaceId": "workspace-1",
      "taskId": "task-1",
      "idempotencyKey": "agent-run-1:update-task",
      "expectedState": { "taskStatus": "Ready" },
      "payload": { "title": "Updated title" },
      "evidence": {
        "providerText": "I updated the task title.",
        "structuredOutput": { "taskStatus": "Done" }
      }
    }
  }
}
```

## Failure Scenarios To Cover

- Invalid payload returns `VALIDATION_ERROR` and no state change.
- Unauthorized workspace/task target returns `UNAUTHORIZED` and records rejected attempt when appropriate.
- Stale plan revision returns `STALE_STATE` with current revision and recommended read tool.
- Invalid execution transition returns `INVALID_TRANSITION` with supported next actions.
- Duplicate idempotency key returns original result or `noop` without duplicate task/plan/schedule/execution side effects.
- Provider final structured JSON conflicts with accepted tool result; Chrona preserves provider output only as evidence.
- Agent backend supports tool calls but no reliable final JSON; lifecycle still completes.

## Required Tests

- Contract tests for tool operation/result envelope and reused execution/plan/schedule schemas.
- Unit tests for lifecycle validation, idempotency, expected-state handling, and result mapping.
- Integration tests for MCP/tool adapter calls into Chrona services.
- Bun/API tests for server runtime behavior if Hono routes or Bun-specific transport are touched.
- Provider compatibility tests proving tool-call traces/evidence do not override accepted Chrona tool results.
- Regression tests for existing human task workspace actions and terminology where affected.

## Proof Commands

Run the narrowest changed test commands during implementation, then final validation:

```bash
bun run typecheck
bun run lint
bun run test
```

Run these when touched areas require them:

```bash
bun run test:api
bun run test:bun
bun run test:bridge
```

## Performance Checks

- Validation-only accepted/rejected tool responses return feedback within 1 second under normal local conditions.
- Ordinary task lifecycle mutations complete or fail within 3 seconds.
- Evidence/session recording does not block authoritative state mutation beyond the operation budget.
- Existing task workspace flow does not gain unnecessary polling or extra round trips.

## Done Criteria

- Supported agent-driven lifecycle actions complete through Chrona tool results without final agent-authored JSON.
- Invalid/stale calls leave state unchanged and return structured recovery guidance.
- Duplicate retries do not create duplicate side effects.
- Existing human-facing task workspace checks still pass.
- New agent backend integration can use Chrona tool calls without backend-specific final JSON parsing for the main lifecycle path.
