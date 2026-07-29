import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// Provider-approval resolve flow. The route lives in
// apps/server/src/routes/tasks/execution.routes.ts and reads
// TaskPlanProviderApproval rows directly. These tests pin:
// - empty list, status filter, 404 on missing, "not_pending" on
// already-resolved.
//
// The body's `choice` field is the zod schema's enum:
// `approve_once | approve_session | approve_always | deny`
// (NOT the legacy "approve | reject" the route tests in
// task-flow-* files used). The first failure here surfaced that
// schema change.

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedPendingApproval(workspaceId: string, taskId: string) {
  const planIdSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await db.taskPlan.create({
    data: {
      workspaceId,
      taskId,
      planId: `plan-${taskId}-${planIdSuffix}`,
      revision: 1,
      status: "Draft",
      compiledPlan: {} as object,
      generatedBy: "test",
    },
  });
  const planRun = await db.taskPlanRun.create({
    data: {
      workspaceId,
      taskId,
      planId: plan.planId,
      planRun: { status: "running" } as object,
      executionEpoch: 0,
    },
  });
  const nodeAttempt = await db.taskPlanNodeAttempt.create({
    data: {
      workspaceId,
      taskId,
      planId: plan.planId,
      planRunId: planRun.id,
      nodeId: "approval-node",
      nodeLayerId: "layer-1",
      idempotencyKey: `idem-${planIdSuffix}`,
      attemptNumber: 1,
      status: "running",
      executionEpoch: 0,
    },
  });
  const providerRun = await db.taskPlanProviderRun.create({
    data: {
      workspaceId,
      taskId,
      planId: plan.planId,
      planRunId: planRun.id,
      nodeAttemptId: nodeAttempt.id,
      idempotencyKey: `prov-${planIdSuffix}`,
      status: "running",
    },
  });
  const approval = await db.taskPlanProviderApproval.create({
    data: {
      workspaceId,
      taskId,
      planId: plan.planId,
      planRunId: planRun.id,
      providerRunId: providerRun.id,
      provider: "hermes",
      kind: "tool_authorization",
      title: "Approve send_email",
      summary: "Send email to alice@example.com",
      description: "Tool request from Hermes requires human approval",
      riskLevel: "medium",
      subject: { tool: "send_email", recipient: "alice@example.com" } as object,
      choices: ["approve_once", "approve_session", "approve_always", "deny"] as object,
      status: "pending",
      requestedAt: new Date(),
    },
  });
  return { approval, planRun, providerRun };
}

