import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";

import { db } from "@chrona/db";
import type { TaskPlan } from "@chrona/db/generated/prisma/client";
import { getLatestCompiledPlan, saveCompiledPlan } from "@chrona/engine/test-support";
import { getLatestTaskPlanReadModel } from "@chrona/engine/test-support";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function err(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as never);
}

function createPlanLifecycleEdgeRouter() {
  const api = new Hono();

  api.get("/tasks/:taskId/plan", async (c) => {
    const taskId = c.req.param("taskId");
    const savedPlan = await getLatestTaskPlanReadModel(taskId);
    return c.json({
      taskId,
      aiPlanGenerationStatus: savedPlan?.status === "accepted" ? "accepted" : savedPlan ? "waiting_acceptance" : "idle",
      savedPlan,
    });
  });

  api.post("/tasks/:taskId/plan/accept", async (c) => {
    const taskId = c.req.param("taskId");
    const body = await c.req.json() as { planId?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return err(c, "planId is required", 400);

    const latest = await getLatestCompiledPlan(taskId);
    if (!latest || latest.compiledPlan.editablePlanId !== planId) return err(c, "Plan not found", 404);

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
    return c.json({ savedPlan: await getLatestTaskPlanReadModel(taskId) });
  });

  return api;
}

function app() {
  const server = new Hono();
  server.route("/api", createPlanLifecycleEdgeRouter());
  return server;
}

function plan(id: string, nodeId = "node-1"): CompiledPlan {
  return {
    id: `${id}-compiled`,
    editablePlanId: id,
    sourceVersion: 1,
    title: `Plan ${id}`,
    goal: "Validate lifecycle edge behavior",
    assumptions: [],
    nodes: [{
      id: nodeId,
      localId: nodeId,
      type: "task",
      title: `Task ${nodeId}`,
      config: { expectedOutput: "done" },
      dependencies: [],
      dependents: [],
      executor: "ai",
      mode: "auto",
    }],
    edges: [],
    entryNodeIds: [nodeId],
    terminalNodeIds: [nodeId],
    topologicalOrder: [nodeId],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

async function seedPlan(input: { workspaceId: string; taskId: string; plan: CompiledPlan; status: "draft" | "accepted" }) {
  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    compiledPlan: input.plan,
    status: input.status,
    prompt: input.plan.title,
    summary: input.plan.goal,
    generatedBy: "plan-lifecycle-edge-test",
  });
}

describe("plan lifecycle edge workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("rejects accepting a superseded draft when a newer plan exists", async () => {
    const { workspaceId } = await seedWorkspace("Plan edge workflow");
    const { taskId } = await seedTask(workspaceId);
    await seedPlan({ workspaceId, taskId, plan: plan("older-plan", "old-node"), status: "draft" });
    await seedPlan({ workspaceId, taskId, plan: plan("newer-plan", "new-node"), status: "draft" });

    const response = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "older-plan" }),
    });

    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toBe("Plan not found");
    const latest = await getLatestTaskPlanReadModel(taskId);
    expect(latest?.id).toBe("newer-plan");
    expect(latest?.status).toBe("draft");
  });

  it("accepting latest plan supersedes previously accepted plans", async () => {
    const { workspaceId } = await seedWorkspace("Plan supersede workflow");
    const { taskId } = await seedTask(workspaceId);
    await seedPlan({ workspaceId, taskId, plan: plan("accepted-plan", "accepted-node"), status: "accepted" });
    await seedPlan({ workspaceId, taskId, plan: plan("replacement-plan", "replacement-node"), status: "draft" });

    const response = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "replacement-plan" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { savedPlan: { id: string; status: string } };
    expect(body.savedPlan).toMatchObject({ id: "replacement-plan", status: "accepted" });

    const taskPlans = await db.taskPlan.findMany({ where: { taskId }, orderBy: { planId: "asc" } });
    expect(taskPlans.map((item: TaskPlan) => [item.planId, item.status])).toEqual([
      ["accepted-plan", "Superseded"],
      ["replacement-plan", "Accepted"],
    ]);
  });

  it("keeps empty and malformed accept requests from changing latest plan state", async () => {
    const { workspaceId } = await seedWorkspace("Plan invalid accept workflow");
    const { taskId } = await seedTask(workspaceId);
    await seedPlan({ workspaceId, taskId, plan: plan("draft-plan"), status: "draft" });

    const missing = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const wrongType = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: 42 }),
    });

    expect(missing.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect((await getLatestTaskPlanReadModel(taskId))?.status).toBe("draft");
  });
});
