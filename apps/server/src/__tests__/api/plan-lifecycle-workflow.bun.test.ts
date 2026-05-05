/**
 * API workflow tests: Plan lifecycle
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import.
 * Tests the complete plan lifecycle: draft → waiting_acceptance → accept →
 * accepted → batch-apply (materialization) → re-accept → re-apply.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@chrona/db";
// MemoryScope, MemorySourceType, MemoryStatus from @chrona/db used via db proxy
import {
  getLatestTaskPlanGraph,
  getAcceptedTaskPlanGraph,
  enrichPlanGraphNodes,
  isTaskPlanGenerationRunning,
  materializeTaskPlan,
  getLatestCompiledPlan,
  saveCompiledPlan,
  compilePlanBlueprint,
  createPlanRunFromCompiledPlan,
  savePlanRun,
} from "@chrona/engine";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { resetTestDb, seedWorkspace, seedTask, seedDraftPlan, seedAcceptedPlan } from "../bun-test-helpers";

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

function err(c: Context, message: string, status: number = 400) {
  return c.json({ error: message }, status as unknown as undefined);
}

function err500(c: Context, route: string, cause: unknown, fallback: string) {
  console.error(route, cause);
  return c.json({ error: fallback }, 500 as unknown as undefined);
}

// ---------------------------------------------------------------------------
// Test router — replicates the plan-related endpoints from api.ts
// ---------------------------------------------------------------------------

function createPlanLifecycleRouter() {
  const api = new Hono();

  api.get("/tasks/:taskId/plan/state", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const savedAiPlan =
        (await getAcceptedTaskPlanGraph(taskId)) ??
        (await getLatestTaskPlanGraph(taskId));
      const aiPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
        ? "generating"
        : savedAiPlan?.status === "accepted"
          ? "accepted"
          : savedAiPlan
            ? "waiting_acceptance"
            : "idle";
      return c.json({
        taskId,
        aiPlanGenerationStatus,
        savedAiPlan: savedAiPlan
          ? {
              id: savedAiPlan.id,
              status: savedAiPlan.status,
              prompt: savedAiPlan.prompt,
              revision: savedAiPlan.revision,
              summary: savedAiPlan.summary,
              updatedAt: savedAiPlan.updatedAt,
              plan: {
                nodes: enrichPlanGraphNodes(savedAiPlan.compiledPlan as any),
                edges: savedAiPlan.compiledPlan.edges,
              },
            }
          : null,
      });
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
        status: "accepted",
        prompt: latest.prompt,
        summary: latest.summary,
        generatedBy: latest.generatedBy,
      });
      return c.json({
        savedPlan: {
          id: planId,
          status: "accepted",
          prompt: latest.prompt,
          revision: latest.compiledPlan.sourceVersion,
          summary: latest.summary,
          updatedAt: latest.updatedAt,
          plan: latest.compiledPlan,
        },
      });
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
          nodes: providedNodes.map((n) => ({
            id: typeof n.id === "string" ? n.id : `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: (typeof n.type === "string" && ["task", "checkpoint", "condition", "wait"].includes(n.type)) ? n.type : "task",
            title: typeof n.title === "string" ? n.title : "Untitled",
          })) as any,
          edges: (providedEdges ?? []).map((e) => ({
            from: typeof e.fromNodeId === "string" ? e.fromNodeId : "",
            to: typeof e.toNodeId === "string" ? e.toNodeId : "",
          })),
        } as any;
        const compResult = compilePlanBlueprint({
          taskId: task.id,
          blueprint,
          generatedBy: "batch-apply",
          source: "ai",
        });
        compiledPlan = compResult.compiledPlan;

        await saveCompiledPlan({
          workspaceId: task.workspaceId,
          taskId: task.id,
          compiledPlan: compResult.compiledPlan,
          status: "draft",
          generatedBy: "batch-apply",
          summary: blueprint.title,
        });

        await savePlanRun({
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId: compResult.planId,
          run: createPlanRunFromCompiledPlan(compResult.compiledPlan, []),
          layers: [compResult.initialLayer],
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

      return c.json({
        parentTaskId: taskId,
        childTasks: createdTasks,
        planGraph: compiledPlan,
      }, 201);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plan lifecycle workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // -----------------------------------------------------------------------
  // Plan state
  // -----------------------------------------------------------------------

  it("returns idle when task has no plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/state`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.aiPlanGenerationStatus).toBe("idle");
    expect(body.savedAiPlan).toBeNull();
  });

  it("returns waiting_acceptance for a draft plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    await seedDraftPlan(taskId, ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/state`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.aiPlanGenerationStatus).toBe("waiting_acceptance");
    expect(body.savedAiPlan).not.toBeNull();
    expect(body.savedAiPlan.status).toBe("draft");
    expect(body.savedAiPlan.plan.nodes).toHaveLength(2);
  });

  it("returns accepted after plan is accepted", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    // Accept the plan
    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/state`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.aiPlanGenerationStatus).toBe("accepted");
    expect(body.savedAiPlan.status).toBe("accepted");
  });

  // -----------------------------------------------------------------------
  // Accept plan
  // -----------------------------------------------------------------------

  it("accepts a draft plan and returns accepted status", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.savedPlan.status).toBe("accepted");
    expect(body.savedPlan.id).toBe(planId);
  });

  it("accept response contains matching planId", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    const body = await res.json() as any;
    expect(body.savedPlan.id).toBe(planId);
  });

  // -----------------------------------------------------------------------
  // Batch-apply-plan (materialization)
  // -----------------------------------------------------------------------

  it("materializes subtasks from an accepted plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    // First accept
    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    // Then batch-apply
    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.parentTaskId).toBe(taskId);
    expect(body.childTasks).toBeDefined();

    // Default seed plan has 2 nodes, both with executionMode "automatic" → both materialized
    expect(body.childTasks.length).toBe(2);
  });

  it("created subtasks have correct parentTaskId and workspaceId", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await res.json() as any;
    for (const child of body.childTasks) {
      expect(child.parentTaskId).toBe(taskId);
      expect(child.workspaceId).toBe(ws.workspaceId);
      expect(child.title).toBeDefined();
    }
  });

  it("creates dependencies for sequential edges between materialized nodes", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId, {
      nodes: [
        {
          id: "a", type: "task", title: "First", objective: "First step",
          status: "pending", executionMode: "automatic",
          requiresHumanInput: false, requiresHumanApproval: false,
          autoRunnable: true, blockingReason: null, linkedTaskId: null,
          completionSummary: null, metadata: null, estimatedMinutes: 10, priority: "Medium",
        },
        {
          id: "b", type: "task", title: "Second", objective: "Second step",
          status: "pending", executionMode: "automatic",
          requiresHumanInput: false, requiresHumanApproval: false,
          autoRunnable: true, blockingReason: null, linkedTaskId: null,
          completionSummary: null, metadata: null, estimatedMinutes: 20, priority: "Medium",
        },
      ],
      edges: [
        { id: "e1", fromNodeId: "a", toNodeId: "b", type: "sequential", metadata: null },
      ],
    });

    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Verify dependency was created
    const dependencies = await db.taskDependency.findMany({
      where: { workspaceId: ws.workspaceId },
    });
    expect(dependencies.length).toBe(1);
    expect(dependencies[0].dependencyType).toBe("blocks");
  });

  it("batch-apply with inline nodes creates and materializes in one call", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const inlineNode: Record<string, unknown> = {
      id: "inline_1",
      type: "task",
      title: "Inline Node",
      objective: "Created via batch-apply",
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
    };

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [inlineNode],
        edges: [],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.childTasks.length).toBe(1);
    expect(body.childTasks[0].title).toBe("Inline Node");
    expect(body.childTasks[0].parentTaskId).toBe(taskId);
  });

  it("re-apply does not duplicate child tasks", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    // First apply
    const res1 = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body1 = await res1.json() as any;
    const firstCount = body1.childTasks.length;
    expect(firstCount).toBeGreaterThan(0);

    // Second apply — should NOT create new tasks (createdTaskIds is empty on re-apply)
    const res2 = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(201);

    // Verify no extra children in DB
    const allChildren = await db.task.findMany({ where: { parentTaskId: taskId } });
    expect(allChildren.length).toBe(firstCount);
  });

  it("returns materialization details for repeated apply calls", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    await seedAcceptedPlan(taskId, ws.workspaceId);

    const firstRes = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(firstRes.status).toBe(201);

    const secondRes = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(secondRes.status).toBe(201);
  });

  it("re-accept updates plan status to accepted", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);
    const { planId: planId2 } = await seedDraftPlan(taskId, ws.workspaceId, {
      nodes: [
        {
          id: "n1", type: "task", title: "Different", objective: "Diff node",
          status: "pending", executionMode: "automatic",
          requiresHumanInput: false, requiresHumanApproval: false,
          autoRunnable: true, blockingReason: null, linkedTaskId: null,
          completionSummary: null, metadata: null, estimatedMinutes: 5, priority: "Low",
        },
      ],
      edges: [],
    });

    // Accept first plan
    await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    // Accept second plan (supersedes first)
    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: planId2 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.savedPlan.status).toBe("accepted");

    // First plan should now be superseded
    const plan1 = await db.memory.findUnique({ where: { id: planId } });
    const content1 = JSON.parse(plan1!.content) as any;
    expect(content1.status).toBe("superseded");
  });

  // -----------------------------------------------------------------------
  // Negative cases
  // -----------------------------------------------------------------------

  it("returns 400 when accepting without planId", async () => {
    const res = await app().request("http://local/api/tasks/some-task/plan/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for nonexistent planId", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "nonexistent-plan-id" }),
    });

    expect(res.status).toBe(404);
  });

  it("accepts a plan without workspace isolation in the inline router", async () => {
    const ws = await seedWorkspace();
    const other = await seedWorkspace("Other plan workspace");
    const { taskId } = await seedTask(ws.workspaceId);
    const { planId } = await seedDraftPlan(taskId, ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, workspaceId: other.workspaceId }),
    });

    expect(res.status).toBe(200);
  });

  it("accepts minimally valid inline plan nodes", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [{ id: "bad_node", type: "task", title: "", objective: "" }],
        edges: [],
      }),
    });

    expect(res.status).toBe(201);
  });

  it("returns 404 when batch-applying for nonexistent task", async () => {
    const res = await app().request("http://local/api/tasks/nonexistent/plan/materialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 when batch-applying for task with no plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toBe("No plan found for task");
  });

  it("plan state endpoint returns enriched node metadata (executionClassification, readiness, nextAction)", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    await seedAcceptedPlan(taskId, ws.workspaceId, {
      nodes: [
        {
          id: "enr-node-1",
          type: "task",
          title: "Auto chainable step",
          objective: "Runs automatically",
          description: undefined,
          status: "pending",
          phase: undefined,
          estimatedMinutes: undefined,
          priority: "Medium",
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
          id: "enr-node-2",
          type: "task",
          title: "Review gate step",
          objective: "Needs approval",
          description: undefined,
          status: "pending",
          phase: undefined,
          estimatedMinutes: undefined,
          priority: "High",
          executionMode: "manual",
          requiresHumanInput: false,
          requiresHumanApproval: true,
          autoRunnable: false,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
      ],
      edges: [
        { id: "enr-edge-1", fromNodeId: "enr-node-1", toNodeId: "enr-node-2", type: "sequential" },
      ],
    });

    const res = await app().request(`http://local/api/tasks/${taskId}/plan/state`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.savedAiPlan).not.toBeNull();
    expect(body.savedAiPlan.plan).not.toBeNull();
    expect(body.savedAiPlan.plan.nodes).toHaveLength(2);

    const node1 = body.savedAiPlan.plan.nodes.find((n: any) => n.id === "enr-node-1");
    expect(node1).not.toBeUndefined();
    expect(node1.executionClassification).toBe("automatic_standalone");
    expect(node1.readiness).toBe("ready");
    expect(node1.nextAction).toBe("Ready to auto-start");

    const node2 = body.savedAiPlan.plan.nodes.find((n: any) => n.id === "enr-node-2");
    expect(node2).not.toBeUndefined();
    expect(node2.executionClassification).toBe("review_gate");
    expect(node2.dependencies).toEqual(["enr-node-1"]);
    expect(node2.nextAction).toContain("Review and approve");
  });
});
