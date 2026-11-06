import { expect, mock, test } from "bun:test";
import { executions } from "./executions";
import { executionToolContracts, EXECUTION_UNRECORDED_TOOLS, type ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
const principal: ExecutionPrincipal = { workspaceId: "workspace", ownerId: "owner", caller: { kind: "owner" } };
const view = { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", projectRef: "project", status: "queued" as const, cancelRequested: false, stopConfirmed: false };
test("system module consumes frozen tools/unrecorded and real routed owner identity", async () => {
  const start = mock(async () => view);
  const ports = { executions: { start } } as unknown as StewardPorts;
  expect(executions.tools).toBe(executionToolContracts);
  expect(executions.unrecorded).toEqual([...EXECUTION_UNRECORDED_TOOLS]);
  const input = { workId: "work", projectRef: "project", commandKey: "key", goal: "goal", budget: { timeoutMs: 1000, maxToolCalls: 1 } };
  expect(await executions.handle({ ports, workspaceId: "workspace", caller: { kind: "owner", via: null } }, "start", input)).toEqual(view);
  expect(start).toHaveBeenCalledWith(principal, input);
});
test("provider cannot supply execution authority and absent service fails unavailable", async () => {
  const ports = {} as StewardPorts;
  await expect(executions.handle({ ports, workspaceId: "workspace", caller: { kind: "provider", runId: "run" } }, "get", { workId: "work" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(executions.handle({ ports, workspaceId: "workspace", caller: { kind: "owner", via: null } }, "get", { workId: "work" })).rejects.toMatchObject({ code: "unavailable" });
});
test("events bind session from scoped execution and reject mismatched attempt before storage", async () => {
  const read = mock(async () => ({ events: [], cursor: "cursor", highWatermark: 0, gap: false, snapshotRequired: false }));
  const ports = { executions: { get: async () => view }, executionEvents: { read } } as unknown as StewardPorts;
  const context = { ports, workspaceId: "workspace", caller: { kind: "owner" as const, via: null } };
  await expect(executions.handle(context, "events", { workId: "work", runId: "other", attemptId: "attempt", limit: 10, waitMs: 0 })).rejects.toMatchObject({ code: "conflict" });
  expect(read).not.toHaveBeenCalled();
  await executions.handle(context, "events", { workId: "work", runId: "run", attemptId: "attempt", limit: 10, waitMs: 0 });
  expect(read).toHaveBeenCalledWith(principal, { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", cursor: undefined, limit: 10, waitMs: 0 });
});
