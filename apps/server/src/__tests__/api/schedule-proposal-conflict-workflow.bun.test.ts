import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";

import { db } from "@chrona/db";
import { ScheduleSource } from "@chrona/db/generated/prisma/client";
import type { ScheduleProposal } from "@chrona/db/generated/prisma/client";
import { scheduleProposalBodySchema } from "@chrona/contracts/api";
import { decideScheduleProposal } from "@chrona/engine/modules/scheduling/decide-schedule-proposal";
import { proposeSchedule } from "@chrona/engine/modules/scheduling/propose-schedule";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function err(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as never);
}

function toDateOrNull(value: unknown) {
  return typeof value === "string" && value ? new Date(value) : null;
}

function createScheduleConflictRouter() {
  const api = new Hono();

  api.post("/tasks/:taskId/schedule/proposals", async (c) => {
    const taskId = c.req.param("taskId");
    const parsed = scheduleProposalBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return err(c, parsed.error.issues.map((issue) => issue.message).join("; "), 400);

    const task = await db.task.findUnique({ where: { id: taskId }, select: { workspaceId: true } });
    if (!task || (parsed.data.workspaceId && parsed.data.workspaceId !== task.workspaceId)) return err(c, "Task not found", 404);

    return c.json(await proposeSchedule({
      taskId,
      source: (parsed.data.source ?? "system") as ScheduleSource,
      proposedBy: parsed.data.proposedBy ?? "test",
      summary: parsed.data.summary ?? "",
      dueAt: toDateOrNull(parsed.data.dueAt),
      scheduledStartAt: toDateOrNull(parsed.data.scheduledStartAt),
      scheduledEndAt: toDateOrNull(parsed.data.scheduledEndAt),
    }), 201 as never);
  });

  api.post("/tasks/schedule-proposals/decision", async (c) => {
    try {
      const body = await c.req.json() as { proposalId?: unknown; decision?: unknown; resolutionNote?: unknown };
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      if (!proposalId) return err(c, "proposalId is required", 400);
      if (body.decision !== "Accepted" && body.decision !== "Rejected") return err(c, 'decision must be "Accepted" or "Rejected"', 400);

      return c.json(await decideScheduleProposal({
        proposalId,
        decision: body.decision,
        resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve schedule proposal";
      return err(c, message, message.includes("not found") || message.includes("No 'ScheduleProposal'") ? 404 : 400);
    }
  });

  return api;
}

function app() {
  const server = new Hono();
  server.route("/api", createScheduleConflictRouter());
  return server;
}

async function createProposal(taskId: string, start: string, end: string, summary: string) {
  const response = await app().request(`http://local/api/tasks/${taskId}/schedule/proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "ai", proposedBy: "planner", summary, scheduledStartAt: start, scheduledEndAt: end }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { proposalId: string };
}

describe("schedule proposal conflict workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("accepting one proposal leaves competing pending proposals unresolved for explicit user choice", async () => {
    const { workspaceId } = await seedWorkspace("Schedule conflict workflow");
    const { taskId } = await seedTask(workspaceId);
    const first = await createProposal(taskId, "2026-06-01T09:00:00.000Z", "2026-06-01T10:00:00.000Z", "Morning slot");
    const second = await createProposal(taskId, "2026-06-01T09:30:00.000Z", "2026-06-01T11:00:00.000Z", "Overlapping slot");

    const decision = await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: first.proposalId, decision: "Accepted", resolutionNote: "Use earlier slot" }),
    });

    expect(decision.status).toBe(200);
    const proposals = await db.scheduleProposal.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    const workBlock = await db.workBlock.findFirstOrThrow({ where: { taskId } });

    expect(proposals.map((proposal: ScheduleProposal) => [proposal.id, proposal.status, proposal.resolutionNote])).toEqual([
      [first.proposalId, "Accepted", "Use earlier slot"],
      [second.proposalId, "Pending", null],
    ]);
    expect(workBlock.scheduledStartAt.toISOString()).toBe("2026-06-01T09:00:00.000Z");
    expect(workBlock.scheduledEndAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("rejecting a conflicting proposal preserves accepted schedule projection", async () => {
    const { workspaceId } = await seedWorkspace("Schedule reject conflict workflow");
    const { taskId } = await seedTask(workspaceId);
    const accepted = await createProposal(taskId, "2026-06-10T13:00:00.000Z", "2026-06-10T14:00:00.000Z", "Accepted slot");
    const rejected = await createProposal(taskId, "2026-06-10T13:30:00.000Z", "2026-06-10T15:00:00.000Z", "Conflicting slot");

    await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: accepted.proposalId, decision: "Accepted" }),
    });
    const response = await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: rejected.proposalId, decision: "Rejected", resolutionNote: "Conflicts with focus block" }),
    });

    expect(response.status).toBe(200);
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId } });
    const rejectedProposal = await db.scheduleProposal.findUniqueOrThrow({ where: { id: rejected.proposalId } });

    expect(projection.scheduleStatus).toBe("Scheduled");
    expect(projection.scheduledStartAt?.toISOString()).toBe("2026-06-10T13:00:00.000Z");
    expect(projection.scheduledEndAt?.toISOString()).toBe("2026-06-10T14:00:00.000Z");
    expect(rejectedProposal.status).toBe("Rejected");
    expect(rejectedProposal.resolutionNote).toBe("Conflicts with focus block");
  });

  it("blocks a second decision on an accepted conflicting proposal", async () => {
    const { workspaceId } = await seedWorkspace("Schedule duplicate decision workflow");
    const { taskId } = await seedTask(workspaceId);
    const proposal = await createProposal(taskId, "2026-06-03T09:00:00.000Z", "2026-06-03T10:00:00.000Z", "One decision only");

    await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId, decision: "Accepted" }),
    });
    const response = await app().request("http://local/api/tasks/schedule-proposals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId, decision: "Rejected" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("pending");
    const proposals = await db.scheduleProposal.findMany({ where: { taskId } });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("Accepted");
  });
});
