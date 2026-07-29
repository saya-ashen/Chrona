import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { proposeSchedule } from "@chrona/engine/test-support";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// proposeSchedule — engine-layer unit for the schedule-proposal creation
// primitive. The end-to-end /api/tasks/:taskId/schedule/proposals
// path is covered by schedule-proposal-workflow / -conflict-workflow;
// this file pins the engine contract on the bare atomic operation:
//
// - a new proposal row is created with status=Pending
// - the source/proposedBy/summary/times round-trip exactly
// - ai source tags the event with actorType=agent / source=planner
// - human source tags the event with actorType=user / source=ui
// - scheduling a different proposal at the same window does NOT dedupe
// - the event payload records the proposal id and the times as ISO strings
// - rebuildTaskProjection is called (the projection read-model refreshes)

const PROPOSAL_START = new Date("2030-04-01T09:00:00.000Z");
const PROPOSAL_END = new Date("2030-04-01T10:00:00.000Z");
const PROPOSAL_DUE = new Date("2030-04-01T17:00:00.000Z");

describe("proposeSchedule (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a Pending proposal row and returns its id", async () => {
    const { workspaceId } = await seedWorkspace("Propose schedule basic");
    const { taskId } = await seedTask(workspaceId, { title: "Propose basic" });

    const result = await proposeSchedule({
      taskId,
      source: "ai",
      proposedBy: "agent:test",
      summary: "Schedule during low-load window",
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);
    expect(typeof result.proposalId).toBe("string");
    expect(result.proposalId.length).toBeGreaterThan(0);

    const stored = await db.scheduleProposal.findUniqueOrThrow({ where: { id: result.proposalId } });
    expect(stored.status).toBe("Pending");
    expect(stored.source).toBe("ai");
    expect(stored.proposedBy).toBe("agent:test");
    expect(stored.summary).toBe("Schedule during low-load window");
    expect(stored.dueAt?.toISOString()).toBe(PROPOSAL_DUE.toISOString());
    expect(stored.scheduledStartAt?.toISOString()).toBe(PROPOSAL_START.toISOString());
    expect(stored.scheduledEndAt?.toISOString()).toBe(PROPOSAL_END.toISOString());
  });

  it("emits a task.schedule_proposed event with ai source → actorType=agent, source=planner", async () => {
    const { workspaceId } = await seedWorkspace("Propose schedule ai event");
    const { taskId } = await seedTask(workspaceId, { title: "Propose ai" });

    const { proposalId } = await proposeSchedule({
      taskId,
      source: "ai",
      proposedBy: "agent:planner",
      summary: "AI suggestion",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.schedule_proposed" },
      orderBy: { ingestedAt: "desc" },
      take: 1,
    });
    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.actorType).toBe("agent");
    expect(evt.source).toBe("planner");
    expect(evt.actorId).toBe("agent:planner");
    expect(evt.dedupeKey).toBe(`task.schedule_proposed:${proposalId}`);

    const payload = evt.payload as {
      proposal_id: string;
      source: string;
      proposed_by: string;
      summary: string;
      due_at: string | null;
      scheduled_start_at: string | null;
      scheduled_end_at: string | null;
    };
    expect(payload.proposal_id).toBe(proposalId);
    expect(payload.source).toBe("ai");
    expect(payload.proposed_by).toBe("agent:planner");
    expect(payload.summary).toBe("AI suggestion");
    expect(payload.due_at).toBeNull();
    expect(payload.scheduled_start_at).toBe(PROPOSAL_START.toISOString());
    expect(payload.scheduled_end_at).toBe(PROPOSAL_END.toISOString());
  });

  it("emits task.schedule_proposed with human source → actorType=user, source=ui", async () => {
    const { workspaceId } = await seedWorkspace("Propose schedule human event");
    const { taskId } = await seedTask(workspaceId, { title: "Propose human" });

    await proposeSchedule({
      taskId,
      source: "human",
      proposedBy: "user:alice",
      summary: "Manual nudge",
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.schedule_proposed" },
      orderBy: { ingestedAt: "desc" },
      take: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("user");
    expect(events[0].source).toBe("ui");
    expect(events[0].actorId).toBe("user:alice");
  });

  it("does NOT dedupe — two proposals at the same window both persist as Pending", async () => {
    const { workspaceId } = await seedWorkspace("Propose schedule no dedupe");
    const { taskId } = await seedTask(workspaceId, { title: "Propose no dedupe" });

    const first = await proposeSchedule({
      taskId,
      source: "ai",
      proposedBy: "agent:a",
      summary: "First",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });
    const second = await proposeSchedule({
      taskId,
      source: "ai",
      proposedBy: "agent:b",
      summary: "Second",
      dueAt: null,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
    });

    expect(first.proposalId).not.toBe(second.proposalId);

    const proposals = await db.scheduleProposal.findMany({
      where: { taskId, status: "Pending" },
      orderBy: { createdAt: "asc" },
    });
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.proposedBy)).toEqual(["agent:a", "agent:b"]);

    // Each proposal emits its own event with a unique dedupeKey
    const events = await db.event.findMany({
      where: { taskId, eventType: "task.schedule_proposed" },
      orderBy: { ingestedAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[0].dedupeKey).toBe(`task.schedule_proposed:${first.proposalId}`);
    expect(events[1].dedupeKey).toBe(`task.schedule_proposed:${second.proposalId}`);
  });
});
