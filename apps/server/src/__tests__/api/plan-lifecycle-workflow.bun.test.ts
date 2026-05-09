import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@chrona/db";
import {
  isTaskPlanGenerationRunning,
  materializeTaskPlan,
  getLatestCompiledPlan,
  getLatestTaskPlanReadModel,
  saveCompiledPlan,
  compilePlanBlueprint,
  createPlanRunFromCompiledPlan,
  savePlanRun,
} from "@chrona/engine";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { resetTestDb, seedWorkspace, seedTask } from "../bun-test-helpers";

function err(c: Context, message: string, status: number = 400) {
  return c.json({ error: message }, status as unknown as undefined);
}

function err500(c: Context, route: string, cause: unknown, fallback: string) {
  console.error(route, cause);
  return c.json({ error: fallback }, 500 as unknown as undefined);
}

function createPlanLifecycleRouter() {
  const api = new Hono();

  api.get("/tasks/:taskId/plan", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const savedPlan = await getLatestTaskPlanReadModel(taskId);
      const aiPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
        ? "generating"
        : savedPlan?.status === "accepted"
          ? "accepted"
          : savedPlan
            ? "waiting_acceptance"
            : "idle";
      return c.json({ taskId, aiPlanGenerationStatus, savedPlan });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to get task plan state";
      return err(c, message, 500);
    }
  });

  api.post("/tasks/:taskId/plan/accept", async (c) => {
    try {
      const body = await c.req.json();
      const taskId = c.req.param("taskId");
      const planId = typeof body.planId === "string" ? body.planId : "";

      if (!planId) {
        return err(c, "planId is required", 400);
      }

      const latest = await getLatestCompiledPlan(taskId);
      if (!latest || latest.compiledPlan.editablePlanId !== planId) {
        return err(c, "Plan not found", 404);
      }
      await saveCompiledPlan({
        workspaceId: latest.workspaceId,
        taskId,
        compiledPlan: latest.compiledPlan,
        editablePlan: latest.editablePlan,
        status: "accepted",
        prompt: latest.prompt,
        summary: latest.summary,
        generatedBy: latest.generatedBy,
      });
      const savedPlan = await getLatestTaskPlanReadModel(taskId);
      return c.json({ savedPlan });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to accept task AI plan";
      return err(c, message, 500);
    }
  });

  api.post("/tasks/:taskId/plan/materialize", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { nodes: providedNodes, edges: providedEdges } = body as {
        nodes?: Record<string, unknown>[];
        edges?: Record<string, unknown>[];
      };

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return err(c, "Task not found", 404);
      }

      let compiledPlan: CompiledPlan;
      if (providedNodes && Array.isArray(providedNodes) && providedNodes.length > 0) {
        const blueprint = {
          title: `${providedNodes.length} planned step${providedNodes.length === 1 ? "" : "s"}`,
          goal: `${providedNodes.length} planned step${providedNodes.length === 1 ? "" : "s"}`,
          nodes: providedNodes.map((node) => ({
            id:
              typeof node.id === "string"
                ? node.id
                : `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type:
              typeof node.type === "string" &&
              ["task", "checkpoint", "condition", "wait"].includes(node.type)
                ? node.type
                : "task",
            title: typeof node.title === "string" ? node.title : "Untitled",
          })) as any,
          edges: (providedEdges ?? []).map((edge) => ({
            from: typeof edge.fromNodeId === "string" ? edge.fromNodeId : "",
            to: typeof edge.toNodeId === "string" ? edge.toNodeId : "",
          })),
        };

        const compResult = compilePlanBlueprint({
          taskId: task.id,
          blueprint: blueprint as any,
          generatedBy: "batch-apply",
          source: "ai",
        });
        compiledPlan = compResult.compiledPlan;

        await saveCompiledPlan({
          workspaceId: task.workspaceId,
          taskId: task.id,
          compiledPlan,
          status: "draft",
          generatedBy: "batch-apply",
          summary: blueprint.title,
        });

        await savePlanRun({
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId: compResult.planId,
          run: createPlanRunFromCompiledPlan(compiledPlan),
          compiledPlan,
        });
      } else {
        const latest = await getLatestCompiledPlan(taskId);
        if (!latest) {
          return err(c, "No plan found for task", 404);
        }
        compiledPlan = latest.compiledPlan;
      }

      const materialized = await materializeTaskPlan({ taskId: task.id });
      const createdTasks = await db.task.findMany({
        where: { id: { in: materialized.createdTaskIds } },
        include: { projection: true },
        orderBy: { createdAt: "asc" },
      });

      return c.json({ parentTaskId: taskId, childTasks: createdTasks, planGraph: compiledPlan }, 201);
    } catch (cause) {
      return err500(c, "POST /api/tasks/:taskId/plan/materialize", cause, "Failed to apply task plan");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createPlanLifecycleRouter());
  return a;
}

function makeCompiledPlan(input: {
  id: string;
  nodes?: Array<{
    id: string;
    type?: "task" | "checkpoint" | "condition" | "wait";
    title?: string;
    objective?: string;
    executionMode?: "automatic" | "manual";
    priority?: "Low" | "Medium" | "High" | "Urgent";
    estimatedMinutes?: number;
  }>;
  edges?: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
}): CompiledPlan {
  const baseNodes =
    input.nodes ?? [
      {
        id: "node-1",
        type: "task",
        title: "Research",
        objective: "Research the topic",
        executionMode: "automatic",
        estimatedMinutes: 30,
        priority: "High",
      },
      {
        id: "node-2",
        type: "task",
        title: "Implement",
        objective: "Implement the solution",
        executionMode: "automatic",
        estimatedMinutes: 60,
        priority: "Medium",
      },
    ];

  const baseEdges = input.edges ?? [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2" }];

  return {
    id: `${input.id}-compiled`,
    editablePlanId: input.id,
    sourceVersion: 1,
    title: "Test plan",
    goal: "Test goal",
    assumptions: [],
    nodes: baseNodes.map((node, index) => ({
      id: node.id,
      localId: node.id,
      type: node.type ?? "task",
      title: node.title ?? node.id,
      config:
        (node.type ?? "task") === "checkpoint"
          ? { checkpointType: "approve", prompt: node.objective ?? node.title ?? node.id, required: true }
          : { expectedOutput: node.objective ?? node.title ?? node.id },
      dependencies: baseEdges.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId),
      dependents: baseEdges.filter((edge) => edge.fromNodeId === node.id).map((edge) => edge.toNodeId),
      executor: node.executionMode === "manual" ? "user" : "ai",
      mode: node.executionMode === "manual" ? "manual" : "auto",
      estimatedMinutes: node.estimatedMinutes ?? (index + 1) * 15,
      priority: node.priority ?? "Medium",
    })),
    edges: baseEdges.map((edge) => ({ id: edge.id, from: edge.fromNodeId, to: edge.toNodeId })),
    entryNodeIds: baseNodes.filter((node) => !baseEdges.some((edge) => edge.toNodeId === node.id)).map((node) => node.id),
    terminalNodeIds: baseNodes.filter((node) => !baseEdges.some((edge) => edge.fromNodeId === node.id)).map((node) => node.id),
    topologicalOrder: baseNodes.map((node) => node.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

async function seedSavedCompiledPlan(input: {
  taskId: string;
  workspaceId: string;
  status: "draft" | "accepted";
  planId?: string;
  nodes?: Parameters<typeof makeCompiledPlan>[0]["nodes"];
  edges?: Parameters<typeof makeCompiledPlan>[0]["edges"];
}) {
  const compiledPlan = makeCompiledPlan({
    id: input.planId ?? `plan_${Date.now()}`,
    nodes: input.nodes,
    edges: input.edges,
  });

  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    compiledPlan,
    status: input.status,
    prompt: compiledPlan.title,
    summary: compiledPlan.goal,
    generatedBy: "test-fixture",
  });

  return { planId: compiledPlan.editablePlanId, compiledPlan };
}

describe("Plan lifecycle workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns idle when task has no plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.aiPlanGenerationStatus).toBe("idle");
    expect(body.savedPlan).toBeNull();
  });

  it("returns waiting_acceptance for a draft compiled plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    await seedSavedCompiledPlan({ taskId, workspaceId: ws.workspaceId, status: "draft", planId: "draft-plan" });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.aiPlanGenerationStatus).toBe("waiting_acceptance");
    expect(body.savedPlan.status).toBe("draft");
    expect(body.savedPlan.compiledPlan.nodes).toHaveLength(2);
  });

  it("accepts a draft compiled plan and returns accepted status", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedSavedCompiledPlan({ taskId, workspaceId: ws.workspaceId, status: "draft", planId: "accept-plan" });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.savedPlan.status).toBe("accepted");
    expect(body.savedPlan.id).toBe(planId);
  });

  it("returns accepted after plan is accepted", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedSavedCompiledPlan({ taskId, workspaceId: ws.workspaceId, status: "draft", planId: "accepted-state-plan" });

    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan`);
    const body = (await res.json()) as any;
    expect(body.aiPlanGenerationStatus).toBe("accepted");
    expect(body.savedPlan.status).toBe("accepted");
  });

  it("materializes subtasks from an accepted compiled plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    await seedSavedCompiledPlan({ taskId, workspaceId: ws.workspaceId, status: "accepted", planId: "materialize-plan" });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.parentTaskId).toBe(taskId);
    expect(body.childTasks.length).toBe(2);
  });

  it("creates dependencies for sequential edges between materialized nodes", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    await seedSavedCompiledPlan({
      taskId,
      workspaceId: ws.workspaceId,
      status: "accepted",
      planId: "dependency-plan",
      nodes: [
        { id: "a", title: "First", objective: "First step", executionMode: "automatic" },
        { id: "b", title: "Second", objective: "Second step", executionMode: "automatic" },
      ],
      edges: [{ id: "e1", fromNodeId: "a", toNodeId: "b" }],
    });

    await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const dependencies = await db.taskDependency.findMany({ where: { workspaceId: ws.workspaceId } });
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]?.dependencyType).toBe("blocks");
  });

  it("batch-applies inline nodes and materializes them in one call", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [
          {
            id: "inline_1",
            type: "task",
            title: "Inline Node",
            objective: "Created via batch-apply",
          },
        ],
        edges: [],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.childTasks).toHaveLength(1);
    expect(body.childTasks[0]?.title).toBe("Inline Node");
  });
});
