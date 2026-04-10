import { db } from "@/lib/db";
import { getRuntimeTaskConfigSpec, listRuntimeAdapterKeys } from "@/modules/runtime/registry";
import { syncStaleWorkspaceRunsForRead } from "@/modules/runtime/openclaw/freshness";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

function mapProjectionItem(item: Awaited<ReturnType<typeof db.taskProjection.findMany>>[number] & { task: {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  workspace: { defaultRuntime: string };
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
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
  workspace: { defaultRuntime: string };
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
}) {
  const runnability = deriveTaskRunnability({
    workspaceDefaultRuntime: task.workspace.defaultRuntime,
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  });

  return {
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
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

  const [workspace, projections, proposals] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { defaultRuntime: true },
    }),
    db.taskProjection.findMany({
      where: { workspaceId },
      include: { task: { include: { workspace: { select: { defaultRuntime: true } } } } },
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
  const runtimeAdapters = listRuntimeAdapterKeys().map((key) => ({
    key,
    label: key,
    spec: getRuntimeTaskConfigSpec(key),
  }));

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
    defaultRuntimeAdapterKey: workspace.defaultRuntime,
    runtimeAdapters,
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
