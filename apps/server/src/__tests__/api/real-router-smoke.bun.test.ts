import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";

import { createApiRouter } from "../../routes/api";
import {
  expectApiError,
  json,
  resetTestDb,
  seedAcceptedPlan,
  seedTask,
  seedWorkspace,
} from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter());
  return server;
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
    const { planId } = await seedAcceptedPlan(taskId, workspaceId);

    const acceptRes = await app().request("http://local/api/ai/task-plan/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, planId, workspaceId }),
    });
    expect(acceptRes.status).toBe(200);

    const stateRes = await app().request(`http://local/api/tasks/${taskId}/plan-state`);
    expect(stateRes.status).toBe(200);
    const stateBody = await json<{
      aiPlanGenerationStatus: string;
      savedAiPlan: { id: string; status: string; plan: { nodes: unknown[] } } | null;
    }>(stateRes);
    expect(stateBody.aiPlanGenerationStatus).toBe("accepted");
    expect(stateBody.savedAiPlan?.id).toBe(planId);
    expect(stateBody.savedAiPlan?.plan.nodes.length).toBeGreaterThan(0);

    const applyRes = await app().request("http://local/api/ai/batch-apply-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, workspaceId }),
    });
    expect(applyRes.status).toBe(201);
    const applyBody = await json<{
      parentTaskId: string;
      childTasks: Array<{ parentTaskId: string }>;
      materialization: { createdTaskIds: string[]; updatedNodeIds: string[]; skippedNodeIds: string[] };
    }>(applyRes);
    expect(applyBody.parentTaskId).toBe(taskId);
    expect(applyBody.childTasks.length).toBe(2);
    expect(applyBody.childTasks.every((task) => task.parentTaskId === taskId)).toBe(true);
    expect(applyBody.materialization.createdTaskIds.length).toBe(2);

    const reapplyRes = await app().request("http://local/api/ai/batch-apply-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, workspaceId }),
    });
    expect(reapplyRes.status).toBe(201);
    const reapplyBody = await json<{
      materialization: { createdTaskIds: string[]; updatedNodeIds: string[]; skippedNodeIds: string[] };
    }>(reapplyRes);
    expect(reapplyBody.materialization.createdTaskIds).toHaveLength(0);
    expect(reapplyBody.materialization.updatedNodeIds.length).toBeGreaterThan(0);
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

    const acceptRes = await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: acceptedProposal.proposalId, decision: "Accepted", workspaceId }),
    });
    expect(acceptRes.status).toBe(200);

    const acceptedTask = await db.task.findUniqueOrThrow({ where: { id: acceptedTaskId } });
    expect(acceptedTask.scheduledStartAt?.toISOString()).toBe("2026-05-03T09:00:00.000Z");
    expect(acceptedTask.scheduledEndAt?.toISOString()).toBe("2026-05-03T10:30:00.000Z");

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

    const rejectRes = await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: rejectedProposal.proposalId, decision: "Rejected", workspaceId }),
    });
    expect(rejectRes.status).toBe(200);

    const rejectedTask = await db.task.findUniqueOrThrow({ where: { id: rejectedTaskId } });
    expect(rejectedTask.scheduledStartAt).toBeNull();
    expect(rejectedTask.scheduledEndAt).toBeNull();
  });
});
