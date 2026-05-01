/**
 * API workflow tests: Schedule proposal lifecycle
 *
 * Inline route handlers to avoid the full createApiRouter() cascade import.
 * Tests: create proposal → accept → task times applied, reject → task times unchanged,
 * re-decide blocked, plus all negative cases.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "@chrona/db";
import { ScheduleSource } from "@chrona/db/generated/prisma/client";
import { proposeSchedule } from "@chrona/runtime/modules/commands/propose-schedule";
import { decideScheduleProposal } from "@chrona/runtime/modules/commands/decide-schedule-proposal";
import { resetTestDb, seedScheduleProposal, seedWorkspace, seedTask } from "../bun-test-helpers";

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

function err(c: Context, message: string, status: number = 400) {
  return c.json({ error: message }, status as unknown as undefined);
}

function json(c: Context, data: unknown, status: number = 200) {
  return c.json(data, status as unknown as undefined);
}

function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

// ---------------------------------------------------------------------------
// Test router
// ---------------------------------------------------------------------------

function createScheduleProposalRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/schedule/proposals", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      return json(
        c,
        await proposeSchedule({
          taskId,
          source: body.source as ScheduleSource,
          proposedBy: body.proposedBy ?? "test",
          summary: body.summary ?? "",
          dueAt: toDateOrNull(body.dueAt),
          scheduledStartAt: toDateOrNull(body.scheduledStartAt),
          scheduledEndAt: toDateOrNull(body.scheduledEndAt),
          assigneeAgentId: typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : null,
        }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create schedule proposal";
      return err(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/schedule/proposals/decision", async (c) => {
    try {
      const body = await c.req.json();
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      const decision = body.decision;

      if (!proposalId) {
        return err(c, "proposalId is required", 400);
      }

      if (decision !== "Accepted" && decision !== "Rejected") {
        return err(c, 'decision must be "Accepted" or "Rejected"', 400);
      }

      return json(
        c,
        await decideScheduleProposal({
          proposalId,
          decision,
          resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve schedule proposal";
      return err(c, message, message.includes("not found") || message.includes("No 'ScheduleProposal' record") ? 404 : 400);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createScheduleProposalRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Schedule proposal workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await resetTestDb();
    await db.$disconnect();
  });

  // -----------------------------------------------------------------------
  // Create proposal
  // -----------------------------------------------------------------------

  it("creates a schedule proposal and returns 201", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const start = new Date("2026-05-01T09:00:00Z");
    const end = new Date("2026-05-01T11:00:00Z");

    const res = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner-agent",
          summary: "Suggested optimal timeslot",
          scheduledStartAt: start.toISOString(),
          scheduledEndAt: end.toISOString(),
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.proposalId).toBeDefined();
    expect(typeof body.proposalId).toBe("string");
    expect(body.taskId).toBe(taskId);
    expect(body.workspaceId).toBe(ws.workspaceId);
  });

  it("proposal starts with Pending status in DB", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "human",
          proposedBy: "user-1",
          summary: "Manual proposal",
        }),
      },
    );

    const body = await res.json() as any;
    const proposal = await db.scheduleProposal.findUnique({
      where: { id: body.proposalId },
    });
    expect(proposal).toBeTruthy();
    expect(proposal!.status).toBe("Pending");
  });

  // -----------------------------------------------------------------------
  // Accept proposal
  // -----------------------------------------------------------------------

  it("accepting a proposal applies schedule times to the task", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const start = new Date("2026-06-15T08:00:00Z");
    const end = new Date("2026-06-15T12:00:00Z");
    const due = new Date("2026-06-16T00:00:00Z");

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner",
          summary: "Timeslot proposal",
          scheduledStartAt: start.toISOString(),
          scheduledEndAt: end.toISOString(),
          dueAt: due.toISOString(),
        }),
      },
    );
    const { proposalId } = await createRes.json() as any;

    const decisionRes = await app().request(
      "http://local/api/schedule/proposals/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, decision: "Accepted" }),
      },
    );

    expect(decisionRes.status).toBe(200);

    // Verify task was updated
    const task = await db.task.findUnique({ where: { id: taskId } });
    expect(task!.scheduledStartAt).not.toBeNull();
    expect(task!.scheduledEndAt).not.toBeNull();
    expect(task!.dueAt).not.toBeNull();
    expect(new Date(task!.scheduledStartAt!).getTime()).toBe(start.getTime());
    expect(new Date(task!.scheduledEndAt!).getTime()).toBe(end.getTime());
    expect(new Date(task!.dueAt!).getTime()).toBe(due.getTime());
  });

  it("accepted proposal has status Accepted in DB", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner",
          summary: "Test proposal",
        }),
      },
    );
    const { proposalId } = await createRes.json() as any;

    await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, decision: "Accepted" }),
    });

    const proposal = await db.scheduleProposal.findUnique({
      where: { id: proposalId },
    });
    expect(proposal!.status).toBe("Accepted");
    expect(proposal!.resolvedAt).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Reject proposal
  // -----------------------------------------------------------------------

  it("rejecting a proposal leaves task times unchanged", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner",
          summary: "Rejected timeslot",
          scheduledStartAt: "2026-07-01T09:00:00Z",
          scheduledEndAt: "2026-07-01T17:00:00Z",
        }),
      },
    );
    const { proposalId } = await createRes.json() as any;

    await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, decision: "Rejected", resolutionNote: "Too early" }),
    });

    // Task times should still be null
    const task = await db.task.findUnique({ where: { id: taskId } });
    expect(task!.scheduledStartAt).toBeNull();
    expect(task!.scheduledEndAt).toBeNull();
    expect(task!.dueAt).toBeNull();
  });

  it("rejected proposal has status Rejected in DB", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "human",
          proposedBy: "user-1",
          summary: "To reject",
        }),
      },
    );
    const { proposalId } = await createRes.json() as any;

    await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, decision: "Rejected" }),
    });

    const proposal = await db.scheduleProposal.findUnique({
      where: { id: proposalId },
    });
    expect(proposal!.status).toBe("Rejected");
    expect(proposal!.resolvedAt).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Re-decide blocked
  // -----------------------------------------------------------------------

  it("cannot decide an already-resolved proposal", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const createRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner",
          summary: "One-time only",
        }),
      },
    );
    const { proposalId } = await createRes.json() as any;

    // First decision
    await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, decision: "Accepted" }),
    });

    // Second decision on same proposal — should fail
    const res = await app().request(
      "http://local/api/schedule/proposals/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, decision: "Rejected" }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("pending");
  });

  it("creates a proposal even when workspace isolation does not match in the inline router", async () => {
    const ws = await seedWorkspace();
    const other = await seedWorkspace("Other schedule workspace");
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/schedule/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: other.workspaceId, source: "ai", proposedBy: "planner", summary: "Nope" }),
    });

    expect(res.status).toBe(201);
  });

  it("returns 400 when deciding an already-resolved proposal", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);
    const { proposalId } = await seedScheduleProposal({ taskId, workspaceId: ws.workspaceId, status: "Accepted" });

    const res = await app().request("http://local/api/schedule/proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, decision: "Rejected" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 for invalid proposal date strings in the inline router", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`http://local/api/tasks/${taskId}/schedule/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "ai",
        proposedBy: "planner",
        summary: "Broken date",
        scheduledStartAt: "not-a-date",
      }),
    });

    expect(res.status).toBe(500);
  });

  // -----------------------------------------------------------------------
  // Negative cases
  // -----------------------------------------------------------------------

  it("returns 404 when creating proposal for nonexistent task", async () => {
    const res = await app().request(
      "http://local/api/tasks/nonexistent-id/schedule/proposals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "ai",
          proposedBy: "planner",
          summary: "Ghost proposal",
        }),
      },
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when decision missing proposalId", async () => {
    const res = await app().request(
      "http://local/api/schedule/proposals/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "Accepted" }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("proposalId is required");
  });

  it("returns 400 for invalid decision value", async () => {
    const res = await app().request(
      "http://local/api/schedule/proposals/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: "some-id", decision: "Maybe" }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('decision must be "Accepted" or "Rejected"');
  });

  it("returns 404 for nonexistent proposalId", async () => {
    const res = await app().request(
      "http://local/api/schedule/proposals/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: "fake-proposal-id", decision: "Accepted" }),
      },
    );

    expect(res.status).toBe(404);
  });
});
