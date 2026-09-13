import { beforeEach, describe, expect, it } from "bun:test";
import { db, afterDatabaseCommit, withDatabaseTransaction } from "@/lib/db";
import { resetTestDb, seedTask, seedWorkspace } from "@chrona/db/test-support";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient, revokeManagementClient } from "./clients";
import { processNextManagementCommand } from "./worker";
import { managementCreateSchema } from "@chrona/contracts/api";

const engine = createChronaEngine();
const requestId = () => crypto.randomUUID();
async function client(scopes?: ["tasks:read"]) {
  const created = await createManagementClient({ name: "test agent", publicUrl: "http://localhost:3101", timezone: "Asia/Shanghai", scopes });
  return requireManagementClient(created.token);
}
function data(value: unknown): Record<string, any> { return value as Record<string, any>; }
beforeEach(resetTestDb);

describe("external management MCP service", () => {
  it("creates a useful todo, finds/reads it, and retries without duplicate domain writes", async () => {
    const identity = await client();
    const input = { requestId: requestId(), title: "Write release notes", description: "Summarize tested changes", mode: "todo" };
    const first = data(await engine.management.call(identity, "chrona_task_create", input));
    expect(first.ok).toBe(true);
    expect(first.data.state).toBe("completed");
    const taskId = first.data.taskId;
    const count = await db.event.count();
    const retry = data(await engine.management.call(identity, "chrona_task_create", input));
    expect(retry.data.replayed).toBe(true);
    expect(retry.data.taskId).toBe(taskId);
    expect(await db.task.count()).toBe(1);
    expect(await db.event.count()).toBe(count);
    const conflict = data(await engine.management.call(identity, "chrona_task_create", { ...input, title: "Different" }));
    expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const search = data(await engine.management.call(identity, "chrona_task_search", { query: "release" }));
    expect(search.data.items[0].taskId).toBe(taskId);
    const read = data(await engine.management.call(identity, "chrona_task_read", { taskId, view: "description" }));
    expect(read.data.description).toBe(input.description);
    expect(read.data.execution).toBeNull();
    expect(await db.taskPlanRun.count()).toBe(0);
    expect(await db.event.findFirst({ where: { eventType: "task.created" } })).toMatchObject({ actorType: "agent", actorId: identity.id, source: "management_mcp" });
  });

  it("advertises scheduling separately from unsupported reminder delivery and manual-todo lifecycle", async () => {
    const result = data(await engine.management.call(await client(), "chrona_context_read", {}));
    expect(result.data.capabilities).toMatchObject({
      modes: ["todo", "plan", "automatic"], independentManualTodos: false,
      scheduling: { timeBlocks: true, independentDeadlines: true },
      reminders: {
        customRules: false, deliveryChannels: [],
        inAppDueIndicators: { available: true, basis: "dueAt", configurable: false, readableViaManagementMcp: false },
      },
    });
  });

  it("returns consistent deadline, schedule and automation in receipts, search and compact reads", async () => {
    const identity = await client();
    const input = { requestId: requestId(), title: "Application deadline", mode: "todo",
      dueAt: "2030-01-02T19:59:00+08:00",
      schedule: { startsAt: "2030-01-01T19:59:00+08:00", endsAt: "2030-01-01T20:00:00+08:00", timezone: "Asia/Shanghai" } };
    const created = data(await engine.management.call(identity, "chrona_task_create", input));
    const taskId = created.data.taskId;
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId } });
    const expected = {
      dueAt: "2030-01-02T11:59:00.000Z",
      schedule: { status: projection.scheduleStatus, startsAt: "2030-01-01T11:59:00.000Z", endsAt: "2030-01-01T12:00:00.000Z" },
      automation: { autoPlanGeneration: false, autoExecute: false, timing: { plan: "at_start", execution: "at_start" } },
    };
    const compact = data(await engine.management.call(identity, "chrona_task_read", { taskId, view: "compact" }));
    const search = data(await engine.management.call(identity, "chrona_task_search", { query: "Application deadline" }));
    const summary = data(await engine.management.call(identity, "chrona_task_read", { taskId }));
    const config = data(await engine.management.call(identity, "chrona_task_read", { taskId, view: "config" }));
    for (const snapshot of [created.data.result, search.data.items[0], compact.data, summary.data, config.data]) {
      expect(JSON.parse(JSON.stringify(snapshot))).toMatchObject(expected);
    }
    expect(compact.data.task.status).toBe("Draft");
    expect(summary.data.state.state).toBe("no_plan"); // Do not hide the existing domain semantics.
    expect(Object.keys(compact.data).sort()).toEqual(["automation", "dueAt", "revision", "schedule", "task"]);
    expect(config.data.autoExecute).toBe(false); // Existing config fields remain available.
    const retry = data(await engine.management.call(identity, "chrona_task_create", input));
    expect(retry.data.result).toEqual(created.data.result);
    expect(await db.task.count()).toBe(1);
    expect(await db.taskPlan.count()).toBe(0);
    expect(await db.run.count()).toBe(0);

    const moved = data(await engine.management.call(identity, "chrona_task_update", {
      requestId: requestId(), taskId, expectedRevision: compact.data.revision,
      patch: { schedule: { ...input.schedule, startsAt: "2030-01-01T18:00:00+08:00", endsAt: "2030-01-01T18:15:00+08:00" } },
    }));
    expect(moved.ok).toBe(true);
    expect(moved.data.result.schedule.startsAt).toBe("2030-01-01T10:00:00.000Z");
    const cleared = data(await engine.management.call(identity, "chrona_task_update", {
      requestId: requestId(), taskId, expectedRevision: moved.data.result.revision, patch: { schedule: null },
    }));
    expect(cleared.ok).toBe(true);
    expect(cleared.data.result.dueAt).toBe(expected.dueAt);
    expect(cleared.data.result.schedule).toMatchObject({ startsAt: null, endsAt: null });
    // A receipt is immutable historical evidence, not a live task snapshot.
    expect(data(await engine.management.call(identity, "chrona_task_create", input)).data.result).toEqual(created.data.result);
  });

  it("keeps compact reads bounded and enforces requested work-block ownership", async () => {
    const identity = await client();
    const own = await seedTask(identity.workspaceId);
    await db.task.update({ where: { id: own.taskId }, data: {
      description: "private description", executionConfig: { prompt: "private prompt", apiKey: "test-only-secret" },
    } });
    const compact = data(await engine.management.call(identity, "chrona_task_read", { taskId: own.taskId, view: "compact" }));
    expect(compact.data.schedule).toBeNull(); // No projection: do not invent a schedule state.
    expect(compact.data.dueAt).toBeNull();
    expect(JSON.stringify(compact)).not.toMatch(/private description|private prompt|test-only-secret/);
    expect(compact.data).not.toHaveProperty("execution");
    expect(compact.data).not.toHaveProperty("savedPlan");
    expect(compact.data).not.toHaveProperty("availableActions");
    const block = await db.workBlock.create({ data: {
      workspaceId: identity.workspaceId, taskId: own.taskId, title: "Selected occurrence", status: "Scheduled",
      scheduledStartAt: new Date("2030-02-01T00:00:00Z"), scheduledEndAt: new Date("2030-02-01T01:00:00Z"),
    } });
    const selected = data(await engine.management.call(identity, "chrona_task_read", { taskId: own.taskId, view: "compact", workBlockId: block.id }));
    expect(selected.data.workBlock).toEqual({ id: block.id, status: "Scheduled", scheduledStartAt: block.scheduledStartAt, scheduledEndAt: block.scheduledEndAt });
    expect(selected.data.schedule).toBeNull(); // Task projection and selected block are distinct.
    const other = await seedTask(identity.workspaceId);
    const denied = data(await engine.management.call(identity, "chrona_task_read", { taskId: other.taskId, view: "compact", workBlockId: block.id }));
    expect(denied.error.code).toBe("NOT_FOUND");
    const foreign = await seedTask((await seedWorkspace("Foreign compact scope")).workspaceId);
    expect(data(await engine.management.call(identity, "chrona_task_read", { taskId: foreign.taskId, view: "compact" })).error.code).toBe("NOT_FOUND");
  });

  it("requires explicit mode and real automation prerequisites; never downgrades automatic to draft", async () => {
    expect(managementCreateSchema.safeParse({ requestId: requestId(), title: "Task" }).success).toBe(false);
    expect(managementCreateSchema.safeParse({ requestId: requestId(), title: "Task", mode: "automatic" }).success).toBe(false);
    const identity = await client();
    const result = data(await engine.management.call(identity, "chrona_task_create", { requestId: requestId(), title: "Run", mode: "automatic", start: "now" }));
    expect(result.error.code).toBe("PRECONDITION_FAILED");
    expect(await db.task.count()).toBe(0);
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("keeps description and schedule atomic; checks revisions from writes outside MCP", async () => {
    const identity = await client();
    const first = data(await engine.management.call(identity, "chrona_task_create", { requestId: requestId(), title: "Task", mode: "todo" }));
    const taskId = first.data.taskId;
    const read = data(await engine.management.call(identity, "chrona_task_read", { taskId }));
    await db.task.update({ where: { id: taskId }, data: { title: "Edited in UI" } });
    await db.task.update({ where: { id: taskId }, data: { title: "Task" } });
    const stale = data(await engine.management.call(identity, "chrona_task_update", { requestId: requestId(), taskId, expectedRevision: read.data.revision, patch: { description: { mode: "append", text: "More detail" } } }));
    expect(stale.error.code).toBe("REVISION_CONFLICT");
    const fresh = data(await engine.management.call(identity, "chrona_task_read", { taskId }));
    const update = data(await engine.management.call(identity, "chrona_task_update", { requestId: requestId(), taskId, expectedRevision: fresh.data.revision, patch: { description: { mode: "append", text: "More detail" }, schedule: { startsAt: "2030-01-01T10:00:00+08:00", endsAt: "2030-01-01T11:00:00+08:00", timezone: "Asia/Shanghai" }, dueAt: "2030-01-03T00:00:00Z" } }));
    expect(update.ok).toBe(true);
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ description: "More detail", dueAt: new Date("2030-01-03T00:00:00Z") });
    expect(await db.workBlock.count({ where: { taskId } })).toBe(1);
  });

  it("enforces independent credential, revocation, scopes and workspace isolation", async () => {
    await expect(requireManagementClient("")).rejects.toThrow();
    await expect(requireManagementClient("existing-global-api-key")).rejects.toThrow();
    const identity = await client(["tasks:read"]);
    const denied = data(await engine.management.call(identity, "chrona_task_create", { requestId: requestId(), title: "No", mode: "todo" }));
    expect(denied.error.code).toBe("FORBIDDEN");
    const other = await seedWorkspace("Other");
    const task = await seedTask(other.workspaceId);
    const missing = data(await engine.management.call(identity, "chrona_task_read", { taskId: task.taskId }));
    expect(missing.error.code).toBe("NOT_FOUND");
    await revokeManagementClient(identity.id);
    const revoked = data(await engine.management.call(identity, "chrona_context_read", {}));
    expect(revoked.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects plan patches linking a foreign-workspace task before mutation", async () => {
    const identity = await client();
    const own = await seedTask(identity.workspaceId);
    const foreignWorkspace = await seedWorkspace("Foreign");
    const foreign = await seedTask(foreignWorkspace.workspaceId);
    const result = data(await engine.management.call(identity, "chrona_task_action", { requestId: requestId(), taskId: own.taskId, action: { type: "patch_plan", patch: { operation: "add_node", expectedHeadStateVersion: 0, nodes: [{ id: "n1", linkedTaskId: foreign.taskId }] } } }));
    expect(result.error.code).toBe("NOT_FOUND");
    expect(await db.managementCommand.count()).toBe(0);
  });

  it("previews deletion and refuses changed impact", async () => {
    const identity = await client();
    const created = data(await engine.management.call(identity, "chrona_task_create", { requestId: requestId(), title: "Delete", mode: "todo" }));
    const taskId = created.data.taskId;
    const preview = data(await engine.management.call(identity, "chrona_task_delete", { mode: "preview", taskId }));
    expect(preview.ok).toBe(true);
    const deletion = data(await engine.management.call(identity, "chrona_task_delete", { mode: "delete", requestId: requestId(), taskId, expectedRevision: preview.data.revision, expectedTaskIds: [taskId], expectedAssetIds: [] }));
    expect(deletion.ok).toBe(true);
    expect(await db.task.count()).toBe(0);
    expect(await db.managementCommand.count()).toBe(2);
  });

  it("records an invalid provider plan without claiming planning or execution succeeded", async () => {
    const identity = await client();
    await db.aiClient.create({ data: { name: "Debug", type: "debug", config: { profile: "tool-submit" }, isDefault: true, enabled: true } });
    await engine.runtime.aiClients.refresh();
    const created = data(await engine.management.call(identity, "chrona_task_create", { requestId: requestId(), title: "Write a short release note", mode: "plan" }));
    expect(created.ok).toBe(true);
    expect(created.data.state).toBe("queued");
    const deps = { tasks: engine.tasks, schedule: engine.tasks.schedule, plan: engine.tasks.plan, execution: engine.tasks.execution, lifecycle: engine.tasks.lifecycle, result: engine.tasks.result };
    await processNextManagementCommand(deps);
    const command = await db.managementCommand.findUniqueOrThrow({ where: { id: created.data.commandId } });
    expect({ state: command.state, errorCode: command.errorCode }).toEqual({ state: "failed", errorCode: "PLAN_GENERATION_FAILED" });
    expect(await db.taskPlan.count({ where: { taskId: created.data.taskId } })).toBe(0);
    expect(await db.task.findUnique({ where: { id: created.data.taskId } })).toMatchObject({ autoPlanGeneration: false, autoExecute: false });
  }, 30_000);

  it("does not replay an execution whose process died after dispatch", async () => {
    const identity = await client();
    const task = await seedTask(identity.workspaceId);
    const command = await db.managementCommand.create({ data: { clientId: identity.id, workspaceId: identity.workspaceId, taskId: task.taskId, toolName: "chrona_task_action", requestId: requestId(), payloadHash: "hash", input: {}, state: "running", phase: "dispatching", leaseOwner: "dead", leaseUntil: new Date(0) } });
    const deps = { tasks: engine.tasks, schedule: engine.tasks.schedule, plan: engine.tasks.plan, execution: engine.tasks.execution, lifecycle: engine.tasks.lifecycle, result: engine.tasks.result };
    expect(await processNextManagementCommand(deps)).toBe(true);
    expect(await db.managementCommand.findUnique({ where: { id: command.id } })).toMatchObject({ state: "uncertain", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });
    expect(await db.taskPlanRun.count()).toBe(0);
  });
});

describe("transaction composition", () => {
  it("rolls back nested domain writes and never calls afterCommit on rollback", async () => {
    let called = 0;
    await expect(withDatabaseTransaction(async () => {
      const workspace = await db.workspace.create({ data: { name: "rollback", status: "Active" } });
      await db.$transaction(async (tx) => { await tx.task.create({ data: { workspaceId: workspace.id, title: "rollback", status: "Ready", priority: "Medium", executionConfig: {} } }); });
      afterDatabaseCommit(() => { called++; });
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect(await db.workspace.count()).toBe(0);
    expect(await db.task.count()).toBe(0);
    expect(called).toBe(0);
    await withDatabaseTransaction(async () => { await db.workspace.create({ data: { name: "commit", status: "Active" } }); afterDatabaseCommit(() => { called++; }); });
    expect(called).toBe(1);
  });
});
