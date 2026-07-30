import type { ProviderApprovalChoice } from "@chrona/providers-foundation";
import { db } from "@/lib/db";
import { getAiClient } from "@/modules/ai";
import { toJsonInput } from "@/modules/events";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";

const pendingStatus = "pending";

type ProviderApproval = Awaited<ReturnType<typeof findProviderApproval>>;
type ResolvedProviderApproval = NonNullable<ProviderApproval>;

export type ResolveProviderApprovalInput = {
  taskId: string;
  approvalId: string;
  choice: ProviderApprovalChoice;
  resolveAll?: boolean;
  note?: string;
};

export type ResolveProviderApprovalResult = {
  approval: ResolvedProviderApproval;
  provider: string;
  runId: string;
  choice: ProviderApprovalChoice;
  resolved: number;
  status: "resolved" | "not_pending" | "not_active" | "failed";
};

/**
 * Resolves a provider-originated approval as one application command.
 *
 * The provider round-trip happens before the guarded local finalization. The
 * finalization itself is a single transaction: only the still-pending approval
 * can transition, and its provider run always moves in the same commit. The
 * task projection is rebuilt after that commit for every terminal outcome.
 */
// Approval resolution keeps every terminal provider outcome explicit before transactional commit.
// eslint-disable-next-line complexity
export async function resolveProviderApproval(
  input: ResolveProviderApprovalInput,
): Promise<ResolveProviderApprovalResult> {
  const approval = await findProviderApproval(input);
  if (!approval) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Provider approval not found");
  }

  if (approval.status !== pendingStatus) {
    return notPendingResult(approval, input.choice);
  }
  if (!choicesFor(approval).includes(input.choice)) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Approval choice is not allowed");
  }

  const client = await getAiClient();
  const providerClient = client?.providerClient;
  if (!providerClient || providerClient.provider !== approval.provider || !providerClient.resolveApproval) {
    return finalizeUnsupportedProviderApproval({ approval, input });
  }

  const resolution = await providerClient.resolveApproval({
    runId: approval.providerRun.providerRunRef ?? approval.nativeRunId ?? approval.providerRunId,
    nativeRunId: approval.nativeRunId ?? approval.providerRun.nativeRunId ?? undefined,
    approvalId: approval.approvalRef ?? undefined,
    choice: input.choice,
    resolveAll: input.resolveAll,
    reason: input.note,
  });
  const status = resolution.status === "resolved"
    ? input.choice === "deny" ? "denied" : "approved"
    : resolution.status === "not_pending" ? "superseded" : "failed";

  const finalized = await finalizeProviderApproval({
    approval,
    input,
    status,
    resolutionRaw: resolution.raw,
    providerRunStatus: resolution.status === "resolved" ? "running" : approval.providerRun.status,
  });
  if (!finalized) {
    const current = await findProviderApproval(input);
    if (!current) {
      throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Provider approval not found");
    }
    return notPendingResult(current, input.choice);
  }

  return {
    approval: finalized,
    provider: resolution.provider,
    runId: resolution.runId,
    choice: resolution.choice,
    resolved: resolution.resolved,
    status: resolution.status,
  };
}

async function finalizeUnsupportedProviderApproval(input: {
  approval: ResolvedProviderApproval;
  input: ResolveProviderApprovalInput;
}): Promise<ResolveProviderApprovalResult> {
  const finalized = await finalizeProviderApproval({
    approval: input.approval,
    input: input.input,
    status: "failed",
    resolutionRaw: { status: "not_active", reason: "unsupported_provider_resolution" },
    error: { message: "Provider does not support approval resolution" },
    providerRunStatus: "failed",
    finishedAt: new Date(),
  });
  if (!finalized) {
    const current = await findProviderApproval(input.input);
    if (!current) {
      throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Provider approval not found");
    }
    return notPendingResult(current, input.input.choice);
  }

  return {
    approval: finalized,
    provider: input.approval.provider,
    runId: input.approval.providerRun.providerRunRef ?? input.approval.nativeRunId ?? input.approval.providerRunId,
    choice: input.input.choice,
    resolved: 0,
    status: "not_active",
  };
}

async function finalizeProviderApproval(input: {
  approval: ResolvedProviderApproval;
  input: ResolveProviderApprovalInput;
  status: string;
  resolutionRaw?: unknown;
  error?: unknown;
  providerRunStatus: string;
  finishedAt?: Date;
}) {
  const now = input.finishedAt ?? new Date();
  const finalized = await db.$transaction(async (tx) => {
    const transition = await tx.taskPlanProviderApproval.updateMany({
      where: { id: input.approval.id, taskId: input.input.taskId, status: pendingStatus },
      data: {
        status: input.status,
        resolvedAt: now,
        choice: input.input.choice,
        resolveAll: input.input.resolveAll === true,
        resolutionRaw: input.resolutionRaw === undefined ? undefined : toJsonInput(input.resolutionRaw),
        error: input.error === undefined ? undefined : toJsonInput(input.error),
      },
    });
    if (transition.count === 0) return null;

    await tx.taskPlanProviderRun.update({
      where: { id: input.approval.providerRunId },
      data: {
        status: input.providerRunStatus,
        finishedAt: input.finishedAt ?? undefined,
      },
    });

    return tx.taskPlanProviderApproval.findUniqueOrThrow({
      where: { id: input.approval.id },
      include: { providerRun: true },
    });
  });

  if (finalized) {
    await rebuildTaskProjection(input.input.taskId);
  }
  return finalized;
}

function findProviderApproval(input: Pick<ResolveProviderApprovalInput, "taskId" | "approvalId">) {
  return db.taskPlanProviderApproval.findFirst({
    where: { id: input.approvalId, taskId: input.taskId },
    include: { providerRun: true },
  });
}

function choicesFor(approval: ResolvedProviderApproval): ProviderApprovalChoice[] {
  return Array.isArray(approval.choices)
    ? approval.choices.filter((choice): choice is ProviderApprovalChoice =>
      choice === "approve_once" || choice === "approve_session" || choice === "approve_always" || choice === "deny"
    )
    : [];
}

function notPendingResult(approval: ResolvedProviderApproval, choice: ProviderApprovalChoice): ResolveProviderApprovalResult {
  return {
    approval,
    provider: approval.provider,
    runId: approval.nativeRunId ?? approval.providerRun.providerRunRef ?? approval.providerRunId,
    choice,
    resolved: 0,
    status: "not_pending",
  };
}
