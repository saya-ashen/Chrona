import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import {
  assertCurrentGraphVersion,
  createGraphMutation,
  createGraphVersion,
  listPendingGraphMutations,
  updateGraphMutationStatus,
} from "@/modules/orchestration";

async function resetDb() {
  await db.graphMutationRecord.deleteMany();
  await db.graphVersion.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createTask() {
  const workspace = await db.workspace.create({
    data: { name: "Graph Mutation Workspace", status: "Active", defaultRuntime: "openclaw" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Mutate graph",
      status: "Ready",
      priority: "High",
      executionRuntime: "openclaw",
      executionConfig: { prompt: "Mutate graph" },
    },
  });
  return { workspace, task };
}

describe("graph mutation repository", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("tracks latest graph version for optimistic mutation checks", async () => {
    const { workspace, task } = await createTask();

    await createGraphVersion({
      workspaceId: workspace.id,
      taskId: task.id,
      version: 1,
      graph: { nodes: ["a"] },
      createdBy: "planner",
    });
    await createGraphVersion({
      workspaceId: workspace.id,
      taskId: task.id,
      version: 2,
      graph: { nodes: ["a", "b"] },
      createdBy: "mutation",
    });

    await expect(assertCurrentGraphVersion(task.id, 1)).resolves.toBe(false);
    await expect(assertCurrentGraphVersion(task.id, 2)).resolves.toBe(true);
  });

  it("lists only pending graph mutations in creation order", async () => {
    const { workspace, task } = await createTask();

    const first = await createGraphMutation({
      workspaceId: workspace.id,
      taskId: task.id,
      baseGraphVersion: 2,
      operation: "insert_node",
      payload: { nodeId: "node-a" },
      createdBy: "user",
    });
    const second = await createGraphMutation({
      workspaceId: workspace.id,
      taskId: task.id,
      baseGraphVersion: 2,
      operation: "cancel_subtree",
      payload: { nodeId: "node-b" },
      createdBy: "user",
    });
    await updateGraphMutationStatus({ id: first.id, status: "Applied", appliedAt: new Date() });

    const pending = await listPendingGraphMutations(task.id);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(second.id);
  });

  it("records mutation validation results and affected nodes", async () => {
    const { workspace, task } = await createTask();
    const mutation = await createGraphMutation({
      workspaceId: workspace.id,
      taskId: task.id,
      baseGraphVersion: 1,
      operation: "add_dependency",
      payload: { from: "node-a", to: "node-b" },
      createdBy: "user",
    });

    const appliedAt = new Date("2026-05-17T12:00:00.000Z");
    const updated = await updateGraphMutationStatus({
      id: mutation.id,
      status: "Rejected",
      validationResult: { reason: "cycle_detected" },
      affectedNodeIds: ["node-a", "node-b"],
      appliedAt,
    });

    expect(updated).toMatchObject({
      status: "Rejected",
      validationResult: { reason: "cycle_detected" },
      affectedNodeIds: ["node-a", "node-b"],
      appliedAt,
    });
  });
});
