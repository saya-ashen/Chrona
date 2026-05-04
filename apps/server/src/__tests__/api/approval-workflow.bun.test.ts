/**
 * API route tests for approval resolution workflow.
 *
 * Covers POST /api/approvals/:approvalId/resolve.
 *
 * Uses fake adapters (same pattern as task-execution-closure) so tests
 * don't need a live OpenClaw backend.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ApprovalStatus, RunStatus, TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { resolveApproval } from "@chrona/engine";
import { resetTestDb, seedWorkspace, seedTask, expectApiError } from "../bun-test-helpers";

// ---------------------------------------------------------------------------
// Fake adapters
// ---------------------------------------------------------------------------

function fakeAdapterForReject() {
  return {
    async createRun() { throw new Error("not used"); },
    async sendOperatorMessage() { throw new Error("not used"); },
    async resumeRun(input: { approvalId?: string; decision?: string }) {
      expect(input.decision).toBe("reject");
      return { accepted: true };
    },
    async getRunSnapshot() {
      return { runtimeRunRef: "run-ref", runtimeSessionKey: "session-ref", status: "Running" as const };
    },
    async readHistory() { return { messages: [] }; },
    async listApprovals() { return [] as Array<Record<string, unknown>>; },
    async waitForApprovalDecision() { return null; },
  } as const;
}

function fakeAdapterForApprove(sessionKey: string) {
  return {
    async createRun() { throw new Error("not used"); },
    async sendOperatorMessage() { throw new Error("not used"); },
    async resumeRun() {
      return { accepted: true, runtimeRunRef: "approved-ref", runtimeSessionKey: sessionKey };
    },
    async getRunSnapshot() {
      return { runtimeRunRef: "approved-ref", runtimeSessionKey: sessionKey, status: "WaitingForApproval" as const };
    },
    async readHistory() { return { messages: [] }; },
    async listApprovals() { return [] as Array<Record<string, unknown>>; },
    async waitForApprovalDecision() { return null; },
    async executeTask() { throw new Error("not used"); },
    async getSessionStatus() { throw new Error("not used"); },
  } as const;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedApprovalFixture(
  workspaceId: string,
  overrides?: {
    decision?: "Approved" | "Rejected";
    alreadyResolved?: boolean;
  },
) {
  const decision = overrides?.decision ?? "Approved";
  const status = overrides?.alreadyResolved ? ApprovalStatus.Approved : ApprovalStatus.Pending;

  const { taskId } = await seedTask(workspaceId, {
    title: `Approval ${decision} Task`,
    status: TaskStatus.WaitingForApproval,
  });

  const sessionKey = `session-${decision}-${Date.now()}`;
  const runRef = `run-${decision}-${Date.now()}`;

  const run = await db.run.create({
    data: {
      taskId,
      runtimeName: "openclaw",
      runtimeRunRef: runRef,
      runtimeSessionRef: sessionKey,
      status: RunStatus.WaitingForApproval,
      triggeredBy: "user",
    },
  });

  await db.task.update({ where: { id: taskId }, data: { latestRunId: run.id } });
  await db.taskSession.create({
    data: {
      taskId,
      runtimeName: "openclaw",
      sessionKey,
      status: "waiting_for_approval",
      activeRunId: run.id,
    },
  });

  const approval = await db.approval.create({
    data: {
      id: `approval-${decision}-${Date.now()}`,
      workspaceId,
      taskId,
      runId: run.id,
      type: "exec",
      title: "Approve operation",
      summary: "This operation needs approval",
      riskLevel: "medium",
      status,
      requestedAt: new Date(),
      ...(overrides?.alreadyResolved ? { resolvedAt: new Date(), resolvedBy: "test-user" } : {}),
    },
  });

  return { taskId, runId: run.id, approvalId: approval.id, sessionKey };
}

// ---------------------------------------------------------------------------
// Inline router
// ---------------------------------------------------------------------------

function createApprovalRouter() {
  const api = new Hono();

  // Direct resolution
  api.post("/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      const { decision, resolutionNote, editedContent } = body as {
        decision: "Approved" | "Rejected" | "EditedAndApproved";
        resolutionNote?: string;
        editedContent?: string;
      };

      if (!decision || !["Approved", "Rejected", "EditedAndApproved"].includes(decision)) {
        return c.json({ error: "decision is required" }, 400);
      }

      const adapter = decision === "Rejected"
        ? fakeAdapterForReject()
        : fakeAdapterForApprove("session-approve") as any;

      const result = await resolveApproval({
        approvalId,
        decision,
        resolutionNote,
        editedContent,
        adapter,
      });
      return c.json(result, 200);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/no longer exists/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createApprovalRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Approval workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  // ── Happy path: approve ───────────────────────────────────────────────

  it("approves a pending approval and persists the decision", async () => {
    const ws = await seedWorkspace();
    const { approvalId } = await seedApprovalFixture(ws.workspaceId, { decision: "Approved" });

    const res = await app().request(
      `http://local/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Approved", resolutionNote: "Looks good!" }),
      },
    );

    expect(res.status).toBe(200);

    const storedApproval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(storedApproval.status).toBe(ApprovalStatus.Approved);
    expect(storedApproval.resolutionNote).toBe("Looks good!");
  });

  it("rejects a pending approval and marks run as Failed, task as Blocked", async () => {
    const ws = await seedWorkspace();
    const { approvalId, runId, taskId } = await seedApprovalFixture(ws.workspaceId, { decision: "Rejected" });

    const res = await app().request(
      `http://local/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Rejected", resolutionNote: "Not acceptable" }),
      },
    );

    expect(res.status).toBe(200);

    const storedApproval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(storedApproval.status).toBe(ApprovalStatus.Rejected);
    expect(storedApproval.resolutionNote).toBe("Not acceptable");

    const storedRun = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(storedRun.status).toBe(RunStatus.Failed);
    expect(storedRun.retryable).toBe(true);

    const storedTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(storedTask.status).toBe(TaskStatus.Blocked);
  });

  // ── Negative cases ────────────────────────────────────────────────────

  it("returns 404 for non-existent approval (direct route)", async () => {
    const res = await app().request(
      "http://local/api/approvals/nonexistent-id/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Approved" }),
      },
    );
    await expectApiError(res, 404);
  });

  it("returns 400 when trying to resolve an already-resolved approval", async () => {
    const ws = await seedWorkspace();
    const { approvalId } = await seedApprovalFixture(ws.workspaceId, {
      decision: "Approved",
      alreadyResolved: true,
    });

    const res = await app().request(
      `http://local/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Approved" }),
      },
    );
    await expectApiError(res, 400);
  });

  it("returns 400 when decision field is missing", async () => {
    const ws = await seedWorkspace();
    const { approvalId } = await seedApprovalFixture(ws.workspaceId, { decision: "Approved" });

    const res = await app().request(
      `http://local/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote: "no decision" }),
      },
    );
    await expectApiError(res, 400);
  });

  it("returns 400 when decision value is invalid", async () => {
    const ws = await seedWorkspace();
    const { approvalId } = await seedApprovalFixture(ws.workspaceId, { decision: "Approved" });

    const res = await app().request(
      `http://local/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Skip" }),
      },
    );
    await expectApiError(res, 400);
  });
});
