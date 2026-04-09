import { db } from "@/lib/db";

export async function getSchedulePage(workspaceId: string) {
  const [projections, proposals] = await Promise.all([
    db.taskProjection.findMany({
      where: { workspaceId },
      include: { task: true },
      orderBy: [
        { scheduledStartAt: "asc" },
        { dueAt: "asc" },
        { lastActivityAt: "desc" },
        { updatedAt: "desc" },
      ],
    }),
    db.scheduleProposal.findMany({
      where: {
        workspaceId,
        status: "Pending",
        source: "ai",
      },
      include: { task: true },
      orderBy: [{ scheduledStartAt: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return {
    scheduled: projections
      .filter(
        (item) =>
          item.scheduleStatus &&
          !["Unscheduled", "AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
      )
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        scheduleStatus: item.scheduleStatus,
        scheduleSource: item.scheduleSource,
        dueAt: item.dueAt,
        scheduledStartAt: item.scheduledStartAt,
        scheduledEndAt: item.scheduledEndAt,
        latestRunStatus: item.latestRunStatus,
      })),
    unscheduled: projections
      .filter((item) => item.scheduleStatus === "Unscheduled")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        persistedStatus: item.persistedStatus,
        actionRequired: item.actionRequired,
        scheduleProposalCount: item.scheduleProposalCount,
      })),
    risks: projections
      .filter(
        (item) => item.scheduleStatus && ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
      )
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        persistedStatus: item.persistedStatus,
        scheduleStatus: item.scheduleStatus,
        actionRequired: item.actionRequired,
        dueAt: item.dueAt,
        scheduledEndAt: item.scheduledEndAt,
      })),
    proposals: proposals.map((proposal) => ({
      proposalId: proposal.id,
      taskId: proposal.taskId,
      workspaceId: proposal.workspaceId,
      title: proposal.task.title,
      source: proposal.source,
      proposedBy: proposal.proposedBy,
      summary: proposal.summary,
      dueAt: proposal.dueAt,
      scheduledStartAt: proposal.scheduledStartAt,
      scheduledEndAt: proposal.scheduledEndAt,
    })),
  };
}
