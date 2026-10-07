import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { resetTestDb } from "@chrona/db/test-support";
import type { GeneratePlanSSEEvent, PlanExecutionResult } from "@chrona/contracts";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient, revokeManagementClient } from "./clients";
import { createManagementService } from "./service";
import { processNextManagementCommand } from "./worker";
import type { ManagementDeps } from "./types";

beforeEach(resetTestDb);
async function fixture(onGenerate?: (taskId: string, clientId: string) => Promise<void>) {
  const engine = createChronaEngine();
  const credential = await createManagementClient({ name: "worker test", publicUrl: "http://localhost:3101" });
  const identity = await requireManagementClient(credential.token);
  await db.aiClient.create({ data: { name: "Test prerequisite", type: "debug", config: {}, enabled: true, isDefault: true } });
  await engine.runtime.aiClients.refresh();
  const calls: string[] = [];
  const deps: ManagementDeps = { tasks: engine.tasks, schedule: engine.tasks.schedule, lifecycle: engine.tasks.lifecycle, result: engine.tasks.result,
    plan: { ...engine.tasks.plan,
      async generate({ taskId, idempotencyKey }) {
        calls.push(`generate:${idempotencyKey}`);
        expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ autoPlanGeneration: false, autoExecute: false });
        await onGenerate?.(taskId, identity.id);
        return { generationId: idempotencyKey, events: (async function* (): AsyncGenerator<GeneratePlanSSEEvent> { yield { type: "committed", planId: "test-committed-plan", headStateVersion: 1 }; yield { type: "done" }; })(), emit() {}, finish() {} };
      },
      async accept(input) { calls.push(`accept:${input.planId}`); return { savedPlan: null }; },
    },
    execution: { ...engine.tasks.execution, async dispatch({ taskId }) {
      calls.push("execute");
      expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ autoPlanGeneration: true, autoExecute: true });
      return { taskId, planId: "test-committed-plan", mainSessionId: null, status: "started", currentNodeId: null, executedNodeIds: [], waitingNodeIds: [], blockedNodeIds: [], message: "Started", checkpoint: null } satisfies PlanExecutionResult;
    } },
  };
  return { identity, deps, service: createManagementService(deps), calls };
}
function payload(result: unknown): Record<string, any> { return result as Record<string, any>; }

describe("durable management pipeline", () => {
  for (const mode of ["plan", "automatic"] as const) {
    it(`${mode}: queues, plans, restores intent, and only automatic accepts/executes`, async () => {
      const { service, identity, deps, calls } = await fixture();
      const input = { requestId: crypto.randomUUID(), title: "Pipeline", mode, ...(mode === "automatic" ? { start: "now" } : {}) };
      const submitted = payload(await service.call(identity, "chrona_task_create", input));
      expect(submitted.data.state).toBe("queued");
      expect(calls).toEqual([]);
      expect(await processNextManagementCommand(deps)).toBe(true);
      const command = await db.managementCommand.findUniqueOrThrow({ where: { id: submitted.data.commandId } });
      expect({ state: command.state, errorCode: command.errorCode }).toEqual({ state: "completed", errorCode: null });
      expect(calls.map((call) => call.split(":")[0])).toEqual(mode === "automatic" ? ["generate", "accept", "execute"] : ["generate"]);
      const replay = payload(await service.call(identity, "chrona_task_create", input));
      expect(replay.data.replayed).toBe(true);
      expect(await processNextManagementCommand(deps)).toBe(false);
      expect(calls).toHaveLength(mode === "automatic" ? 3 : 1);
    });
  }
  it("does not overwrite a UI edit while provider planning was in flight", async () => {
    const { service, identity, deps, calls } = await fixture(async (taskId) => { await db.task.update({ where: { id: taskId }, data: { title: "Human changed intent" } }); });
    const submitted = payload(await service.call(identity, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Pipeline", mode: "automatic", start: "now" }));
    await processNextManagementCommand(deps);
    expect(await db.managementCommand.findUnique({ where: { id: submitted.data.commandId } })).toMatchObject({ state: "failed", errorCode: "REVISION_CONFLICT" });
    expect(calls).toHaveLength(1);
    expect(await db.task.findUnique({ where: { id: submitted.data.taskId } })).toMatchObject({ title: "Human changed intent", autoExecute: false });
  });
  it("rechecks revocation between planning and execution", async () => {
    const { service, identity, deps, calls } = await fixture(async (_taskId, clientId) => revokeManagementClient(clientId));
    const submitted = payload(await service.call(identity, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Pipeline", mode: "automatic", start: "now" }));
    await processNextManagementCommand(deps);
    expect(await db.managementCommand.findUnique({ where: { id: submitted.data.commandId } })).toMatchObject({ state: "failed", errorCode: "AUTH_REQUIRED" });
    expect(calls).toHaveLength(1);
  });
});
