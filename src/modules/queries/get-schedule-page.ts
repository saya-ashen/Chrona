import { db } from "@/lib/db";
import { syncStaleWorkspaceRunsForRead } from "@/modules/runtime/openclaw/freshness";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

function mapProjectionItem(item: Awaited<ReturnType<typeof db.taskProjection.findMany>>[number] & { task: {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
} }) {
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    title: item.task.title,
    description: item.task.description,
    priority: item.task.priority,
    ownerType: item.task.ownerType,
    assigneeAgentId: item.task.assigneeAgentId,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.actionRequired,
    approvalPendingCount: item.approvalPendingCount ?? 0,
    scheduleStatus: item.scheduleStatus,
    scheduleSource: item.scheduleSource,
    dueAt: item.dueAt,
    scheduledStartAt: item.scheduledStartAt,
    scheduledEndAt: item.scheduledEndAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount ?? 0,
    lastActivityAt: item.lastActivityAt,
    ...mapTaskRunnability(item.task),
  };
}

function mapTaskRunnability(task: {
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
}) {
  const runnability = deriveTaskRunnability(task);

  return {
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
  };
}

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

  const listItems = projections.map((item) => mapProjectionItem(item));

  const scheduled = listItems
    .filter((item) => item.scheduledStartAt && item.scheduledEndAt)
    .map((item) => item);

  const unscheduled = listItems
    .filter((item) => item.scheduleStatus === "Unscheduled")
    .map((item) => item);

  const risks = listItems
    .filter(
      (item) => item.scheduleStatus && ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus),
    )
    .map((item) => item);

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
    listItems,
    proposals: mappedProposals,
  };
}
