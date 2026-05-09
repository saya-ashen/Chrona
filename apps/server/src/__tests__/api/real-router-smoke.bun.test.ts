import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { saveCompiledPlan } from "@chrona/engine";
import type { CompiledPlan, ConditionConfig } from "@chrona/contracts/ai";

import { createApiRouter } from "../../routes/api";
import {
  expectApiError,
  json,
  resetTestDb,
  seedTask,
  seedWorkspace,
} from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter());
  return server;
}

function makeSmokeCompiledPlan(planId: string): CompiledPlan {
  const reviewConfig: ConditionConfig = {
    condition: "Choose execution path",
    evaluationBy: "user",
    branches: [{ label: "continue", nextNodeId: "draft_summary" }],
  };

  return {
    id: `compiled_${planId}`,
    editablePlanId: planId,
    sourceVersion: 1,
    title: "Smoke plan",
    goal: "Materialize child tasks through production router",
    assumptions: [],
    nodes: [
      {
        id: "collect_inputs",
        localId: "collect_inputs",
        type: "task",
        title: "Collect inputs",
        description: "Gather the necessary context",
        config: { expectedOutput: "Collected inputs" },
        dependencies: [],
        dependents: ["draft_summary"],
        mode: "auto",
        executor: "ai",
        priority: "High",
      },
      {
        id: "draft_summary",
        localId: "draft_summary",
        type: "task",
        title: "Draft summary",
        description: "Prepare the final summary",
        config: { expectedOutput: "Draft summary" },
        dependencies: ["collect_inputs"],
        dependents: [],
        mode: "auto",
        executor: "ai",
        priority: "Medium",
      },
      {
        id: "review_gate",
        localId: "review_gate",
        type: "condition",
        title: "Review gate",
        description: "Keep one non-materialized node in the graph",
        config: reviewConfig,
        dependencies: [],
        dependents: [],
        mode: "manual",
        executor: "user",
        priority: "Medium",
      },
    ],
    edges: [
      {
        id: "edge_collect_to_draft",
        from: "collect_inputs",
        to: "draft_summary",
      },
    ],
    entryNodeIds: ["collect_inputs", "review_gate"],
    terminalNodeIds: ["draft_summary", "review_gate"],
    topologicalOrder: ["collect_inputs", "draft_summary", "review_gate"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

describe("Real router smoke", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("runs task CRUD through the production router", async () => {
    const { workspaceId } = await seedWorkspace("Real Router CRUD");

    const createRes = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "Router-created task",
        description: "Smoke coverage",
        priority: "High",
        scheduledStartAt: "2026-05-02T09:00:00.000Z",
        scheduledEndAt: "2026-05-02T10:00:00.000Z",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await json<{ taskId: string; workspaceId: string }>(createRes);
    expect(created.workspaceId).toBe(workspaceId);

    const getRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
    );
    expect(getRes.status).toBe(200);
    const getBody = await json<{ task: { title: string; description: string | null } }>(getRes);
    expect(getBody.task.title).toBe("Router-created task");
    expect(getBody.task.description).toBe("Smoke coverage");

    const patchRes = await app().request(`http://local/api/tasks/${created.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "Router-updated task",
        status: "Blocked",
        scheduledStartAt: "2026-05-02T10:00:00.000Z",
        scheduledEndAt: "2026-05-02T11:30:00.000Z",
      }),
    });
    expect(patchRes.status).toBe(200);

    const verifyRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
    );
    const verifyBody = await json<{ task: { title: string; status: string } }>(verifyRes);
    expect(verifyBody.task.title).toBe("Router-updated task");
    expect(verifyBody.task.status).toBe("Blocked");

    const deleteRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);

    const missingRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
    );
    await expectApiError(missingRes, 404);
  });

  it("runs plan accept and materialize through the production router", async () => {
    const { workspaceId } = await seedWorkspace("Real Router Plan");
    const { taskId } = await seedTask(workspaceId, { title: "Plan parent" });
    const compiledPlan = makeSmokeCompiledPlan("real-router-plan");

    await saveCompiledPlan({
      workspaceId,
      taskId,
      compiledPlan,
      status: "draft",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "real-router-smoke",
    });

    const acceptRes = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: compiledPlan.editablePlanId, workspaceId }),
    });
    expect(acceptRes.status).toBe(200);

    const stateRes = await app().request(`http://local/api/tasks/${taskId}/plan`);
    expect(stateRes.status).toBe(200);
    const stateBody = await json<{
      aiPlanGenerationStatus: string;
      savedPlan: { id: string; status: string; compiledPlan: { nodes: unknown[] } } | null;
    }>(stateRes);
    expect(stateBody.aiPlanGenerationStatus).toBe("accepted");
    expect(stateBody.savedPlan?.id).toBe(compiledPlan.editablePlanId);
    expect(stateBody.savedPlan?.compiledPlan.nodes.length).toBeGreaterThan(0);

    const applyRes = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    expect(applyRes.status).toBe(201);
    const applyBody = await json<{
      parentTaskId: string;
      childTasks: Array<{ parentTaskId: string }>;
      planGraph: { nodes: Array<{ linkedTaskId?: string | null }> };
    }>(applyRes);
    expect(applyBody.parentTaskId).toBe(taskId);
    expect(applyBody.childTasks.length).toBe(2);
    expect(applyBody.childTasks.every((task) => task.parentTaskId === taskId)).toBe(true);
    expect(applyBody.planGraph.nodes.filter((node) => node.linkedTaskId).length).toBe(0);

    const reapplyRes = await app().request(`http://local/api/tasks/${taskId}/plan/materialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    expect(reapplyRes.status).toBe(201);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: taskId },
      orderBy: { createdAt: "asc" },
    });
    expect(childTasks).toHaveLength(2);
  });

  it("runs schedule proposal create, accept, and reject through the production router", async () => {
    const { workspaceId } = await seedWorkspace("Real Router Schedule");
    const { taskId: acceptedTaskId } = await seedTask(workspaceId, { title: "Scheduled task" });
    const { taskId: rejectedTaskId } = await seedTask(workspaceId, { title: "Rejected task" });

    const createAcceptedRes = await app().request(
      `http://local/api/tasks/${acceptedTaskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          source: "ai",
          proposedBy: "planner",
          summary: "Use the open slot",
          dueAt: "2026-05-03T18:00:00.000Z",
          scheduledStartAt: "2026-05-03T09:00:00.000Z",
          scheduledEndAt: "2026-05-03T10:30:00.000Z",
        }),
      },
    );
    expect(createAcceptedRes.status).toBe(201);
    const acceptedProposal = await json<{ proposalId: string }>(createAcceptedRes);

    const acceptRes = await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: acceptedProposal.proposalId, decision: "Accepted", workspaceId }),
    });
    expect(acceptRes.status).toBe(200);

    const acceptedBlock = await db.workBlock.findFirstOrThrow({
      where: { taskId: acceptedTaskId, status: { in: ["Scheduled", "Active"] } },
      orderBy: { scheduledStartAt: "asc" },
    });
    const acceptedProjection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: acceptedTaskId } });
    expect(acceptedBlock.scheduledStartAt?.toISOString()).toBe("2026-05-03T09:00:00.000Z");
    expect(acceptedBlock.scheduledEndAt?.toISOString()).toBe("2026-05-03T10:30:00.000Z");
    expect(acceptedProjection.scheduledStartAt?.toISOString()).toBe("2026-05-03T09:00:00.000Z");
    expect(acceptedProjection.scheduledEndAt?.toISOString()).toBe("2026-05-03T10:30:00.000Z");

    const createRejectedRes = await app().request(
      `http://local/api/tasks/${rejectedTaskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          source: "human",
          proposedBy: "user-1",
          summary: "Too early",
          scheduledStartAt: "2026-05-04T06:00:00.000Z",
          scheduledEndAt: "2026-05-04T07:00:00.000Z",
        }),
      },
    );
    expect(createRejectedRes.status).toBe(201);
    const rejectedProposal = await json<{ proposalId: string }>(createRejectedRes);

    const rejectRes = await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: rejectedProposal.proposalId, decision: "Rejected", workspaceId }),
    });
    expect(rejectRes.status).toBe(200);

    const rejectedBlock = await db.workBlock.findFirst({
      where: { taskId: rejectedTaskId, status: { in: ["Scheduled", "Active"] } },
    });
    const rejectedProjection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: rejectedTaskId } });
    expect(rejectedBlock).toBeNull();
    expect(rejectedProjection.scheduledStartAt).toBeNull();
    expect(rejectedProjection.scheduledEndAt).toBeNull();
  });
});
