import { Prisma, RunStatus, TaskOccurrenceStatus } from "@/generated/prisma/client";
import { currentSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";
import { withSchedulerWorkOwnership } from "@/modules/orchestration/scheduler-lease-repository";

const TERMINAL_OCCURRENCE_STATUSES: TaskOccurrenceStatus[] = [
  TaskOccurrenceStatus.Completed,
  TaskOccurrenceStatus.Cancelled,
  TaskOccurrenceStatus.Failed,
];

export type PlanRunTerminalStatus = Extract<RunStatus, "Completed" | "Failed" | "Cancelled">;

export type TerminalizePlanRunScopeInput = {
  taskId: string;
  workBlockId: string | null;
  planRunId: string;
  occurrenceId: string | null;
  status: PlanRunTerminalStatus;
};

/**
 * Atomically closes the provider approvals and occurrence owned by a terminal
 * plan run. The occurrence identity is explicit, never inferred from a work
 * block, so a delayed callback cannot terminalize a sibling occurrence.
 */
export async function terminalizePlanRunScopeInTransaction(
  input: TerminalizePlanRunScopeInput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const now = new Date();
  await tx.taskPlanProviderApproval.updateMany({
    where: {
      taskId: input.taskId,
      workBlockId: input.workBlockId,
      planRunId: input.planRunId,
      status: "pending",
    },
    data: {
      status: "superseded",
      resolvedAt: now,
      resolvedBy: "system",
      resolutionRaw: terminalResolution(input.status),
    },
  });

  if (!input.occurrenceId) return;
  await tx.taskOccurrence.updateMany({
    where: {
      id: input.occurrenceId,
      taskId: input.taskId,
      workBlockId: input.workBlockId,
      status: { notIn: TERMINAL_OCCURRENCE_STATUSES },
    },
    data: {
      status: occurrenceStatusFor(input.status),
      completedAt: now,
    },
  });
}

/** Uses the live scheduler fence, or a short transaction for non-scheduler callers. */
export async function terminalizePlanRunScope(
  input: TerminalizePlanRunScopeInput,
  suppliedTx?: Prisma.TransactionClient,
): Promise<void> {
  if (suppliedTx) return terminalizePlanRunScopeInTransaction(input, suppliedTx);
  return withSchedulerWorkOwnership(
    currentSchedulerWorkContext(),
    (tx) => terminalizePlanRunScopeInTransaction(input, tx),
  );
}

function occurrenceStatusFor(status: PlanRunTerminalStatus): TaskOccurrenceStatus {
  switch (status) {
    case RunStatus.Completed:
      return TaskOccurrenceStatus.Completed;
    case RunStatus.Cancelled:
      return TaskOccurrenceStatus.Cancelled;
    case RunStatus.Failed:
      return TaskOccurrenceStatus.Failed;
  }
}

function terminalResolution(status: PlanRunTerminalStatus): Prisma.InputJsonValue {
  return { resolution_source: "plan_run_terminalizer", terminal_status: status };
}
