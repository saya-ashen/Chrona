import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  acceptTaskPlanGraph,
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  getReadyAutoRunnableNodes,
} from "@/modules/tasks/task-plan-graph-store";
import type { TaskPlanGraph } from "@/modules/ai/types";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("task-plan-graph-store", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("loads graph-native plans with execution semantics", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Graph Store", status: "Active", defaultRuntime: "openclaw" },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Graph plan task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
        confidence: 0.7,
        content: JSON.stringify({
          type: "task_plan_graph_v1",
          status: "draft",
          revision: 1,
          source: "ai",
          generatedBy: "graph-store-test",
          prompt: "graph only",
          summary: "Two nodes",
          changeSummary: null,
          nodes: [
            {
              id: "node-1",
              type: "step",
              title: "Auto step",
              objective: "Do something automatically",
              description: null,
              status: "pending",
              phase: null,
              estimatedMinutes: 30,
              priority: "High",
              executionMode: "automatic",
              requiresHumanInput: false,
              requiresHumanApproval: false,
              autoRunnable: true,
              blockingReason: null,
              linkedTaskId: null,
              completionSummary: null,
              metadata: null,
            },
            {
              id: "node-2",
              type: "user_input",
              title: "Manual approval",
              objective: "Wait for user approval",
              description: null,
              status: "pending",
              phase: null,
              estimatedMinutes: 5,
              priority: "Medium",
              executionMode: "manual",
              requiresHumanInput: true,
              requiresHumanApproval: true,
              autoRunnable: false,
              blockingReason: "needs_approval",
              linkedTaskId: null,
              completionSummary: null,
              metadata: null,
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential" },
          ],
        }),
      },
    });

    const stored = await getLatestTaskPlanGraph(task.id);

    expect(stored).not.toBeNull();
    expect(stored?.plan.nodes).toHaveLength(2);
    expect(stored?.plan.nodes[0]?.autoRunnable).toBe(true);
    expect(stored?.plan.nodes[0]?.executionMode).toBe("automatic");
    expect(stored?.plan.nodes[1]?.autoRunnable).toBe(false);
    expect(stored?.plan.nodes[1]?.requiresHumanApproval).toBe(true);
    expect(stored?.plan.nodes[1]?.blockingReason).toBe("needs_approval");
  });

  it("accepts a graph plan", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Graph Accept", status: "Active", defaultRuntime: "openclaw" },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Graph plan task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const created = await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
        confidence: 0.7,
        content: JSON.stringify({
          type: "task_plan_graph_v1",
          status: "draft",
          revision: 3,
          source: "ai",
          generatedBy: "test",
          prompt: "focus on checkpoints",
          summary: "Two-step plan",
          changeSummary: null,
          nodes: [
            {
              id: "node-1",
              type: "step",
              title: "Collect inputs",
              objective: "Gather requirements",
              description: null,
              status: "pending",
              phase: null,
              estimatedMinutes: 15,
              priority: "High",
              executionMode: "automatic",
              requiresHumanInput: false,
              requiresHumanApproval: false,
              autoRunnable: true,
              blockingReason: null,
              linkedTaskId: null,
              completionSummary: null,
              metadata: null,
            },
          ],
          edges: [],
        }),
      },
    });

    const accepted = await acceptTaskPlanGraph({ planId: created.id, taskId: task.id });
    const storedAccepted = await getAcceptedTaskPlanGraph(task.id);

    expect(accepted.status).toBe("accepted");
    expect(storedAccepted?.id).toBe(created.id);
    expect(storedAccepted?.status).toBe("accepted");
    expect(storedAccepted?.plan.revision).toBe(3);
  });
});

