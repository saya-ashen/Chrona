import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { applySchedule } from "@/modules/commands/apply-schedule";
import { clearSchedule } from "@/modules/commands/clear-schedule";
import { decideScheduleProposal } from "@/modules/commands/decide-schedule-proposal";
import { proposeSchedule } from "@/modules/commands/propose-schedule";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("applySchedule", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("updates the task schedule, records a canonical event, and rebuilds the projection", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Plan the adapter work",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    futureStart.setHours(9, 0, 0, 0);
    const futureEnd = new Date(futureStart.getTime() + 2 * 60 * 60 * 1000);
    const futureDue = new Date(futureStart.getTime() + 9 * 60 * 60 * 1000);

    const result = await applySchedule({
      taskId: task.id,
      dueAt: futureDue,
      scheduledStartAt: futureStart,
      scheduledEndAt: futureEnd,
      scheduleSource: "human",
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });
    const scheduleEvents = await db.event.findMany({
      where: { taskId: task.id, eventType: "task.schedule_changed" },
      orderBy: { ingestSequence: "asc" },
    });

    expect(result).toEqual({
      taskId: task.id,
      workspaceId: workspace.id,
    });
    expect(storedTask.dueAt?.toISOString()).toBe(futureDue.toISOString());
    expect(storedTask.scheduledStartAt?.toISOString()).toBe(futureStart.toISOString());
    expect(storedTask.scheduledEndAt?.toISOString()).toBe(futureEnd.toISOString());
    expect(storedTask.scheduleStatus).toBe("Scheduled");
    expect(storedTask.scheduleSource).toBe("human");
    expect(storedTask.projection?.scheduleStatus).toBe("Scheduled");
    expect(storedTask.projection?.scheduleSource).toBe("human");
    expect(scheduleEvents).toHaveLength(1);
    expect(scheduleEvents[0]?.payload).toEqual(
      expect.objectContaining({
        due_at: futureDue.toISOString(),
        scheduled_start_at: futureStart.toISOString(),
        scheduled_end_at: futureEnd.toISOString(),
        schedule_source: "human",
      }),
    );
  });

  it("rejects schedule windows where end is earlier than start", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Validation",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Invalid window",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    await expect(
      applySchedule({
        taskId: task.id,
        dueAt: null,
        scheduledStartAt: new Date("2026-04-12T11:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-12T09:00:00.000Z"),
        scheduleSource: "human",
      }),
    ).rejects.toThrow("scheduledEndAt cannot be earlier than scheduledStartAt");
  });

  it("clears the task schedule, records an unscheduled event, and resets the projection", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Clear",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Clear the planned window",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        dueAt: new Date("2026-04-12T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-12T11:00:00.000Z"),
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const result = await clearSchedule({ taskId: task.id });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });
    const unscheduledEvents = await db.event.findMany({
      where: { taskId: task.id, eventType: "task.unscheduled" },
      orderBy: { ingestSequence: "asc" },
    });

    expect(result).toEqual({
      taskId: task.id,
      workspaceId: workspace.id,
    });
    expect(storedTask.dueAt).toBeNull();
    expect(storedTask.scheduledStartAt).toBeNull();
    expect(storedTask.scheduledEndAt).toBeNull();
    expect(storedTask.scheduleStatus).toBe("Unscheduled");
    expect(storedTask.scheduleSource).toBeNull();
    expect(storedTask.projection?.scheduleStatus).toBe("Unscheduled");
    expect(storedTask.projection?.scheduleSource).toBeNull();
    expect(unscheduledEvents).toHaveLength(1);
    expect(unscheduledEvents[0]?.payload).toEqual(
      expect.objectContaining({
        previous_due_at: "2026-04-12T18:00:00.000Z",
        previous_scheduled_start_at: "2026-04-12T09:00:00.000Z",
        previous_scheduled_end_at: "2026-04-12T11:00:00.000Z",
      }),
    );
  });

  it("stores an AI schedule proposal, records a proposal event, and updates the proposal count", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Proposal",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Review the timeline",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
      },
    });

    const result = await proposeSchedule({
      taskId: task.id,
      source: "ai",
      proposedBy: "planner-agent",
      summary: "Move this task to tomorrow morning",
      dueAt: new Date("2026-04-13T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-13T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-13T11:00:00.000Z"),
    });

    const proposal = await db.scheduleProposal.findUniqueOrThrow({
      where: { id: result.proposalId },
    });
    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });
    const proposalEvents = await db.event.findMany({
      where: { taskId: task.id, eventType: "task.schedule_proposed" },
      orderBy: { ingestSequence: "asc" },
    });

    expect(proposal.source).toBe("ai");
    expect(proposal.status).toBe("Pending");
    expect(proposal.summary).toBe("Move this task to tomorrow morning");
    expect(storedTask.projection?.scheduleProposalCount).toBe(1);
    expect(proposalEvents).toHaveLength(1);
    expect(proposalEvents[0]?.payload).toEqual(
      expect.objectContaining({
        proposal_id: proposal.id,
        source: "ai",
        proposed_by: "planner-agent",
      }),
    );
  });

  it("accepts a pending proposal by applying its schedule to the task", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Accept",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Adopt proposal",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    futureStart.setHours(9, 0, 0, 0);
    const futureEnd = new Date(futureStart.getTime() + 2 * 60 * 60 * 1000);
    const futureDue = new Date(futureStart.getTime() + 9 * 60 * 60 * 1000);

    const proposal = await db.scheduleProposal.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        source: "ai",
        status: "Pending",
        proposedBy: "planner-agent",
        summary: "Use the planner suggestion",
        dueAt: futureDue,
        scheduledStartAt: futureStart,
        scheduledEndAt: futureEnd,
      },
    });

    const result = await decideScheduleProposal({
      proposalId: proposal.id,
      decision: "Accepted",
      resolutionNote: "Looks good",
    });

    const storedProposal = await db.scheduleProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });

    expect(result).toEqual({
      taskId: task.id,
      workspaceId: workspace.id,
      proposalId: proposal.id,
    });
    expect(storedProposal.status).toBe("Accepted");
    expect(storedProposal.resolutionNote).toBe("Looks good");
    expect(storedTask.scheduleStatus).toBe("Scheduled");
    expect(storedTask.scheduleSource).toBe("ai");
    expect(storedTask.dueAt?.toISOString()).toBe(futureDue.toISOString());
    expect(storedTask.projection?.scheduleProposalCount).toBe(0);
  });

  it("rejects a pending proposal without changing the task schedule", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Reject",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Keep the current schedule",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
        dueAt: new Date("2026-04-15T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const proposal = await db.scheduleProposal.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        source: "ai",
        status: "Pending",
        proposedBy: "planner-agent",
        summary: "Move this out by one day",
        dueAt: new Date("2026-04-16T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-16T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00.000Z"),
      },
    });

    await decideScheduleProposal({
      proposalId: proposal.id,
      decision: "Rejected",
      resolutionNote: "Keep the original slot",
    });

    const storedProposal = await db.scheduleProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { projection: true },
    });

    expect(storedProposal.status).toBe("Rejected");
    expect(storedProposal.resolutionNote).toBe("Keep the original slot");
    expect(storedTask.dueAt?.toISOString()).toBe("2026-04-15T18:00:00.000Z");
    expect(storedTask.scheduleSource).toBe("human");
    expect(storedTask.projection?.scheduleProposalCount).toBe(0);
  });
});
