import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { saveCompiledPlan } from "@chrona/engine/modules/plan-execution/persistence/compiled-plan-store";
import { getLatestTaskPlanReadModel } from "@chrona/engine/modules/plans/task-plan-read-model";
import { createPlansRoutes } from "../tasks/plan.routes";
import type { CompiledPlan } from "@chrona/contracts/ai";

function app() {
  const a = new Hono();
  a.route("/api", createPlansRoutes(createChronaEngine()));
  return a;
}

async function resetDb() {
  await db.taskAssistantMessage.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedPlan() {
  const workspace = await db.workspace.create({
    data: { name: "Plan Ops Test", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Test flow graph task",
      status: "Ready",
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });

  const compiledPlan: CompiledPlan = {
    id: "plan-test",
    editablePlanId: "editable-test",
    sourceVersion: 1,
    title: "Test flow",
    goal: "Linear A→B→C→D flow",
    assumptions: [],
    nodes: [
      {
        id: "node-a",
        localId: "node-a",
        type: "task",
        title: "Research",
        config: { expectedOutput: "Research the domain" },
        dependencies: [],
        dependents: ["node-b"],
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 30,
        priority: "High",
      },
      {
        id: "node-b",
        localId: "node-b",
        type: "task",
        title: "Design",
        config: { expectedOutput: "Design the solution" },
        dependencies: ["node-a"],
        dependents: ["node-c"],
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 60,
        priority: "Medium",
      },
      {
        id: "node-c",
        localId: "node-c",
        type: "checkpoint",
        title: "Review",
        config: { checkpointType: "approve", prompt: "Get sign-off", required: true },
        dependencies: ["node-b"],
        dependents: ["node-d"],
        executor: "user",
        mode: "manual",
        estimatedMinutes: 15,
        priority: "High",
      },
      {
        id: "node-d",
        localId: "node-d",
        type: "task",
        title: "Ship",
        config: { expectedOutput: "Deploy to production" },
        dependencies: ["node-c"],
        dependents: [],
        executor: "ai",
        mode: "auto",
        estimatedMinutes: 20,
        priority: "Urgent",
      },
    ],
    edges: [
      { id: "edge-ab", from: "node-a", to: "node-b" },
      { id: "edge-bc", from: "node-b", to: "node-c" },
      { id: "edge-cd", from: "node-c", to: "node-d" },
    ],
    entryNodeIds: ["node-a"],
    terminalNodeIds: ["node-d"],
    topologicalOrder: ["node-a", "node-b", "node-c", "node-d"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };

  await saveCompiledPlan({
    workspaceId: workspace.id,
    taskId: task.id,
    compiledPlan,
    status: "accepted",
    prompt: "Build a 4-step workflow",
    summary: "Linear A→B→C→D flow",
    generatedBy: "graph-planner",
  });

  return { workspaceId: workspace.id, taskId: task.id, planId: compiledPlan.editablePlanId };
}

async function patchPlan(taskId: string, patch: Record<string, unknown>) {
  return app().request(`http://local/api/tasks/${taskId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

describe("plan mutation routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("adds a node and dependency through the plan patch route", async () => {
    const { taskId } = await seedPlan();
    const addNodeRes = await patchPlan(taskId, {
      operation: "add_node",
      summary: "Add auto-fix node",
      nodes: [
        {
          id: "node-x",
          localId: "node-x",
          title: "Auto-fix",
          objective: "Auto-fix lint issues",
          type: "task",
          estimatedMinutes: 20,
          priority: "Low",
        },
      ],
    });
    const addDependencyRes = await patchPlan(taskId, {
      operation: "update_dependencies",
      summary: "Link review to auto-fix",
      edges: [{ fromNodeId: "node-c", toNodeId: "node-x" }],
    });

    expect(addNodeRes.status).toBe(200);
    expect(addDependencyRes.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    expect(savedPlan?.effectivePlan.nodes.some((node) => node.id === "node-x")).toBe(true);
    expect(
      savedPlan?.effectivePlan.edges.some(
        (edge) => edge.from === "node-c" && edge.to === "node-x" && edge.active,
      ),
    ).toBe(true);
  });

  it("pushes a new definition layer and updates node fields", async () => {
    const { taskId } = await seedPlan();
    const res = await patchPlan(taskId, {
      operation: "update_node",
      summary: "Rename research node",
      nodePatches: [
        { id: "node-a", title: "Deep Research", objective: "Comprehensive study", estimatedMinutes: 45 },
      ],
    });

    expect(res.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    const updated = savedPlan?.effectivePlan.nodes.find((node) => node.id === "node-a");
    expect(updated?.title).toBe("Deep Research");
    expect(updated?.estimatedMinutes).toBe(45);
  });

  it("deletes a node and removes it from the effective graph", async () => {
    const { taskId } = await seedPlan();
    const res = await patchPlan(taskId, {
      operation: "delete_node",
      summary: "Remove design node",
      deletedNodeIds: ["node-b"],
    });

    expect(res.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    expect(savedPlan?.effectivePlan.nodes.some((node) => node.id === "node-b")).toBe(false);
    expect(
      savedPlan?.effectivePlan.edges.some(
        (edge) => edge.active && (edge.from === "node-b" || edge.to === "node-b"),
      ),
    ).toBe(false);
  });

  it("adds dependencies through the plan patch route", async () => {
    const { taskId } = await seedPlan();
    const addRes = await patchPlan(taskId, {
      operation: "update_dependencies",
      summary: "Add cross dependency",
      edges: [{ fromNodeId: "node-a", toNodeId: "node-c" }],
    });

    expect(addRes.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    expect(
      savedPlan?.effectivePlan.edges.some(
        (edge) => edge.from === "node-a" && edge.to === "node-c" && edge.active,
      ),
    ).toBe(true);
  });

  it("returns 404 when task has no persisted plan", async () => {
    const workspace = await db.workspace.create({
      data: { name: "No Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Task without plan",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const res = await patchPlan(task.id, {
      operation: "delete_node",
      summary: "No-op",
      deletedNodeIds: ["ghost-node"],
    });

    expect(res.status).toBe(404);
  });

});