describe("getReadyAutoRunnableNodes", () => {
  const makeGraph = (nodes: TaskPlanGraph["nodes"], edges: TaskPlanGraph["edges"]): TaskPlanGraph => ({
    id: "test-graph",
    taskId: "test-task",
    status: "accepted",
    revision: 1,
    source: "ai",
    generatedBy: "test",
    prompt: null,
    summary: null,
    changeSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  });

  const autoNode = (id: string, status: "pending" | "done" = "pending") => ({
    id,
    type: "step" as const,
    title: `Auto ${id}`,
    objective: `Do ${id}`,
    description: null,
    status,
    phase: null,
    estimatedMinutes: 30,
    priority: "Medium" as const,
    executionMode: "automatic" as const,
    requiresHumanInput: false,
    requiresHumanApproval: false,
    autoRunnable: true,
    blockingReason: null,
    linkedTaskId: null,
    completionSummary: null,
    metadata: null,
  });

  const manualNode = (id: string, status: "pending" | "done" = "pending") => ({
    id,
    type: "user_input" as const,
    title: `Manual ${id}`,
    objective: `Wait ${id}`,
    description: null,
    status,
    phase: null,
    estimatedMinutes: 5,
    priority: "Medium" as const,
    executionMode: "manual" as const,
    requiresHumanInput: true,
    requiresHumanApproval: false,
    autoRunnable: false,
    blockingReason: "needs_user_input" as const,
    linkedTaskId: null,
    completionSummary: null,
    metadata: null,
  });

  const edge = (from: string, to: string) => ({
    id: `edge-${from}-${to}`,
    fromNodeId: from,
    toNodeId: to,
    type: "sequential" as const,
    metadata: null,
  });

  it("returns auto-runnable nodes with no dependencies", () => {
    const graph = makeGraph(
      [autoNode("a"), autoNode("b"), manualNode("c")],
      [],
    );
    const ready = getReadyAutoRunnableNodes(graph);
    expect(ready.map(n => n.id).sort()).toEqual(["a", "b"]);
  });

  it("returns auto nodes whose dependencies are all done", () => {
    const graph = makeGraph(
      [autoNode("a", "done"), autoNode("b"), manualNode("c")],
      [edge("a", "b")],
    );
    const ready = getReadyAutoRunnableNodes(graph);
    expect(ready.map(n => n.id)).toEqual(["b"]);
  });

  it("blocks auto nodes behind incomplete manual nodes", () => {
    // a(auto,done) -> m(manual,pending) -> b(auto,pending)
    const graph = makeGraph(
      [autoNode("a", "done"), manualNode("m"), autoNode("b")],
      [edge("a", "m"), edge("m", "b")],
    );
    const ready = getReadyAutoRunnableNodes(graph);
    // m is manual so not auto-runnable, b is blocked by m
    expect(ready).toEqual([]);
  });

  it("allows auto nodes before manual nodes to run independently", () => {
    // a(auto) and m(manual) are independent, b(auto) depends on m
    const graph = makeGraph(
      [autoNode("a"), manualNode("m"), autoNode("b")],
      [edge("m", "b")],
    );
    const ready = getReadyAutoRunnableNodes(graph);
    // a has no deps so it's ready; b is blocked by m
    expect(ready.map(n => n.id)).toEqual(["a"]);
  });

  it("allows parallel auto nodes after manual node completes", () => {
    // m(manual,done) -> a(auto), m -> b(auto)
    const graph = makeGraph(
      [manualNode("m", "done"), autoNode("a"), autoNode("b")],
      [edge("m", "a"), edge("m", "b")],
    );
    const ready = getReadyAutoRunnableNodes(graph);
    expect(ready.map(n => n.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty when no nodes exist", () => {
    const graph = makeGraph([], []);
    expect(getReadyAutoRunnableNodes(graph)).toEqual([]);
  });

  it("returns empty when all auto nodes are already done", () => {
    const graph = makeGraph(
      [autoNode("a", "done"), autoNode("b", "done")],
      [edge("a", "b")],
    );
    expect(getReadyAutoRunnableNodes(graph)).toEqual([]);
  });
});
