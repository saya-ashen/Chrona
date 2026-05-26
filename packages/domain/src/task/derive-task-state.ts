type DeriveTaskStateInput = {
  task: { status: string; latestRunId?: string | null };
  runs: Array<{ id: string; status: string; updatedAt: Date }>;
  approvals: Array<{ status: string; requestedAt: Date }>;
  sync: { stale: boolean };
  executionSession?: {
    status: string;
    currentNodeId: string | null;
    pauseReason: string | null;
  } | null;
};

type BlockReason = {
  blockType: string;
  scope: string;
  actionRequired: string;
  nodeId?: string;
};

type DeriveTaskStateResult = {
  persistedStatus: string;
  displayState: string | null;
  blockReason: BlockReason | null;
  blockSince: Date | null;
};

export function deriveTaskState(input: DeriveTaskStateInput): DeriveTaskStateResult {
  if (input.task.status === "Done") {
    return {
      persistedStatus: "Done",
      displayState: null,
      blockReason: null,
      blockSince: null,
    };
  }

  if (input.task.status === "Completed" && input.executionSession?.status !== "Paused") {
    return {
      persistedStatus: "Completed",
      displayState: input.sync.stale ? "Sync Stale" : null,
      blockReason: input.sync.stale
        ? {
            blockType: "sync_stale",
            scope: "run",
            actionRequired: "Re-sync",
          }
        : null,
      blockSince: input.sync.stale
        ? [...input.runs].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0]
          ?.updatedAt ?? null
        : null,
    };
  }

  const activeRun =
    input.runs.find((run) => run.id === input.task.latestRunId) ??
    [...input.runs].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ??
    null;

  const latestPendingApproval =
    [...input.approvals]
      .filter((approval) => approval.status === "Pending")
      .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime())[0] ?? null;

  if (input.sync.stale) {
    return {
      persistedStatus: input.task.status,
      displayState: "Sync Stale",
      blockReason: {
        blockType: "sync_stale",
        scope: "run",
        actionRequired: "Re-sync",
      },
      blockSince: activeRun?.updatedAt ?? null,
    };
  }

  if (activeRun?.status === "WaitingForApproval") {
    return {
      persistedStatus: "WaitingForApproval",
      displayState: null,
      blockReason: {
        blockType: "waiting_for_approval",
        scope: "run",
        actionRequired: "Approve / Reject / Edit and Approve",
      },
      blockSince: latestPendingApproval?.requestedAt ?? activeRun.updatedAt,
    };
  }

  if (activeRun?.status === "WaitingForInput") {
    return {
      persistedStatus: "WaitingForInput",
      displayState: null,
      blockReason: {
        blockType: "waiting_for_input",
        scope: "run",
        actionRequired: "Provide Input",
      },
      blockSince: activeRun.updatedAt,
    };
  }

  if (activeRun?.status === "Running" || activeRun?.status === "Pending") {
    return {
      persistedStatus: "Running",
      displayState: null,
      blockReason: null,
      blockSince: null,
    };
  }

  if (activeRun?.status === "Failed") {
    return {
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
      blockReason: {
        blockType: "run_failed",
        scope: "run",
        actionRequired: "Retry Run",
      },
      blockSince: activeRun.updatedAt,
    };
  }

  if (latestPendingApproval) {
    return {
      persistedStatus: input.task.status,
      displayState: null,
      blockReason: {
        blockType: "approval_pending",
        scope: "task",
        actionRequired: "Open Work Page",
      },
      blockSince: latestPendingApproval.requestedAt,
    };
  }

  if (input.executionSession?.status === "Paused") {
    const pauseReason = input.executionSession.pauseReason;
    if (pauseReason === "user_input") {
      return {
        persistedStatus: "WaitingForInput",
        displayState: null,
        blockReason: {
          blockType: "human_input_required",
          scope: "plan_node",
          actionRequired: "Provide Input",
          nodeId: input.executionSession.currentNodeId ?? undefined,
        },
        blockSince: activeRun?.updatedAt ?? null,
      };
    }
    if (pauseReason === "approval" || pauseReason === "review" || pauseReason === "replan_required") {
      return {
        persistedStatus: "WaitingForApproval",
        displayState: null,
        blockReason: {
          blockType: pauseReason === "replan_required" ? "replan_required" : "approval_required",
          scope: "plan_node",
          actionRequired: "Review Step Output",
          nodeId: input.executionSession.currentNodeId ?? undefined,
        },
        blockSince: activeRun?.updatedAt ?? null,
      };
    }
    if (pauseReason === "capability_unavailable") {
      return {
        persistedStatus: "Blocked",
        displayState: "Attention Needed",
        blockReason: {
          blockType: "capability_unavailable",
          scope: "runtime",
          actionRequired: "Check provider availability",
        },
        blockSince: activeRun?.updatedAt ?? null,
      };
    }
    if (pauseReason === "external_dependency") {
      return {
        persistedStatus: "Blocked",
        displayState: "Attention Needed",
        blockReason: {
          blockType: "external_dependency",
          scope: "plan_node",
          actionRequired: "Resume after external dependency is resolved",
          nodeId: input.executionSession.currentNodeId ?? undefined,
        },
        blockSince: activeRun?.updatedAt ?? null,
      };
    }
    return {
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
        blockReason: {
          blockType: "node_blocked",
          scope: "plan_node",
          actionRequired: "Check execution status",
          nodeId: input.executionSession.currentNodeId ?? undefined,
        },
      blockSince: activeRun?.updatedAt ?? null,
    };
  }

  if (input.executionSession?.status === "Active") {
    return {
      persistedStatus: "Running",
      displayState: "ExecutionActive",
      blockReason: null,
      blockSince: null,
    };
  }

  if (activeRun?.status === "Completed") {
    const reopenedStatus = new Set(["Draft", "Ready"]);

    return {
      persistedStatus:
        input.task.status === "Done"
          ? "Done"
          : reopenedStatus.has(input.task.status)
            ? input.task.status
            : "Completed",
      displayState: null,
      blockReason: null,
      blockSince: null,
    };
  }

  return {
    persistedStatus: input.task.status,
    displayState: null,
    blockReason: null,
    blockSince: null,
  };
}
