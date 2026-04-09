import { ApprovalStatus, RunStatus, ScheduleProposalStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { syncStaleWorkspaceRunsForRead } from "@/modules/runtime/openclaw/freshness";

export async function getInbox(workspaceId: string) {
  await syncStaleWorkspaceRunsForRead(workspaceId);

  const [approvals, proposals, tasksWithLatestRuns] = await Promise.all([
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

  return [...approvalItems, ...proposalItems, ...runItems]
    .sort((left, right) => right.sortAt.getTime() - left.sortAt.getTime())
    .map(({ sortAt: _sortAt, ...item }) => item);
}
