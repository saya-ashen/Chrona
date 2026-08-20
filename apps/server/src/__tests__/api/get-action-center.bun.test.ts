import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { getActionCenter } from "@chrona/engine/test-support";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// getActionCenter — engine-layer unit for the action center read-model.
// The HTTP surface GET /api/inbox is covered by action-center-memory-schedule-pages;
// this file pins the engine contract on the bare read-model function:
//
// - empty workspace returns an empty action center (no approvals, no proposals,
//   no actionable runs)
// - Pending approval rows surface as kind=approval with riskLevel/ask
// - Pending schedule proposals surface as kind=schedule_proposal
// - WaitingForInput / Failed / Cancelled runs on tasks with a
//   latestRunId surface as kind=input or kind=recovery
// - items are sorted by sortAt desc and the sortAt field is stripped
//   from the final shape
// - recent completed latest runs appear as kind=execution_completed
// - tasks with no latestRunId do NOT contribute run items

async function seedRun(
  taskId: string,
  status: "WaitingForInput" | "Failed" | "Cancelled" | "Completed" | "Running",
  prompt?: string,
) {
  return db.run.create({
    data: {
      taskId,
      runtimeName: "hermes",
      status,
      triggeredBy: "test",
      pendingInputPrompt: prompt ?? null,
      runtimeRunRef: `runtime-${taskId}-${status}`,
      endedAt: status === "Completed" || status === "Cancelled" || status === "Failed" ? new Date() : null,
    },
  });
}

async function linkLatestRun(taskId: string, runId: string) {
  await db.task.update({ where: { id: taskId }, data: { latestRunId: runId } });
}

interface ActionCenterItem {
  id: string;
  kind: string;
  actionType: string;
  riskLevel: string;
  sourceTaskTitle: string;
  sourceTaskId: string;
  workspaceId: string;
  currentRunLabel: string | null;
  detail: string;
  summary: string;
  consequence: string;
}

