type DeriveTaskStateInput = {
  task: { status: string; latestRunId?: string | null };
  runs: Array<{ id: string; status: string; updatedAt: Date }>;
  approvals: Array<{ status: string; requestedAt: Date }>;
  sync: { stale: boolean };
};

type BlockReason = {
  blockType: string;
  scope: string;
  actionRequired: string;
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
      persistedStatus: "Blocked",
      displayState: "WaitingForApproval",
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
      persistedStatus: "Blocked",
      displayState: "WaitingForInput",
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

  return {
    persistedStatus: input.task.status,
    displayState: null,
    blockReason: null,
    blockSince: null,
  };
}
