import { ApprovalStatus, RunStatus, ScheduleProposalStatus, TaskStatus } from "@/generated/prisma/client";
import type { ActionCenterProjection } from "@chrona/contracts/api";
import { db } from "@/lib/db";


const BLOCK_REASON_SUMMARIES: Record<string, string> = {
  capability_unavailable: "A required capability or provider is unavailable.",
  external_dependency: "Execution is waiting on an external dependency to resolve.",
  node_blocked: "A step in the plan is blocked and needs operator review.",
  run_failed: "The latest run failed and the task is blocked.",
  sync_stale: "The task state is out of sync and needs a refresh.",
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBlockedReason(blockReason: unknown): { summary: string; actionRequired: string } {
  const reason =
    blockReason && typeof blockReason === "object"
      ? (blockReason as { detail?: unknown; blockType?: unknown; actionRequired?: unknown })
      : null;

  const detail = readString(reason?.detail);
  const blockType = readString(reason?.blockType);
  const actionRequired = readString(reason?.actionRequired);

  const summary =
    detail ??
    (blockType ? BLOCK_REASON_SUMMARIES[blockType] : undefined) ??
    "This task is blocked and needs operator attention before it can continue.";

  return {
    summary,
    actionRequired: actionRequired ?? "Resume the task once the blocker is cleared.",
  };
}

export async function getActionCenter(workspaceId: string): Promise<ActionCenterProjection> {
  const [approvals, proposals, tasksWithLatestRuns, blockedTasks] = await Promise.all([
    db.approval.findMany({
      where: {
        workspaceId,
        status: ApprovalStatus.Pending,
      },
      include: {
        task: true,
        run: true,
      },
      orderBy: { requestedAt: "desc" },
    }),
    db.scheduleProposal.findMany({
      where: {
        workspaceId,
        status: ScheduleProposalStatus.Pending,
      },
      include: { task: true },
      orderBy: { createdAt: "desc" },
    }),
    db.task.findMany({
      where: {
        workspaceId,
        latestRunId: { not: null },
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        latestRunId: true,
      },
    }),
    db.task.findMany({
      where: {
        workspaceId,
        status: TaskStatus.Blocked,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        blockReason: true,
        latestRunId: true,
        updatedAt: true,
      },
    }),
  ]);

  const latestRunIds = tasksWithLatestRuns
    .map((task) => task.latestRunId)
    .filter((runId): runId is string => Boolean(runId));

  const latestRuns = latestRunIds.length
    ? await db.run.findMany({
        where: {
          id: { in: latestRunIds },
          status: { in: [RunStatus.WaitingForInput, RunStatus.Failed, RunStatus.Cancelled] },
        },
        select: {
          id: true,
          taskId: true,
          status: true,
          runtimeRunRef: true,
          retryable: true,
          pendingInputPrompt: true,
          updatedAt: true,
        },
      })
    : [];

  const taskByLatestRunId = new Map(
    tasksWithLatestRuns
      .filter((task): task is typeof task & { latestRunId: string } => Boolean(task.latestRunId))
      .map((task) => [task.latestRunId, task]),
  );

  const blockedRunIds = blockedTasks
    .map((task) => task.latestRunId)
    .filter((runId): runId is string => Boolean(runId));

  const blockedRunLabels = blockedRunIds.length
    ? await db.run.findMany({
        where: { id: { in: blockedRunIds } },
        select: { id: true, runtimeRunRef: true },
      })
    : [];

  const runLabelByRunId = new Map(blockedRunLabels.map((run) => [run.id, run.runtimeRunRef ?? run.id]));

  const approvalItems = approvals.map((approval) => {
    const payload = (approval.payload as { consequence?: string; ask?: string } | null) ?? null;

    return {
      id: approval.id,
      kind: "approval" as const,
      actionType: "Approval needed",
      riskLevel: approval.riskLevel,
      sourceTaskTitle: approval.task.title,
      sourceTaskId: approval.taskId,
      workspaceId: approval.workspaceId,
      currentRunLabel: approval.run.runtimeRunRef ?? approval.run.id,
      detail: approval.type,
      summary: approval.summary,
      consequence: payload?.consequence ?? payload?.ask ?? "Task remains blocked until resolved.",
      sortAt: approval.requestedAt,
    };
  });

  const proposalItems = proposals.map((proposal) => ({
    id: proposal.id,
    kind: "schedule_proposal" as const,
    actionType: "Schedule proposal",
    riskLevel: proposal.source === "ai" ? "medium" : "low",
    sourceTaskTitle: proposal.task.title,
    sourceTaskId: proposal.taskId,
    workspaceId: proposal.workspaceId,
    currentRunLabel: null,
    detail: `${proposal.source} via ${proposal.proposedBy}`,
    summary: proposal.summary,
    consequence: "The plan stays unchanged until this proposal is accepted or rejected.",
    sortAt: proposal.createdAt,
  }));

  const runItems = latestRuns
    .map((run) => {
      const task = taskByLatestRunId.get(run.id);

      if (!task) {
        return null;
      }

      if (run.status === RunStatus.WaitingForInput) {
        return {
          id: run.id,
          kind: "input" as const,
          actionType: "Input requested",
          riskLevel: "medium",
          sourceTaskTitle: task.title,
          sourceTaskId: task.id,
          workspaceId: task.workspaceId,
          currentRunLabel: run.runtimeRunRef ?? run.id,
          detail: "Operator reply required",
          summary: run.pendingInputPrompt ?? "The agent is waiting for guidance before it can continue.",
          consequence: "Execution stays paused until an operator replies from the workbench.",
          sortAt: run.updatedAt,
        };
      }

      return {
        id: run.id,
        kind: "recovery" as const,
        actionType: "Recovery needed",
        riskLevel: run.status === RunStatus.Failed ? "critical" : run.retryable ? "high" : "medium",
        sourceTaskTitle: task.title,
        sourceTaskId: task.id,
        workspaceId: task.workspaceId,
        currentRunLabel: run.runtimeRunRef ?? run.id,
        detail: `Latest run ${run.status}`,
        summary:
          run.status === RunStatus.Failed
            ? "The latest run stopped before finishing and needs an operator recovery prompt."
            : "The latest run was cancelled and needs operator review before restarting.",
        consequence: "Execution will not resume until someone restarts or recovers the run from the workbench.",
        sortAt: run.updatedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  // A `Blocked` task whose latest run is Failed/Cancelled/WaitingForInput is
  // already surfaced by `runItems`; emitting a separate blocked item would
  // double-count it. Dedup by task so every blocked task yields exactly one
  // actionable item.
  const coveredTaskIds = new Set<string>([
    ...approvalItems.map((item) => item.sourceTaskId),
    ...runItems.map((item) => item.sourceTaskId),
  ]);

  const blockedItems = blockedTasks
    .filter((task) => !coveredTaskIds.has(task.id))
    .map((task) => {
      const { summary, actionRequired } = readBlockedReason(task.blockReason);

      return {
        id: task.id,
        kind: "blocked" as const,
        actionType: "Blocked",
        riskLevel: "high",
        sourceTaskTitle: task.title,
        sourceTaskId: task.id,
        workspaceId: task.workspaceId,
        currentRunLabel: task.latestRunId ? runLabelByRunId.get(task.latestRunId) ?? task.latestRunId : null,
        detail: actionRequired,
        summary,
        consequence: "Execution stays blocked until an operator resolves the cause and resumes the task.",
        sortAt: task.updatedAt,
      };
    });

  return [...approvalItems, ...proposalItems, ...runItems, ...blockedItems]
    .sort((left, right) => right.sortAt.getTime() - left.sortAt.getTime())
    .map(({ sortAt: _sortAt, ...item }) => item);
}
