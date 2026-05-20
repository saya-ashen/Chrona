import { beforeEach, describe, expect, it } from "bun:test";
import { ApprovalStatus, ArtifactType, RunStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { getTaskPage } from "@chrona/engine/modules/tasks/get-task-page";
import { resetTestDb, seedScheduleProposal, seedTask, seedWorkspace } from "../bun-test-helpers";

describe("task workspace console read data", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns schedule proposals and latest run data needed by the workspace console", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Console");
    const { taskId } = await seedTask(workspaceId, { title: "Scheduled execution" });
    const scheduledStartAt = new Date("2026-05-13T09:00:00.000Z");

    await seedScheduleProposal({
      workspaceId,
      taskId,
      summary: "Start tomorrow morning after dependency checks.",
      scheduledStartAt,
      status: "Pending",
    });
    await seedScheduleProposal({
      workspaceId,
      taskId,
      summary: "Rejected schedule should stay out of workspace readiness.",
      status: "Rejected",
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-workspace-console",
        status: RunStatus.Running,
        syncStatus: "syncing",
        triggeredBy: "user",
        startedAt: new Date("2026-05-12T10:00:00.000Z"),
      },
    });

    const page = await getTaskPage(taskId);

    expect(page.scheduleProposals).toHaveLength(1);
    expect(page.scheduleProposals[0]).toMatchObject({
      source: "ai",
      proposedBy: "test-agent",
      summary: "Start tomorrow morning after dependency checks.",
      status: "Pending",
      scheduledStartAt: scheduledStartAt.toISOString(),
    });
    expect(page.latestRunSummary).toMatchObject({
      id: run.id,
      status: "Running",
      startedAt: "2026-05-12T10:00:00.000Z",
    });
    expect(typeof page.latestRunSummary?.syncStatus).toBe("string");
  });

  it("returns approvals and artifacts needed by human-review workspace cards", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Human Review");
    const { taskId } = await seedTask(workspaceId, { title: "Review execution" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-human-review",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "agent",
        startedAt: new Date("2026-05-12T11:00:00.000Z"),
      },
    });

    await db.approval.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: "result_review",
        title: "Approve generated patch",
        summary: "Patch changes core task behavior.",
        riskLevel: "medium",
        status: ApprovalStatus.Pending,
        requestedAt: new Date("2026-05-12T11:05:00.000Z"),
      },
    });
    await db.artifact.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: ArtifactType.patch,
        title: "Generated patch",
        uri: "file://patch.diff",
      },
    });

    const page = await getTaskPage(taskId);

    expect(page.approvals).toContainEqual(expect.objectContaining({
      title: "Approve generated patch",
      status: "Pending",
      riskLevel: "medium",
      requestedAt: "2026-05-12T11:05:00.000Z",
    }));
    expect(page.artifacts).toContainEqual(expect.objectContaining({
      title: "Generated patch",
      type: "patch",
      uri: "file://patch.diff",
    }));
  });

  it("returns persisted provider runtime activity for the workspace activity timeline", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Provider Activity");
    const { taskId } = await seedTask(workspaceId, { title: "Stream provider activity" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "openclaw",
        runtimeRunRef: "run-provider-activity",
        status: RunStatus.Running,
        triggeredBy: "agent",
        startedAt: new Date("2026-05-12T12:00:00.000Z"),
      },
    });

    await db.event.create({
      data: {
        eventType: "provider.tool_started",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "runtime",
        actorId: "openclaw",
        source: "provider",
        payload: {
          runtimeName: "openclaw",
          provider: "openclaw",
          event: { type: "tool_started", toolName: "chrona_plan_read" },
        },
        dedupeKey: "provider-runtime-test-event",
        runtimeTs: new Date("2026-05-12T12:01:00.000Z"),
        ingestSequence: 1,
      },
    });

    const page = await getTaskPage(taskId);

    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      title: "Tool started",
      description: "chrona_plan_read",
      tone: "info",
      timestamp: "2026-05-12T12:01:00.000Z",
    }));
  });
});