describe("getActionCenter (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("empty workspace returns an empty action center", async () => {
    const { workspaceId } = await seedWorkspace("Action Center empty");

    const result = await getActionCenter(workspaceId);

    expect(result).toEqual([]);
  });

  it("Pending approval surfaces as kind=approval with ask from payload", async () => {
    const { workspaceId } = await seedWorkspace("Action Center approval");
    const { taskId } = await seedTask(workspaceId, { title: "Approval source task" });
    const run = await seedRun(taskId, "WaitingForInput");
    await linkLatestRun(taskId, run.id);

    await db.approval.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: "needs_decision",
        title: "Pick a direction",
        summary: "Two viable options; choose one",
        riskLevel: "high",
        status: "Pending",
        requestedAt: new Date("2030-10-01T12:00:00.000Z"),
        payload: { ask: "Approve path A or path B" },
      },
    });

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    // The same run that backs the approval also surfaces as a separate
    // kind=input run item. Filter to the approval slot.
    const approvalItem = result.find((i) => i.kind === "approval");
    expect(approvalItem).toBeDefined();
    const item = approvalItem!;
    expect(item.actionType).toBe("Approval needed");
    expect(item.riskLevel).toBe("high");
    expect(item.sourceTaskTitle).toBe("Approval source task");
    expect(item.sourceTaskId).toBe(taskId);
    expect(item.detail).toBe("needs_decision");
    expect(item.summary).toBe("Two viable options; choose one");
    expect(item.consequence).toBe("Approve path A or path B");
    // sortAt must be stripped
    expect("sortAt" in item).toBe(false);
  });

  it("Pending schedule proposal surfaces as kind=schedule_proposal with ai riskLevel=medium", async () => {
    const { workspaceId } = await seedWorkspace("Action Center proposal ai");
    const { taskId } = await seedTask(workspaceId, { title: "Proposal source task" });

    await db.scheduleProposal.create({
      data: {
        workspaceId,
        taskId,
        source: "ai",
        status: "Pending",
        proposedBy: "agent:planner",
        summary: "AI suggested slot",
        scheduledStartAt: new Date("2030-10-02T09:00:00.000Z"),
        scheduledEndAt: new Date("2030-10-02T10:00:00.000Z"),
        createdAt: new Date("2030-10-01T08:00:00.000Z"),
      },
    });

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.kind).toBe("schedule_proposal");
    expect(item.actionType).toBe("Schedule proposal");
    expect(item.riskLevel).toBe("medium");
    expect(item.detail).toBe("ai via agent:planner");
    expect(item.summary).toBe("AI suggested slot");
  });

  it("Pending schedule proposal with human source has riskLevel=low", async () => {
    const { workspaceId } = await seedWorkspace("Action Center proposal human");
    const { taskId } = await seedTask(workspaceId, { title: "Human proposal source" });

    await db.scheduleProposal.create({
      data: {
        workspaceId,
        taskId,
        source: "human",
        status: "Pending",
        proposedBy: "user:alice",
        summary: "Manual nudge",
        createdAt: new Date("2030-10-01T09:00:00.000Z"),
      },
    });

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    expect(result).toHaveLength(1);
    expect(result[0].riskLevel).toBe("low");
  });

  it("WaitingForInput run surfaces as kind=input with prompt summary", async () => {
    const { workspaceId } = await seedWorkspace("Action Center input");
    const { taskId } = await seedTask(workspaceId, { title: "Input task" });
    const run = await seedRun(taskId, "WaitingForInput", "Need clarification on the API contract");
    await linkLatestRun(taskId, run.id);

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    const inputItem = result.find((i) => i.kind === "input");
    expect(inputItem).toBeDefined();
    const item = inputItem!;
    expect(item.actionType).toBe("Input needed");
    expect(item.riskLevel).toBe("medium");
    expect(item.detail).toBe("Operator reply required");
    expect(item.summary).toBe("Need clarification on the API contract");
  });

  it("Failed run surfaces as kind=recovery with riskLevel=critical", async () => {
    const { workspaceId } = await seedWorkspace("Action Center failed");
    const { taskId } = await seedTask(workspaceId, { title: "Failed task" });
    const run = await seedRun(taskId, "Failed");
    await linkLatestRun(taskId, run.id);

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.kind).toBe("recovery");
    expect(item.riskLevel).toBe("critical");
    expect(item.detail).toBe("Latest run Failed");
    expect(item.summary).toBe("The latest run failed.");
  });

  it("does not surface recovery for completed tasks with failed latest provider run", async () => {
    const { workspaceId } = await seedWorkspace("Action Center completed provider failure");
    const { taskId } = await seedTask(workspaceId, { title: "Completed task", status: "Completed" });
    const run = await seedRun(taskId, "Failed");
    await linkLatestRun(taskId, run.id);
    await db.taskProjection.upsert({
      where: { taskId },
      create: {
        taskId,
        workspaceId,
        persistedStatus: "Completed",
        latestRunStatus: "Failed",
      },
      update: {
        persistedStatus: "Completed",
        latestRunStatus: "Failed",
      },
    });

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    expect(result.some((item) => item.kind === "recovery" && item.sourceTaskId === taskId)).toBe(false);
  });

  it("Cancelled retryable run surfaces as kind=recovery with riskLevel=high", async () => {
    const { workspaceId } = await seedWorkspace("Action Center cancelled retryable");
    const { taskId } = await seedTask(workspaceId, { title: "Cancelled task" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Cancelled",
        triggeredBy: "test",
        retryable: true,
        runtimeRunRef: `runtime-${taskId}-Cancelled`,
      },
    });
    await linkLatestRun(taskId, run.id);

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("recovery");
    expect(result[0].riskLevel).toBe("high");
  });

  it("recent completed latest run surfaces as kind=execution_completed", async () => {
    const { workspaceId } = await seedWorkspace("Action Center completed notification");
    const { taskId } = await seedTask(workspaceId, {
      title: "Completed task",
      status: "Completed",
    });
    const run = await seedRun(taskId, "Completed");
    await linkLatestRun(taskId, run.id);

    const result = await getActionCenter(workspaceId);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("execution_completed");
  });

  it("tasks with no latestRunId do NOT contribute run items even if they have old runs", async () => {
    const { workspaceId } = await seedWorkspace("Action Center no latest run");
    const { taskId } = await seedTask(workspaceId, { title: "No latest run task" });
    // A Failed run exists but is NOT linked via task.latestRunId
    await seedRun(taskId, "Failed");

    const result = await getActionCenter(workspaceId);

    expect(result).toEqual([]);
  });

  it("approvals and proposals are ordered by requestedAt/createdAt desc with sortAt stripped", async () => {
    const { workspaceId } = await seedWorkspace("Action Center sort order");
    const { taskId: taskA } = await seedTask(workspaceId, { title: "Older source" });
    const { taskId: taskB } = await seedTask(workspaceId, { title: "Newer source" });

    const runA = await seedRun(taskA, "WaitingForInput");
    const runB = await seedRun(taskB, "WaitingForInput");
    await linkLatestRun(taskA, runA.id);
    await linkLatestRun(taskB, runB.id);

    await db.approval.create({
      data: {
        workspaceId,
        taskId: taskA,
        runId: runA.id,
        type: "older",
        title: "Older",
        summary: "Older approval",
        riskLevel: "low",
        status: "Pending",
        requestedAt: new Date("2030-10-01T08:00:00.000Z"),
      },
    });
    await db.approval.create({
      data: {
        workspaceId,
        taskId: taskB,
        runId: runB.id,
        type: "newer",
        title: "Newer",
        summary: "Newer approval",
        riskLevel: "low",
        status: "Pending",
        requestedAt: new Date("2030-10-01T10:00:00.000Z"),
      },
    });

    const result = (await getActionCenter(workspaceId)) as ActionCenterItem[];
    const approvals = result.filter((i) => i.kind === "approval");
    expect(approvals).toHaveLength(2);
    expect(approvals[0].detail).toBe("newer");
    expect(approvals[1].detail).toBe("older");
    for (const item of result) {
      expect("sortAt" in item).toBe(false);
    }
  });
});