async function resolveApproval(taskId: string, approvalId: string, choice = "approve_once") {
  return app().request(
    `http://local/api/tasks/${taskId}/provider-approvals/${approvalId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice }),
    },
  );
}

describe("provider approval resolve", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("GET /provider-approvals returns 200 with empty list on a fresh task", async () => {
    const ws = await seedWorkspace("Approval list fresh");
    const { taskId } = await seedTask(ws.workspaceId);

    const response = await app().request(`http://local/api/tasks/${taskId}/provider-approvals?status=pending`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { approvals: unknown[] };
    expect(Array.isArray(body.approvals)).toBe(true);
    expect(body.approvals).toHaveLength(0);
  });

  it("status=all returns resolved approvals; status=pending does not", async () => {
    const ws = await seedWorkspace("Approval list filter");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval } = await seedPendingApproval(ws.workspaceId, taskId);

    const all = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals?status=all`,
    );
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { approvals: { id: string }[] };
    expect(allBody.approvals.map((a) => a.id)).toContain(approval.id);

    await db.taskPlanProviderApproval.update({
      where: { id: approval.id },
      data: { status: "approved", choice: "approve_once", resolvedAt: new Date() },
    });

    const pendingOnly = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals?status=pending`,
    );
    expect(pendingOnly.status).toBe(200);
    const pendingBody = (await pendingOnly.json()) as { approvals: { id: string }[] };
    expect(pendingBody.approvals.find((a) => a.id === approval.id)).toBeUndefined();

    const allAfter = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals?status=all`,
    );
    const allAfterBody = (await allAfter.json()) as { approvals: { id: string }[] };
    expect(allAfterBody.approvals.map((a) => a.id)).toContain(approval.id);
  });

  it("resolve on a missing approvalId returns 404", async () => {
    const ws = await seedWorkspace("Approval resolve missing");
    const { taskId } = await seedTask(ws.workspaceId);

    const response = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals/nope/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: "approve_once" }),
      },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/not found/i);
  });

  it("resolve on a non-pending approval returns 200 with status 'not_pending'", async () => {
    const ws = await seedWorkspace("Approval resolve non-pending");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
    await db.taskPlanProviderApproval.update({
      where: { id: approval.id },
      data: { status: "approved", choice: "approve_once", resolvedAt: new Date() },
    });

    const response = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals/${approval.id}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: "approve_once" }),
      },
    );
    // The route returns 200 with status "not_pending" — the
    // client uses this to refresh the UI rather than treat it as
    // an error.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; choice: string };
    expect(body.status).toBe("not_pending");
    expect(body.choice).toBe("approve_once");
  });

  it("resolve with inactive provider marks approval failed and clears pending list", async () => {
    const ws = await seedWorkspace("Approval resolve inactive provider");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval, providerRun } = await seedPendingApproval(ws.workspaceId, taskId);

    const response = await app().request(
      `http://local/api/tasks/${taskId}/provider-approvals/${approval.id}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: "approve_once" }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; resolved: number };
    expect(body.status).toBe("not_active");
    expect(body.resolved).toBe(0);

    const updated = await db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(updated.status).toBe("failed");
    expect(updated.resolvedAt).toBeInstanceOf(Date);

    const updatedProviderRun = await db.taskPlanProviderRun.findUniqueOrThrow({ where: { id: providerRun.id } });
    expect(updatedProviderRun.status).toBe("failed");

    const pending = await app().request(`http://local/api/tasks/${taskId}/provider-approvals?status=pending`);
    const pendingBody = (await pending.json()) as { approvals: unknown[] };
    expect(pendingBody.approvals).toHaveLength(0);
  });

  it("atomically finalizes a pending approval and its provider Run", async () => {
    const ws = await seedWorkspace("Approval resolve atomic finalization");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval, providerRun } = await seedPendingApproval(ws.workspaceId, taskId);

    const response = await resolveApproval(taskId, approval.id);

    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("not_active");
    const [updatedApproval, updatedProviderRun] = await Promise.all([
      db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: approval.id } }),
      db.taskPlanProviderRun.findUniqueOrThrow({ where: { id: providerRun.id } }),
    ]);
    expect(updatedApproval).toMatchObject({
      status: "failed",
      choice: "approve_once",
      resolveAll: false,
    });
    expect(updatedApproval.resolvedAt).toBeInstanceOf(Date);
    expect(updatedProviderRun.status).toBe("failed");
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId } });
    expect(projection.approvalPendingCount).toBe(0);
    expect(updatedProviderRun.finishedAt).toBeInstanceOf(Date);
  });

  it("returns not_pending without overwriting a concurrent terminal resolution", async () => {
    const ws = await seedWorkspace("Approval resolve compare and swap");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval, providerRun } = await seedPendingApproval(ws.workspaceId, taskId);
    const resolvedAt = new Date("2026-07-29T12:00:00.000Z");
    await db.$transaction([
      db.taskPlanProviderApproval.update({
        where: { id: approval.id },
        data: { status: "approved", choice: "approve_session", resolvedAt },
      }),
      db.taskPlanProviderRun.update({
        where: { id: providerRun.id },
        data: { status: "running" },
      }),
    ]);

    const response = await resolveApproval(taskId, approval.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "not_pending",
      choice: "approve_once",
      resolved: 0,
    });
    const [updatedApproval, updatedProviderRun] = await Promise.all([
      db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: approval.id } }),
      db.taskPlanProviderRun.findUniqueOrThrow({ where: { id: providerRun.id } }),
    ]);
    expect(updatedApproval).toMatchObject({
      status: "approved",
      choice: "approve_session",
      resolvedAt,
    });
    expect(updatedProviderRun.status).toBe("running");
  });

  it("rejects choices absent from the persisted approval contract", async () => {
    const ws = await seedWorkspace("Approval invalid choice");
    const { taskId } = await seedTask(ws.workspaceId);
    const { approval, providerRun } = await seedPendingApproval(ws.workspaceId, taskId);
    await db.taskPlanProviderApproval.update({
      where: { id: approval.id },
      data: { choices: ["deny"] as object },
    });

    const response = await resolveApproval(taskId, approval.id);

    expect(response.status).toBe(400);
    const [updatedApproval, updatedProviderRun] = await Promise.all([
      db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: approval.id } }),
      db.taskPlanProviderRun.findUniqueOrThrow({ where: { id: providerRun.id } }),
    ]);
    expect(updatedApproval.status).toBe("pending");
    expect(updatedProviderRun.status).toBe("running");
  });
});
