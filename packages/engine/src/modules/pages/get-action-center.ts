import {
  ApprovalStatus,
  RunStatus,
  ScheduleProposalStatus,
  TaskStatus,
} from "@/generated/prisma/client";
import type { ActionCenterProjection } from "@chrona/contracts/api";
import { deriveWorkStateView } from "@chrona/domain";
import { db } from "@/lib/db";

const DUE_NOW_WINDOW_MS = 15 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const CLOSED_DUE_STATUSES = [
  TaskStatus.Completed,
  TaskStatus.Done,
  TaskStatus.Cancelled,
];

type SortableActionCenterItem = ActionCenterProjection[number] & {
  sortAt: Date;
};

function buildDueItem(
  task: { id: string; title: string; workspaceId: string; dueAt: Date },
  now: Date,
): SortableActionCenterItem {
  const dueNowStartsAt = new Date(now.getTime() - DUE_NOW_WINDOW_MS);
  const dueNowEndsAt = new Date(now.getTime() + DUE_NOW_WINDOW_MS);

  if (task.dueAt < dueNowStartsAt) {
    return {
      id: `task-overdue:${task.id}`,
      kind: "task_overdue",
      actionType: "Task overdue",
      riskLevel: "high",
      sourceTaskTitle: task.title,
      sourceTaskId: task.id,
      workspaceId: task.workspaceId,
      currentRunLabel: null,
      detail: `Due at ${task.dueAt.toISOString()}`,
      summary: "Task is past its due time and still needs attention.",
      consequence: "Open the task to reschedule, execute, or close it.",
      sortAt: task.dueAt,
    };
  }

  if (task.dueAt <= dueNowEndsAt) {
    return {
      id: `task-due-now:${task.id}`,
      kind: "task_due_now",
      actionType: "Task due now",
      riskLevel: "medium",
      sourceTaskTitle: task.title,
      sourceTaskId: task.id,
      workspaceId: task.workspaceId,
      currentRunLabel: null,
      detail: `Due at ${task.dueAt.toISOString()}`,
      summary: "Task is due now.",
      consequence: "Open the task to start execution or adjust schedule.",
      sortAt: task.dueAt,
    };
  }

  return {
    id: `task-due-soon:${task.id}`,
    kind: "task_due_soon",
    actionType: "Task due soon",
    riskLevel: "low",
    sourceTaskTitle: task.title,
    sourceTaskId: task.id,
    workspaceId: task.workspaceId,
    currentRunLabel: null,
    detail: `Due at ${task.dueAt.toISOString()}`,
    summary: "Task is due soon.",
    consequence:
      "Open the task to prepare or reschedule before it becomes overdue.",
    sortAt: task.dueAt,
  };
}

function riskLevelForTimelineSeverity(severity: string | null) {
  switch (severity) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    default:
      return "low";
  }
}

const BLOCK_REASON_SUMMARIES: Record<string, string> = {
  capability_unavailable: "A required capability or provider is unavailable.",
  external_dependency:
    "Execution is waiting on an external dependency to resolve.",
  node_blocked: "A step in the plan is blocked and needs operator review.",
  run_failed: "The latest run failed and the task is blocked.",
  sync_stale: "The task state is out of sync and needs a refresh.",
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
const LEGACY_NON_ACTIONABLE_SCHEDULER_REASONS: Record<string, true> = {
  "Automatic execution will start at the configured schedule time.": true,
  "A run is already active for this task.": true,
  not_due: true,
  already_running: true,
};

function readSchedulerPayload(payload: unknown): {
  actionable?: boolean;
  reasonCode?: string;
  workBlockId?: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const value = payload as Record<string, unknown>;
  return {
    actionable:
      typeof value.actionable === "boolean" ? value.actionable : undefined,
    reasonCode: readString(value.reasonCode) ?? undefined,
    workBlockId: readString(value.workBlockId) ?? undefined,
  };
}

function isActionableSchedulerSkip(event: {
  reason: string | null;
  payload: unknown;
}): boolean {
  const payload = readSchedulerPayload(event.payload);
  if (payload.actionable !== undefined) return payload.actionable;
  if (
    payload.reasonCode &&
    LEGACY_NON_ACTIONABLE_SCHEDULER_REASONS[payload.reasonCode]
  ) {
    return false;
  }
  return (
    !event.reason || !LEGACY_NON_ACTIONABLE_SCHEDULER_REASONS[event.reason]
  );
}

function latestSchedulerEvents<
  T extends {
    eventType: string;
    taskId: string;
    reason: string | null;
    payload: unknown;
  },
>(events: T[]): T[] {
  const latestByKey = new Map<string, T>();
  for (const event of events) {
    if (
      event.eventType === "scheduler.skip" &&
      !isActionableSchedulerSkip(event)
    ) {
      continue;
    }
    const payload = readSchedulerPayload(event.payload);
    const key = [
      event.eventType,
      event.taskId,
      payload.workBlockId ?? "task",
      payload.reasonCode ?? event.reason ?? "none",
    ].join(":");
    if (!latestByKey.has(key)) latestByKey.set(key, event);
  }
  return Array.from(latestByKey.values());
}

function readBlockedReason(blockReason: unknown): {
  summary: string;
  actionRequired: string;
} {
  const reason =
    blockReason && typeof blockReason === "object"
      ? (blockReason as {
          detail?: unknown;
          blockType?: unknown;
          actionRequired?: unknown;
        })
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
    actionRequired:
      actionRequired ?? "Resume the task once the blocker is cleared.",
  };
}

