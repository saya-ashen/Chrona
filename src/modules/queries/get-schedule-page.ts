import { db } from "@/lib/db";
import { syncStaleWorkspaceRunsForRead } from "@/modules/runtime/openclaw/freshness";

export async function getSchedulePage(workspaceId: string) {
  await syncStaleWorkspaceRunsForRead(workspaceId);

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

  const scheduled = projections
    .filter(
      (item) =>
        item.scheduleStatus &&
        !["Unscheduled", "AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
    )
    .map((item) => ({
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.task.title,
      priority: item.task.priority,
      ownerType: item.task.ownerType,
      assigneeAgentId: item.task.assigneeAgentId,
      persistedStatus: item.persistedStatus,
      actionRequired: item.actionRequired,
      approvalPendingCount: item.approvalPendingCount,
      scheduleStatus: item.scheduleStatus,
      scheduleSource: item.scheduleSource,
      dueAt: item.dueAt,
      scheduledStartAt: item.scheduledStartAt,
      scheduledEndAt: item.scheduledEndAt,
      latestRunStatus: item.latestRunStatus,
    }));

  const unscheduled = projections
    .filter((item) => item.scheduleStatus === "Unscheduled")
    .map((item) => ({
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.task.title,
      priority: item.task.priority,
      ownerType: item.task.ownerType,
      assigneeAgentId: item.task.assigneeAgentId,
      persistedStatus: item.persistedStatus,
      actionRequired: item.actionRequired,
      approvalPendingCount: item.approvalPendingCount,
      dueAt: item.dueAt,
      latestRunStatus: item.latestRunStatus,
      scheduleProposalCount: item.scheduleProposalCount,
    }));

  const risks = projections
    .filter(
      (item) => item.scheduleStatus && ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
    )
    .map((item) => ({
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.task.title,
      priority: item.task.priority,
      ownerType: item.task.ownerType,
      assigneeAgentId: item.task.assigneeAgentId,
      persistedStatus: item.persistedStatus,
      scheduleStatus: item.scheduleStatus,
      actionRequired: item.actionRequired,
      approvalPendingCount: item.approvalPendingCount,
      latestRunStatus: item.latestRunStatus,
      dueAt: item.dueAt,
      scheduledStartAt: item.scheduledStartAt,
      scheduledEndAt: item.scheduledEndAt,
    }));

  const mappedProposals = proposals.map((proposal) => ({
    proposalId: proposal.id,
    taskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    title: proposal.task.title,
    priority: proposal.task.priority,
    ownerType: proposal.task.ownerType,
    assigneeAgentId: proposal.assigneeAgentId,
    source: proposal.source,
    proposedBy: proposal.proposedBy,
    summary: proposal.summary,
    dueAt: proposal.dueAt,
    scheduledStartAt: proposal.scheduledStartAt,
    scheduledEndAt: proposal.scheduledEndAt,
  }));

  return {
    summary: {
      scheduledCount: scheduled.length,
      unscheduledCount: unscheduled.length,
      proposalCount: mappedProposals.length,
      riskCount: risks.length,
    },
    scheduled,
    unscheduled,
    risks,
    proposals: mappedProposals,
  };
}
