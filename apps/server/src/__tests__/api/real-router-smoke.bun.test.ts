import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db, TaskPlanGenerationHeadStatus } from "@chrona/db";
import { createChronaEngine, subscribeToTaskProjectionEvents, type TaskProjectionEvent } from "@chrona/engine";
import { saveCompiledPlan } from "@chrona/engine/test-support";
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
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedPlanAcceptanceHead(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  workBlockId?: string | null;
}) {
  await db.taskPlanGenerationHead.upsert({
    where: {
      taskId_workBlockScopeKey: {
        taskId: input.taskId,
        workBlockScopeKey: input.workBlockId ?? "",
      },
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      workBlockScopeKey: input.workBlockId ?? "",
      currentPlanId: input.planId,
      currentPlanStatus: "Draft",
      status: TaskPlanGenerationHeadStatus.Current,
      stateVersion: 0,
    },
    update: {
      currentPlanId: input.planId,
      currentPlanStatus: "Draft",
      status: TaskPlanGenerationHeadStatus.Current,
      stateVersion: 0,
    },
  });
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
    goal: "Accept plan through production router",
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

function makeWaitExecutionPlan(planId: string): CompiledPlan {
  return {
    id: `compiled_${planId}`,
    editablePlanId: planId,
    sourceVersion: 1,
    title: "Execution stream plan",
    goal: "Pause on an external wait node",
    assumptions: [],
    nodes: [
      {
        id: "wait_for_user",
        localId: "wait_for_user",
        type: "wait",
        title: "Wait for user input",
        description: "Stop execution until the UI can react",
        config: { waitFor: "user confirmation" },
        dependencies: [],
        dependents: [],
        mode: "manual",
        executor: "user",
        priority: "Medium",
      },
    ],
    edges: [],
    entryNodeIds: ["wait_for_user"],
    terminalNodeIds: ["wait_for_user"],
    topologicalOrder: ["wait_for_user"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function parseSseEvents(text: string) {
  return text
    .trim()
    .split(/\n\n+/)
    .map((chunk) => {
      const event = chunk.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = chunk.match(/^data: (.+)$/m)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
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

    const deleteImpactRes = await app().request(
      `http://local/api/tasks/${created.taskId}/delete-impact?workspaceId=${workspaceId}`,
    );
    const deleteImpact = await json<{ taskIds: string[]; assets: Array<{ id: string }> }>(deleteImpactRes);

    const deleteRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedTaskIds: deleteImpact.taskIds,
          expectedAssetIds: deleteImpact.assets.map((asset) => asset.id),
        }),
      },
    );
    expect(deleteRes.status).toBe(200);

    const missingRes = await app().request(
      `http://local/api/tasks/${created.taskId}?workspaceId=${workspaceId}`,
    );
    await expectApiError(missingRes, 404);
  });

  it("redacts AI client secrets from production router responses", async () => {
    const createRes = await app().request("http://local/api/ai/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Secured Hermes",
        type: "hermes",
        config: {
          baseUrl: "http://127.0.0.1:8642",
          apiKey: "hermes-secret",
          timeoutMs: 30000,
          env: {
            ANTHROPIC_API_KEY: "nested-secret",
            CUSTOM_TOKEN: "nested-token",
          },
          nested: [{ secret: "also-secret" }],
        },
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await json<{ client: { id: string; config: Record<string, unknown> } }>(createRes);
    expect(created.client.config).toEqual({
      baseUrl: "http://127.0.0.1:8642",
      timeoutMs: 30000,
      env: {
        ANTHROPIC_API_KEY: true,
        CUSTOM_TOKEN: true,
      },
    });

    const listRes = await app().request("http://local/api/ai/clients");
    expect(listRes.status).toBe(200);
    const listBody = await json<{ clients: Array<{ config: Record<string, unknown> }> }>(listRes);
    expect(listBody.clients[0].config).toEqual(created.client.config);

    const updateRes = await app().request(`http://local/api/ai/clients/${created.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          baseUrl: "http://localhost:8642",
          apiKey: "",
          timeoutMs: 45000,
        },
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = await json<{ client: { config: Record<string, unknown> } }>(updateRes);
    expect(updated.client.config).toEqual({
      baseUrl: "http://localhost:8642",
      timeoutMs: 45000,
      env: {
        ANTHROPIC_API_KEY: true,
        CUSTOM_TOKEN: true,
      },
    });

    const stored = await db.aiClient.findUniqueOrThrow({ where: { id: created.client.id } });
    expect(stored.config).toMatchObject({ apiKey: "hermes-secret" });
  });

  it("runs plan accept through the production router", async () => {
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
    await seedPlanAcceptanceHead({ workspaceId, taskId, planId: compiledPlan.editablePlanId });

    const acceptRes = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: compiledPlan.editablePlanId, workspaceId, expectedHeadStateVersion: 0, idempotencyKey: "real-router-plan-accept" }),
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
  });

  it("accepts a plan by plan id without moving it to a neighboring work block", async () => {
    const { workspaceId } = await seedWorkspace("Real Router Scoped Plan");
    const { taskId } = await seedTask(workspaceId, { title: "Scoped recurring plan parent" });
    const sourceBlock = await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Today scoped occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-08T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Tomorrow neighboring occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-09T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-09T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    const compiledPlan = makeSmokeCompiledPlan("real-router-scoped-plan");

    await saveCompiledPlan({
      workspaceId,
      taskId,
      workBlockId: sourceBlock.id,
      compiledPlan,
      status: "draft",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "real-router-smoke",
    });
    await seedPlanAcceptanceHead({
      workspaceId,
      taskId,
      planId: compiledPlan.editablePlanId,
      workBlockId: sourceBlock.id,
    });

    const acceptRes = await app().request(`http://local/api/tasks/${taskId}/plan/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: compiledPlan.editablePlanId, workspaceId, workBlockId: sourceBlock.id, expectedHeadStateVersion: 0, idempotencyKey: "real-router-scoped-plan-accept" }),
    });

    expect(acceptRes.status).toBe(200);
    const stored = await db.taskPlan.findUniqueOrThrow({ where: { planId: compiledPlan.editablePlanId } });
    expect(stored.status).toBe("Accepted");
    expect(stored.workBlockId).toBe(sourceBlock.id);
  });

  it("runs scoped plan accept through the async work command route", async () => {
    const { workspaceId } = await seedWorkspace("Real Router Async Scoped Plan");
    const { taskId } = await seedTask(workspaceId, { title: "Async scoped recurring plan parent" });
    const sourceBlock = await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Today async scoped occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-08T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Tomorrow async neighboring occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-09T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-09T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    const compiledPlan = makeSmokeCompiledPlan("real-router-async-scoped-plan");
    const events: TaskProjectionEvent[] = [];
    const subscription = subscribeToTaskProjectionEvents(taskId, (event) => events.push(event));

    try {
      await saveCompiledPlan({
        workspaceId,
        taskId,
        workBlockId: sourceBlock.id,
        compiledPlan,
        status: "draft",
        prompt: compiledPlan.title,
        summary: compiledPlan.goal,
        generatedBy: "real-router-smoke",
      });
      await seedPlanAcceptanceHead({
        workspaceId,
        taskId,
        planId: compiledPlan.editablePlanId,
        workBlockId: sourceBlock.id,
      });

      const commandRes = await app().request(`http://local/api/work/${taskId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "plan.accept", planId: compiledPlan.editablePlanId, workBlockId: sourceBlock.id, expectedHeadStateVersion: 0, idempotencyKey: "real-router-async-scoped-plan-accept" }),
      });

      expect(commandRes.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const stored = await db.taskPlan.findUniqueOrThrow({ where: { planId: compiledPlan.editablePlanId } });
      expect(stored.status).toBe("Accepted");
      expect(stored.workBlockId).toBe(sourceBlock.id);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "command.accepted", commandType: "plan.accept" }),
        expect.objectContaining({ type: "task_projection_updated" }),
      ]));
      expect(events.some((event) => event.type === "plan.generation.event")).toBe(false);
      expect(events.some((event) => event.type === "command.failed")).toBe(false);
    } finally {
      subscription.unsubscribe();
    }
  });

  it("streams execution action state and result through SSE", async () => {
    const { workspaceId } = await seedWorkspace("Real Router Execution Stream");
    const { taskId } = await seedTask(workspaceId, { title: "Streamed execution", status: "Ready" });
    const compiledPlan = makeWaitExecutionPlan("real-router-execution-stream");

    await saveCompiledPlan({
      workspaceId,
      taskId,
      compiledPlan,
      status: "accepted",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "real-router-smoke",
    });

    const streamRes = await app().request(`http://local/api/tasks/${taskId}/execution/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ action: "start_manual", idempotencyKey: "router-smoke-start" }),
    });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const events = parseSseEvents(await streamRes.text());
    expect(events.map((entry) => entry.event)).toContain("status");
    expect(events.map((entry) => entry.event)).toContain("result");
    expect(events.at(-1)?.event).toBe("done");

    const result = events.find((entry) => entry.event === "result")?.data.result as { status?: string } | undefined;
    expect(result?.status).toBe("waiting_for_user");
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
