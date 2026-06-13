import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { decideScheduleProposal } from "@chrona/engine/modules/scheduling/decide-schedule-proposal";
import { resetTestDb, seedScheduleProposal, seedTask, seedWorkspace } from "../bun-test-helpers";

// decideScheduleProposal — engine-layer unit for the accept/reject
// decision primitive. The HTTP surface /api/tasks/schedule-proposals/decision
// is covered by schedule-proposal-accept-reject; this file pins the engine
// contract on the bare atomic operation:
//
// - reject on a task with an existing schedule does NOT clobber it
// - reject persists resolutionNote
// - accept on a task with no prior schedule writes a fresh work block
//   with the proposal's times
// - accept propagates the proposal source into the work block trigger
//   (ai → scheduled, human → manual)
// - already-resolved proposals are rejected by the state machine guard
// - the proposalId is preserved in the engine response

const PROPOSAL_START = new Date("2030-05-01T13:00:00.000Z");
const PROPOSAL_END = new Date("2030-05-01T14:00:00.000Z");

describe("decideScheduleProposal (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("accept applies the proposed schedule to a fresh task and creates a work block", async () => {
    const { workspaceId } = await seedWorkspace("Decide accept fresh");
    const { taskId } = await seedTask(workspaceId, { title: "Decide accept fresh" });

    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId,
      source: "ai",
      proposedBy: "agent:planner",
      summary: "First slot",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    const decided = await decideScheduleProposal({
      proposalId,
      decision: "Accepted",
    });
    expect(decided.proposalId).toBe(proposalId);
    expect(decided.taskId).toBe(taskId);
    expect(decided.workspaceId).toBe(workspaceId);

    const stored = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(stored.status).toBe("Accepted");
    expect(stored.resolvedAt).toBeInstanceOf(Date);

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].scheduledStartAt.toISOString()).toBe(PROPOSAL_START.toISOString());
    expect(blocks[0].scheduledEndAt.toISOString()).toBe(PROPOSAL_END.toISOString());
    // ai source → trigger="scheduled"
    expect(blocks[0].trigger).toBe("scheduled");
  });

  it("accept with human source creates a work block with trigger=manual", async () => {
    const { workspaceId } = await seedWorkspace("Decide accept human");
    const { taskId } = await seedTask(workspaceId, { title: "Decide accept human" });

    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId,
      source: "human",
      proposedBy: "user:bob",
      summary: "Manual slot",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    await decideScheduleProposal({ proposalId, decision: "Accepted" });

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].trigger).toBe("manual");
  });

  it("reject persists resolutionNote and does NOT create a work block", async () => {
    const { workspaceId } = await seedWorkspace("Decide reject with note");
    const { taskId } = await seedTask(workspaceId, { title: "Decide reject note" });

    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId,
      source: "ai",
      proposedBy: "agent:planner",
      summary: "Conflict",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    const decided = await decideScheduleProposal({
      proposalId,
      decision: "Rejected",
      resolutionNote: "Conflicts with standup",
    });
    expect(decided.proposalId).toBe(proposalId);

    const stored = await db.scheduleProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(stored.status).toBe("Rejected");
    expect(stored.resolutionNote).toBe("Conflicts with standup");
    expect(stored.resolvedAt).toBeInstanceOf(Date);

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(0);
  });

  it("reject on a task that already has a Scheduled work block does NOT touch it", async () => {
    const { workspaceId } = await seedWorkspace("Decide reject preserves existing");
    const { taskId } = await seedTask(workspaceId, { title: "Decide reject existing" });

    const existingStart = new Date("2030-01-15T10:00:00.000Z");
    const existingEnd = new Date("2030-01-15T11:00:00.000Z");
    const existing = await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Existing block",
        status: "Scheduled",
        scheduledStartAt: existingStart,
        scheduledEndAt: existingEnd,
        trigger: "manual",
      },
    });

    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId,
      source: "ai",
      proposedBy: "agent:planner",
      summary: "Conflicting AI proposal",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    await decideScheduleProposal({ proposalId, decision: "Rejected" });

    const blocks = await db.workBlock.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe(existing.id);
    expect(blocks[0].scheduledStartAt.toISOString()).toBe(existingStart.toISOString());
    expect(blocks[0].scheduledEndAt.toISOString()).toBe(existingEnd.toISOString());
  });

  it("engine throws when deciding an already-accepted proposal (state machine guard)", async () => {
    const { workspaceId } = await seedWorkspace("Decide accept twice");
    const { taskId } = await seedTask(workspaceId, { title: "Decide twice" });

    const { proposalId } = await seedScheduleProposal({
      taskId,
      workspaceId,
      status: "Accepted",
    });

    await expect(
      decideScheduleProposal({ proposalId, decision: "Rejected" }),
    ).rejects.toThrow(/Only pending schedule proposals/);
  });

  it("engine throws on a non-existent proposalId (findUniqueOrThrow)", async () => {
    await expect(
      decideScheduleProposal({ proposalId: "missing-proposal-id", decision: "Accepted" }),
    ).rejects.toThrow();
  });
});
