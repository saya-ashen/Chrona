import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { saveCompiledPlan, getLatestTaskPlanReadModel } from "@chrona/engine";
import { createPlansRoutes } from "../tasks/plan.routes";
import type { CompiledPlan, GraphMutationRequest, NodeDefinitionLayer } from "@chrona/contracts/ai";

function app() {
  const a = new Hono();
  a.route("/api", createPlansRoutes());
  return a;
}

async function resetDb() {
  await db.taskAssistantMessage.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
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
    data: { name: "Plan Ops Test", status: "Active", defaultRuntime: "openclaw" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Test flow graph task",
      status: "Ready",
      priority: "High",
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

function definitionLayer(input: {
  nodeId: string;
  title: string;
  objective: string;
  type?: "task" | "checkpoint" | "condition" | "wait";
  estimatedMinutes?: number;
  priority?: "Low" | "Medium" | "High" | "Urgent";
}): NodeDefinitionLayer {
  return {
    id: `definition_${input.nodeId}_${Date.now()}`,
    nodeId: input.nodeId,
    type: "definition",
    createdAt: new Date().toISOString(),
    createdBy: "user",
    definition: {
      title: input.title,
      objective: input.objective,
      estimatedMinutes: input.estimatedMinutes,
      semantics: {
        type: input.type ?? "task",
        priority: input.priority,
      },
    },
  };
}

async function mutate(taskId: string, mutation: GraphMutationRequest) {
  return app().request(`http://local/api/tasks/${taskId}/plan/mutations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
}

describe("plan mutation routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("adds a node and edge through /plan/mutations", async () => {
    const { taskId } = await seedPlan();
    const res = await mutate(taskId, {
      reason: "Add auto-fix node",
      scope: "future_only",
      operations: [
        {
          type: "add_node",
          nodeId: "node-x",
          semanticKey: "node-x",
          definitionLayer: definitionLayer({
            nodeId: "node-x",
            title: "Auto-fix",
            objective: "Auto-fix lint issues",
            priority: "Low",
          }),
        },
        {
          type: "add_edge",
          edge: {
            id: "edge-cx",
            fromNodeId: "node-c",
            toNodeId: "node-x",
            type: "ordering",
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    });

    expect(res.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    expect(savedPlan?.effectivePlan.nodes.some((node) => node.id === "node-x")).toBe(true);
    expect(savedPlan?.effectivePlan.edges.some((edge) => edge.id === "edge-cx" && edge.active)).toBe(true);
  });

  it("pushes a new definition layer and updates node fields", async () => {
    const { taskId } = await seedPlan();
    const res = await mutate(taskId, {
      reason: "Rename research node",
      scope: "future_only",
      operations: [
        {
          type: "push_node_layer",
          nodeId: "node-a",
          layer: definitionLayer({
            nodeId: "node-a",
            title: "Deep Research",
            objective: "Comprehensive study",
            estimatedMinutes: 45,
            priority: "High",
          }),
        },
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
    const res = await mutate(taskId, {
      reason: "Remove design node",
      scope: "future_only",
      operations: [{ type: "delete_node", nodeId: "node-b" }],
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

  it("adds and removes dependencies through edge mutations", async () => {
    const { taskId } = await seedPlan();
    const addRes = await mutate(taskId, {
      reason: "Add cross dependency",
      scope: "future_only",
      operations: [
        {
          type: "add_edge",
          edge: {
            id: "edge-ac",
            fromNodeId: "node-a",
            toNodeId: "node-c",
            type: "hard_dependency",
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    });

    expect(addRes.status).toBe(200);

    const removeRes = await mutate(taskId, {
      reason: "Remove original dependency",
      scope: "future_only",
      operations: [{ type: "remove_edge", edgeId: "edge-bc" }],
    });

    expect(removeRes.status).toBe(200);
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    expect(savedPlan?.effectivePlan.edges.some((edge) => edge.id === "edge-ac" && edge.active)).toBe(true);
    expect(savedPlan?.effectivePlan.edges.some((edge) => edge.id === "edge-bc" && edge.active)).toBe(false);
  });

  it("returns 404 when task has no persisted plan", async () => {
    const workspace = await db.workspace.create({
      data: { name: "No Plan", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Task without plan",
        status: "Ready",
        priority: "Medium",
      },
    });

    const res = await mutate(task.id, {
      reason: "No-op",
      scope: "future_only",
      operations: [{ type: "delete_node", nodeId: "ghost-node" }],
    });

    expect(res.status).toBe(404);
  });

  it("materializes child tasks through the real route and writes linkedTaskId back into plan graph", async () => {
    const { taskId } = await seedPlan();

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      parentTaskId: string;
      childTasks: Array<{ id: string; parentTaskId: string }>;
    };
    expect(body.parentTaskId).toBe(taskId);
    expect(body.childTasks.length).toBeGreaterThan(0);
    expect(body.childTasks.every((task) => task.parentTaskId === taskId)).toBe(true);

    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    const linkedNodes = savedPlan?.effectivePlan.nodes.filter((node) => !!node.linkedTaskId) ?? [];
    expect(linkedNodes.length).toBeGreaterThan(0);
  });
});