export async function getActionCenter(
  workspaceId: string,
): Promise<ActionCenterProjection> {
  const now = new Date();
  const dueWindowStartsAt = new Date(now.getTime() - OVERDUE_WINDOW_MS);
  const dueWindowEndsAt = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const recentWindowStartsAt = new Date(
    now.getTime() - RECENT_NOTIFICATION_WINDOW_MS,
  );

  const [
    approvals,
    proposals,
    tasksWithLatestRuns,
    blockedTasks,
    dueTasks,
    schedulerEvents,
    completedRuns,
    infoNotifications,
  ] = await Promise.all([
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
        status: true,
        projection: { select: { persistedStatus: true, displayState: true } },
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
    db.task.findMany({
      where: {
        workspaceId,
        dueAt: { gte: dueWindowStartsAt, lte: dueWindowEndsAt },
        status: { notIn: CLOSED_DUE_STATUSES },
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        dueAt: true,
      },
    }),
    db.schedulerEvent.findMany({
      where: {
        workspaceId,
        eventType: { in: ["scheduler.start", "scheduler.skip"] },
        createdAt: { gte: recentWindowStartsAt },
      },
      include: { task: true },
      orderBy: { createdAt: "desc" },
    }),
    db.run.findMany({
      where: {
        status: RunStatus.Completed,
        updatedAt: { gte: recentWindowStartsAt },
        task: { workspaceId },
      },
      include: { task: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.taskTimelineItem.findMany({
      where: {
        workspaceId,
        kind: "notification.info",
        sortTime: { gte: recentWindowStartsAt },
      },
      include: { task: true },
      orderBy: { sortTime: "desc" },
    }),
  ]);

  const latestRunIds = tasksWithLatestRuns
    .map((task) => task.latestRunId)
    .filter((runId): runId is string => Boolean(runId));

  const latestRuns = latestRunIds.length
    ? await db.run.findMany({
        where: {
          id: { in: latestRunIds },
          status: {
            in: [
              RunStatus.WaitingForInput,
              RunStatus.Failed,
              RunStatus.Cancelled,
            ],
          },
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
      .filter((task): task is typeof task & { latestRunId: string } =>
        Boolean(task.latestRunId),
      )
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

  const runLabelByRunId = new Map(
    blockedRunLabels.map((run) => [run.id, run.runtimeRunRef ?? run.id]),
  );

  const approvalItems = approvals.map((approval) => {
    const payload =
      (approval.payload as { consequence?: string; ask?: string } | null) ??
      null;

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
      consequence:
        payload?.consequence ??
        payload?.ask ??
        "Task remains blocked until resolved.",
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
    consequence:
      "The plan stays unchanged until this proposal is accepted or rejected.",
    sortAt: proposal.createdAt,
  }));

  function runWorkState(
    run: {
      status: RunStatus;
      pendingInputPrompt: string | null;
      retryable: boolean;
    },
    task: { status: TaskStatus; title: string },
  ) {
    const executionStatus =
      run.status === RunStatus.WaitingForInput
        ? "waiting_for_user"
        : run.status === RunStatus.Failed
          ? "failed"
          : run.status === RunStatus.Cancelled
            ? "cancelled"
            : String(run.status).toLowerCase();
    return deriveWorkStateView({
      taskStatus: task.status,
      executionStatus,
      blockReason:
        run.status === RunStatus.Failed
          ? {
              blockType: "run_failed",
              detail: run.pendingInputPrompt ?? "The latest run failed.",
              scope: "run",
            }
          : null,
    });
  }

  const runItems = latestRuns
    .map((run) => {
      const task = taskByLatestRunId.get(run.id);

      if (!task) {
        return null;
      }

      const taskState = deriveWorkStateView({
        taskStatus: task.projection?.persistedStatus ?? task.status,
        executionStatus: task.projection?.displayState,
      }).state;
      const taskStateIsTerminal =
        taskState === "done" ||
        taskState === "result_ready" ||
        taskState === "cancelled";
      const isOwnCancellationRecovery =
        task.status === TaskStatus.Cancelled &&
        run.status === RunStatus.Cancelled;

      if (taskStateIsTerminal && !isOwnCancellationRecovery) {
        return null;
      }

      const workState = runWorkState(run, task);
      if (run.status === RunStatus.WaitingForInput) {
        return {
          id: run.id,
          kind: "input" as const,
          actionType: workState.label,
          riskLevel: "medium",
          sourceTaskTitle: task.title,
          sourceTaskId: task.id,
          workspaceId: task.workspaceId,
          currentRunLabel: run.runtimeRunRef ?? run.id,
          detail: "Operator reply required",
          summary: run.pendingInputPrompt ?? workState.nextActionLabel,
          consequence: workState.nextActionLabel,
          sortAt: run.updatedAt,
        };
      }

      return {
        id: run.id,
        kind: "recovery" as const,
        actionType: workState.label,
        riskLevel:
          run.status === RunStatus.Failed
            ? "critical"
            : run.retryable
              ? "high"
              : "medium",
        sourceTaskTitle: task.title,
        sourceTaskId: task.id,
        workspaceId: task.workspaceId,
        currentRunLabel: run.runtimeRunRef ?? run.id,
        detail: `Latest run ${run.status}`,
        summary:
          workState.blocker?.reason ??
          (run.status === RunStatus.Failed
            ? "The latest run stopped before finishing."
            : "The latest run was cancelled."),
        consequence: workState.nextActionLabel,
        sortAt: run.updatedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const dueItems = dueTasks
    .filter((task): task is typeof task & { dueAt: Date } =>
      Boolean(task.dueAt),
    )
    .map((task) => buildDueItem(task, now));

  const schedulerItems = latestSchedulerEvents(schedulerEvents).map((event) => {
    const isStart = event.eventType === "scheduler.start";

    return {
      id: `${isStart ? "auto-execution-started" : "auto-execution-skipped"}:${event.id}`,
      kind: isStart
        ? ("auto_execution_started" as const)
        : ("auto_execution_skipped" as const),
      actionType: isStart ? "Auto execution started" : "Auto execution skipped",
      riskLevel: isStart ? "low" : "medium",
      sourceTaskTitle: event.task.title,
      sourceTaskId: event.taskId,
      workspaceId: event.workspaceId,
      currentRunLabel: null,
      detail: readSchedulerPayload(event.payload).reasonCode ?? null,
      summary: isStart
        ? "Scheduled automation started this task."
        : (event.reason ?? "Scheduled automation could not start this task."),
      consequence: isStart
        ? "Open the task to monitor progress."
        : "Automatic execution remains paused until this reason is resolved.",
      sortAt: event.createdAt,
    };
  });

  const latestCompletedRunByTask = new Map<
    string,
    (typeof completedRuns)[number]
  >();
  for (const run of completedRuns) {
    if (run.task.latestRunId !== run.id) continue;
    if (!latestCompletedRunByTask.has(run.taskId))
      latestCompletedRunByTask.set(run.taskId, run);
  }

  const completedItems = Array.from(latestCompletedRunByTask.values()).map(
    (run) => ({
      id: `execution-completed:${run.id}`,
      kind: "execution_completed" as const,
      actionType: "Execution completed",
      riskLevel: "low",
      sourceTaskTitle: run.task.title,
      sourceTaskId: run.taskId,
      workspaceId: run.task.workspaceId,
      currentRunLabel: run.runtimeRunRef ?? run.id,
      detail: "Latest execution completed",
      summary: "Task execution completed recently.",
      consequence:
        "Open the task to review results or mark follow-up complete.",
      sortAt: run.endedAt ?? run.updatedAt,
    }),
  );

  const infoItems = infoNotifications.map((notification) => ({
    id: `notification-info:${notification.id}`,
    kind: "notification_info" as const,
    actionType: notification.title,
    riskLevel: riskLevelForTimelineSeverity(notification.severity),
    sourceTaskTitle: notification.task.title,
    sourceTaskId: notification.taskId,
    workspaceId: notification.workspaceId,
    currentRunLabel: null,
    detail: notification.status ?? null,
    summary: notification.body ?? notification.title,
    consequence: "Open the task for more context.",
    sortAt: notification.sortTime,
  }));

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
        currentRunLabel: task.latestRunId
          ? (runLabelByRunId.get(task.latestRunId) ?? task.latestRunId)
          : null,
        detail: actionRequired,
        summary,
        consequence:
          "Execution stays blocked until an operator resolves the cause and resumes the task.",
        sortAt: task.updatedAt,
      };
    });

  return [
    ...approvalItems,
    ...proposalItems,
    ...runItems,
    ...dueItems,
    ...schedulerItems,
    ...completedItems,
    ...infoItems,
    ...blockedItems,
  ]
    .sort((left, right) => right.sortAt.getTime() - left.sortAt.getTime())
    .map(({ sortAt: _sortAt, ...item }) => item);
}
