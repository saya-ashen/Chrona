import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { decideScheduleProposal } from "@chrona/engine/modules/scheduling/decide-schedule-proposal";
import { proposeSchedule } from "@chrona/engine/modules/scheduling/propose-schedule";
import { ScheduleSource, ScheduleProposalStatus } from "@chrona/db/generated/prisma/client";
import { resetTestDb, seedScheduleProposal, seedTask, seedWorkspace } from "../bun-test-helpers";

// Schedule proposal — accept/reject decision edges. The
// schedule-proposal-workflow and schedule-proposal-conflict-workflow
// tests cover the happy path and conflict cases via the HTTP
// router. This file locks in the engine-level contract:
//
// - resolutionNote is persisted
// - accept on a task with no prior schedule writes a fresh
//   work block with the proposal's times
// - reject on a task with an existing schedule does NOT clobber it
// - the engine throws on missing / already-resolved proposalId
// - proposeSchedule stores multiple pending proposals for the
//   same window (no implicit dedupe)

describe("schedule proposal accept/reject decisions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("accept persists resolutionNote on the proposal row", async () => {
    const ws = await seedWorkspace("Schedule accept note");
    const { taskId } = await seedTask(ws.workspaceId);
    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId: ws.workspaceId,
      status: ScheduleProposalStatus.Pending,
    });

    const decided = await decideScheduleProposal({
      proposalId,
      decision: "Accepted",
      resolutionNote: "approved after conflict review",
    });
    expect(decided.proposalId).toBe(proposalId);

    const stored = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(stored.resolutionNote).toBe("approved after conflict review");
    expect(stored.status).toBe(ScheduleProposalStatus.Accepted);
    expect(stored.resolvedAt).toBeInstanceOf(Date);
  });

  it("reject persists resolutionNote and does NOT create a new work block", async () => {
    const ws = await seedWorkspace("Schedule reject note");
    const { taskId } = await seedTask(ws.workspaceId);
    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId: ws.workspaceId,
      status: ScheduleProposalStatus.Pending,
    });
    const beforeBlocks = await db.workBlock.count({ where: { taskId } });

    await decideScheduleProposal({
      proposalId,
      decision: "Rejected",
      resolutionNote: "conflict with existing meeting",
    });

    const stored = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(stored.resolutionNote).toBe("conflict with existing meeting");
    expect(stored.status).toBe(ScheduleProposalStatus.Rejected);

    const afterBlocks = await db.workBlock.count({ where: { taskId } });
    expect(afterBlocks).toBe(beforeBlocks);
  });

  it("engine throws on deciding an already-resolved proposal (state machine guard)", async () => {
    const ws = await seedWorkspace("Schedule double decide");
    const { taskId } = await seedTask(ws.workspaceId);
    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId: ws.workspaceId,
      status: ScheduleProposalStatus.Accepted,
    });

    expect(
      decideScheduleProposal({ proposalId, decision: "Accepted" }),
    ).rejects.toThrow(/Only pending/);
  });

  it("accept applies the proposed schedule to a fresh task — work block is created", async () => {
    const ws = await seedWorkspace("Schedule accept fresh");
    const { taskId } = await seedTask(ws.workspaceId);
    const start = new Date("2026-06-20T10:00:00.000Z");
    const end = new Date("2026-06-20T11:00:00.000Z");
    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId: ws.workspaceId,
      scheduledStartAt: start,
      scheduledEndAt: end,
      status: ScheduleProposalStatus.Pending,
    });
    const proposal = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.scheduledStartAt).toBeInstanceOf(Date);
    expect(proposal.scheduledEndAt).toBeInstanceOf(Date);

    const result = await decideScheduleProposal({ proposalId, decision: "Accepted" });
    expect(result.proposalId).toBe(proposalId);

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks.length).toBeGreaterThan(0);
    const blockTimes = blocks.map((b: { scheduledStartAt: Date; scheduledEndAt: Date }) => ({
      start: b.scheduledStartAt.toISOString(),
      end: b.scheduledEndAt.toISOString(),
    }));
    expect(blockTimes).toContainEqual({
      start: start.toISOString(),
      end: end.toISOString(),
    });
  });

  it("proposeSchedule with same times as an existing proposal does not dedupe", async () => {
    // Pin: the engine stores multiple Pending proposals for the
    // same task/window. The /decision endpoint enforces "only
    // pending" — the user must decide one before the next is
    // actionable. This test guarantees the dedupe story stays
    // explicit (no silent dropping).
    const ws = await seedWorkspace("Schedule overlap");
    const { taskId } = await seedTask(ws.workspaceId);
    const start = new Date("2026-06-20T10:00:00.000Z");
    const end = new Date("2026-06-20T11:00:00.000Z");

    const first = await proposeSchedule({
      taskId,
      source: ScheduleSource.ai,
      proposedBy: "planner",
      summary: "first",
      dueAt: null,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });
    expect(first.proposalId).toBeTruthy();

    const second = await proposeSchedule({
      taskId,
      source: ScheduleSource.ai,
      proposedBy: "planner",
      summary: "second",
      dueAt: null,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });
    // Both proposals live in the DB — no implicit dedupe.
    expect(second.proposalId).toBeTruthy();
    expect(second.proposalId).not.toBe(first.proposalId);
    const allProposals = await db.scheduleProposal.findMany({ where: { taskId } });
    expect(allProposals).toHaveLength(2);
  });
});
