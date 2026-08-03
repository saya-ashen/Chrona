/* eslint-disable max-lines-per-function, complexity, max-lines -- Approval resolution keeps durable claim fencing and fail-closed outcomes auditable. */
import type { ProviderApprovalChoice, ProviderApprovalResolution } from "@chrona/providers-foundation";
import { publicProviderDescriptor, type PublicProviderDescriptor } from "@chrona/contracts";
import type { Prisma, TaskPlanProviderApprovalResolution } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getAiClient, stableJsonHash } from "@/modules/ai";
import { toJsonInput } from "@/modules/events";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";

const pendingStatus = "pending";
const approvalResolutionCanonicalizer = "provider_approval_resolution";
const approvalResolutionCanonicalizerVersion = 1;
const approvalResolutionLeaseMs = 120_000;

const approvalInclude = {
  planRun: true,
  providerRun: { include: { nodeAttempt: true, run: true } },
} satisfies Prisma.TaskPlanProviderApprovalInclude;

type ResolvedProviderApproval = Prisma.TaskPlanProviderApprovalGetPayload<{
  include: typeof approvalInclude;
}>;
type ApprovalScopeCheck =
  | { issue: null; approval: ResolvedProviderApproval }
  | { issue: "missing"; approval?: never; reason?: never }
  | { issue: "not_pending"; approval: ResolvedProviderApproval; reason?: never }
  | { issue: "inactive_scope"; approval: ResolvedProviderApproval; reason?: string };

type PublicResolutionStatus = "resolved" | "not_pending" | "not_active" | "failed" | "in_flight";
type CanonicalApprovalResult = {
  canonicalizer: typeof approvalResolutionCanonicalizer;
  canonicalizerVersion: typeof approvalResolutionCanonicalizerVersion;
  provider: PublicProviderDescriptor;
  choice: ProviderApprovalChoice;
  resolved: number;
  status: PublicResolutionStatus;
};
type ResolutionClaim = {
  receipt: TaskPlanProviderApprovalResolution;
  resolutionKey: string;
  resolutionDigest: string;
  leaseOwner: string;
};
type ResolutionPreflight =
  | { kind: "claimed"; approval: ResolvedProviderApproval; claim: ResolutionClaim }
  | { kind: "unknown_outcome"; approval: ResolvedProviderApproval; claim: ResolutionClaim }
  | { kind: "replay"; approval: ResolvedProviderApproval; result: CanonicalApprovalResult }
  | { kind: "in_flight"; approval: ResolvedProviderApproval }
  | { kind: "not_pending"; approval: ResolvedProviderApproval }
  | { kind: "not_active"; approval: ResolvedProviderApproval };

export type ResolveProviderApprovalInput = {
  taskId: string;
  approvalId: string;
  workBlockId: string | null;
  planRunId: string;
  choice: ProviderApprovalChoice;
  resolveAll?: boolean;
  note?: string;
  idempotencyKey: string;
};

export type ResolveProviderApprovalResult = {
  approval: ResolvedProviderApproval;
  choice: ProviderApprovalChoice;
  resolved: number;
  status: PublicResolutionStatus;
};

/**
 * Resolves a provider-originated approval as one application command.
 *
 * A durable resolution receipt is claimed before provider I/O. The receipt key
 * serializes duplicate human submissions, stores only a canonical public result,
 * and prevents blind replays when an earlier provider outcome is unknowable.
 */
export async function resolveProviderApproval(
  input: ResolveProviderApprovalInput,
): Promise<ResolveProviderApprovalResult> {
  const preflight = await preflightProviderApprovalResolution(input);
  if (preflight.kind === "replay") return resultFromCanonical(preflight.approval, preflight.result);
  if (preflight.kind === "in_flight") return inFlightResult(preflight.approval, input.choice);
  if (preflight.kind === "not_pending") return notPendingResult(preflight.approval, input.choice);
  if (preflight.kind === "not_active") return notActiveResult(preflight.approval, input.choice);
  if (preflight.kind === "unknown_outcome") {
    return finalizeUnknownProviderApprovalOutcome({ approval: preflight.approval, claim: preflight.claim, input });
  }

  const { approval, claim } = preflight;
  const client = approval.providerRun.aiClientId
    ? await getAiClient(approval.providerRun.aiClientId)
    : null;
  const providerClient = client?.providerClient;
  const exactClientConfig = client
    && approval.providerRun.aiClientConfigDigest
    && stableJsonHash(client.record.config) === approval.providerRun.aiClientConfigDigest;
  if (!providerClient || !exactClientConfig || providerClient.provider !== approval.provider || !providerClient.resolveApproval) {
    return finalizeUnsupportedProviderApproval({ approval, claim, input });
  }

  const requestedRunId = approval.providerRun.providerRunRef ?? approval.nativeRunId ?? approval.providerRunId;
  const requestedNativeRunId = approval.nativeRunId ?? approval.providerRun.nativeRunId ?? undefined;
  let resolution: ProviderApprovalResolution;
  try {
    resolution = await providerClient.resolveApproval({
      runId: requestedRunId,
      nativeRunId: requestedNativeRunId,
      approvalId: approval.approvalRef ?? undefined,
      choice: input.choice,
      resolveAll: input.resolveAll,
      reason: input.note,
      idempotencyKey: providerRpcIdempotencyKey(claim),
    });
  } catch {
    return finalizeProviderRpcFailure({ approval, claim, input });
  }
  if (!providerApprovalResolutionMatchesRequest({
    resolution,
    provider: approval.provider,
    runId: requestedRunId,
    nativeRunId: requestedNativeRunId,
    choice: input.choice,
  })) {
    return finalizeInvalidProviderApprovalReceipt({ approval, claim, input });
  }

  const approvalStatus = resolution.status === "resolved"
    ? input.choice === "deny" ? "denied" : "approved"
    : resolution.status === "not_pending" ? "superseded" : "failed";

  return finalizeProviderApproval({
    approval,
    claim,
    input,
    approvalStatus,
    providerResult: canonicalResult({
      provider: resolution.provider,
      choice: resolution.choice,
      resolved: resolution.resolved,
      status: resolution.status,
    }),
    resolutionRaw: sanitizeProviderResolutionRaw(resolution.raw),
    providerRunStatus: resolution.status === "resolved" ? "running" : approval.providerRun.status,
  });
}

export function providerApprovalResolutionMatchesRequest(input: {
  resolution: ProviderApprovalResolution;
  provider: string;
  runId: string;
  nativeRunId?: string;
  choice: ProviderApprovalChoice;
}): boolean {
  return input.resolution.provider === input.provider
    && input.resolution.runId === input.runId
    && input.resolution.nativeRunId === input.nativeRunId
    && input.resolution.choice === input.choice;
}

async function finalizeInvalidProviderApprovalReceipt(input: {
  approval: ResolvedProviderApproval;
  claim: ResolutionClaim;
  input: ResolveProviderApprovalInput;
}): Promise<ResolveProviderApprovalResult> {
  return finalizeProviderApproval({
    approval: input.approval,
    claim: input.claim,
    input: input.input,
    approvalStatus: "failed",
    providerResult: canonicalResult({
      provider: input.approval.provider,
      choice: input.input.choice,
      resolved: 0,
      status: "failed",
    }),
    resolutionRaw: { status: "failed", reason: "provider_approval_receipt_identity_mismatch" },
    error: {
      code: "provider_approval_receipt_identity_mismatch",
      message: "Provider approval receipt did not match the requested approval scope",
    },
    providerRunStatus: "failed",
    finishedAt: new Date(),
  });
}

async function finalizeUnsupportedProviderApproval(input: {
  approval: ResolvedProviderApproval;
  claim: ResolutionClaim;
  input: ResolveProviderApprovalInput;
}): Promise<ResolveProviderApprovalResult> {
  return finalizeProviderApproval({
    approval: input.approval,
    claim: input.claim,
    input: input.input,
    approvalStatus: "failed",
    providerResult: canonicalResult({ provider: input.approval.provider, choice: input.input.choice, resolved: 0, status: "failed" }),
    resolutionRaw: { status: "failed", reason: "unsupported_provider_resolution" },
    error: { code: "provider_approval_resolution_unsupported", message: "Provider approval resolution is not supported" },
    providerRunStatus: "failed",
    finishedAt: new Date(),
  });
}

async function finalizeProviderRpcFailure(input: {
  approval: ResolvedProviderApproval;
  claim: ResolutionClaim;
  input: ResolveProviderApprovalInput;
}): Promise<ResolveProviderApprovalResult> {
  return finalizeProviderApproval({
    approval: input.approval,
    claim: input.claim,
    input: input.input,
    approvalStatus: "failed",
    providerResult: canonicalResult({ provider: input.approval.provider, choice: input.input.choice, resolved: 0, status: "failed" }),
    resolutionRaw: { status: "failed", reason: "provider_approval_resolution_failed" },
    error: { code: "provider_approval_resolution_failed", message: "Provider approval resolution failed" },
    providerRunStatus: "failed",
    finishedAt: new Date(),
  });
}

async function finalizeUnknownProviderApprovalOutcome(input: {
  approval: ResolvedProviderApproval;
  claim: ResolutionClaim;
  input: ResolveProviderApprovalInput;
}): Promise<ResolveProviderApprovalResult> {
  return finalizeProviderApproval({
    approval: input.approval,
    claim: input.claim,
    input: input.input,
    approvalStatus: "failed",
    providerResult: canonicalResult({ provider: input.approval.provider, choice: input.input.choice, resolved: 0, status: "failed" }),
    resolutionRaw: { status: "failed", reason: "provider_approval_resolution_outcome_unknown" },
    error: {
      code: "provider_approval_resolution_outcome_unknown",
      message: "Provider approval outcome could not be recovered",
    },
    providerRunStatus: "failed",
    finishedAt: new Date(),
  });
}

async function finalizeProviderApproval(input: {
  approval: ResolvedProviderApproval;
  claim: ResolutionClaim;
  input: ResolveProviderApprovalInput;
  approvalStatus: string;
  providerResult: CanonicalApprovalResult;
  resolutionRaw?: unknown;
  error?: unknown;
  providerRunStatus: string;
  finishedAt?: Date;
}): Promise<ResolveProviderApprovalResult> {
  const now = input.finishedAt ?? new Date();
  const finalized = await db.$transaction(async (tx) => {
    const scope = await checkProviderApprovalScope(tx, input.input);
    if (scope.issue === "missing") {
      const result = canonicalResult({ provider: input.approval.provider, choice: input.input.choice, resolved: 0, status: "not_pending" });
      await completeReceiptInTransaction(tx, input.claim, result, now, "completed");
      return { result, approval: input.approval, domainChanged: false };
    }
    if (scope.issue === "not_pending") {
      const result = canonicalResult({ provider: scope.approval.provider, choice: input.input.choice, resolved: 0, status: "not_pending" });
      await completeReceiptInTransaction(tx, input.claim, result, now, "completed");
      return { result, approval: scope.approval, domainChanged: false };
    }
    if (scope.issue === "inactive_scope") {
      const result = canonicalResult({ provider: scope.approval.provider, choice: input.input.choice, resolved: 0, status: "not_active" });
      await completeReceiptInTransaction(tx, input.claim, result, now, "completed");
      return { result, approval: scope.approval, domainChanged: false };
    }

    const activeApproval = scope.approval;
    const providerTransition = await tx.taskPlanProviderRun.updateMany({
      where: {
        id: activeApproval.providerRunId,
        taskId: input.input.taskId,
        planRunId: input.input.planRunId,
        nodeAttemptId: activeApproval.nodeAttemptId ?? undefined,
        status: "waiting_for_approval",
        runId: activeApproval.providerRun.runId,
        planRun: { executionEpoch: activeApproval.planRun.executionEpoch },
        nodeAttempt: { executionEpoch: activeApproval.providerRun.nodeAttempt.executionEpoch },
        run: {
          taskId: input.input.taskId,
          workBlockId: activeApproval.planRun.workBlockId,
          nodeAttemptId: activeApproval.providerRun.nodeAttempt.id,
          occurrenceId: activeApproval.planRun.occurrenceId,
          ...(activeApproval.providerRun.run ? { status: activeApproval.providerRun.run.status } : {}),
        },
      },
      data: {
        status: input.providerRunStatus,
        finishedAt: input.finishedAt ?? undefined,
      },
    });
    if (providerTransition.count !== 1) {
      const result = canonicalResult({ provider: activeApproval.provider, choice: input.input.choice, resolved: 0, status: "not_active" });
      await completeReceiptInTransaction(tx, input.claim, result, now, "completed");
      return { result, approval: activeApproval, domainChanged: false };
    }

    const transition = await tx.taskPlanProviderApproval.updateMany({
      where: {
        id: activeApproval.id,
        taskId: input.input.taskId,
        workBlockId: input.input.workBlockId,
        planRunId: input.input.planRunId,
        providerRunId: activeApproval.providerRunId,
        nodeAttemptId: activeApproval.nodeAttemptId,
        status: pendingStatus,
      },
      data: {
        status: input.approvalStatus,
        resolvedAt: now,
        choice: input.input.choice,
        resolveAll: input.input.resolveAll === true,
        resolutionRaw: input.resolutionRaw === undefined ? undefined : toJsonInput(input.resolutionRaw),
        error: input.error === undefined ? undefined : toJsonInput(input.error),
      },
    });
    if (transition.count !== 1) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Provider approval changed during resolution");
    }

    await completeReceiptInTransaction(tx, input.claim, input.providerResult, now, input.providerResult.status === "failed" ? "failed" : "completed");
    const approval = await tx.taskPlanProviderApproval.findUniqueOrThrow({
      where: { id: activeApproval.id },
      include: approvalInclude,
    });
    return { result: input.providerResult, approval, domainChanged: true };
  });

  if (finalized.domainChanged) await rebuildTaskProjection(input.input.taskId);
  return resultFromCanonical(finalized.approval, finalized.result);
}

async function preflightProviderApprovalResolution(
  input: ResolveProviderApprovalInput,
  retryOnUniqueConflict = true,
): Promise<ResolutionPreflight> {
  const now = new Date();
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + approvalResolutionLeaseMs);
  const resolutionKey = input.idempotencyKey;
  const resolutionDigest = approvalResolutionDigest(input);

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.taskPlanProviderApprovalResolution.findFirst({
        where: { planRunId: input.planRunId, approvalId: input.approvalId, resolutionKey },
      });

      const scope = await checkProviderApprovalScope(tx, input);
      if (scope.issue === "missing") throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Provider approval not found");
      const approval = scope.approval;

      if (existing) {
        if (
          existing.resolutionDigest !== resolutionDigest
          || existing.canonicalizer !== approvalResolutionCanonicalizer
          || existing.canonicalizerVersion !== approvalResolutionCanonicalizerVersion
        ) {
          throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Approval resolution idempotency key was reused with a different request");
        }
        const replay = canonicalResultFromReceipt(existing);
        if (replay) return { kind: "replay", approval, result: replay };
        if (existing.status !== "claimed") {
          throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Approval resolution receipt is incomplete");
        }
        if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
          return { kind: "in_flight", approval };
        }
        if (scope.issue === "not_pending" || scope.issue === "inactive_scope") {
          const result = canonicalResult({
            provider: approval.provider,
            choice: input.choice,
            resolved: 0,
            status: scope.issue === "not_pending" ? "not_pending" : "not_active",
          });
          const completed = await tx.taskPlanProviderApprovalResolution.updateMany({
            where: {
              id: existing.id,
              status: "claimed",
              resolutionDigest,
              canonicalizer: approvalResolutionCanonicalizer,
              canonicalizerVersion: approvalResolutionCanonicalizerVersion,
              leaseOwner: existing.leaseOwner,
              leaseExpiresAt: existing.leaseExpiresAt,
            },
            data: {
              status: "completed",
              activeClaimKey: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              canonicalResult: toJsonInput(result),
              completedAt: now,
            },
          });
          return completed.count === 1
            ? { kind: "replay", approval, result }
            : { kind: "in_flight", approval };
        }
        if (!choicesFor(approval).includes(input.choice)) {
          throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Approval choice is not allowed");
        }
        const reclaimed = await tx.taskPlanProviderApprovalResolution.updateMany({
          where: {
            id: existing.id,
            status: "claimed",
            resolutionDigest,
            canonicalizer: approvalResolutionCanonicalizer,
            canonicalizerVersion: approvalResolutionCanonicalizerVersion,
            leaseOwner: existing.leaseOwner,
            leaseExpiresAt: existing.leaseExpiresAt,
          },
          data: {
            leaseOwner,
            leaseExpiresAt,
            completedAt: null,
          },
        });
        if (reclaimed.count !== 1) return { kind: "in_flight", approval };
        return {
          kind: "unknown_outcome",
          approval,
          claim: {
            receipt: { ...existing, leaseOwner, leaseExpiresAt },
            resolutionKey,
            resolutionDigest,
            leaseOwner,
          },
        };
      }

      const activeClaim = await tx.taskPlanProviderApprovalResolution.findFirst({
        where: { approvalId: approval.id, activeClaimKey: approval.id, status: "claimed" },
        select: { id: true },
      });
      if (activeClaim) return { kind: "in_flight", approval };

      if (scope.issue === "not_pending") return { kind: "not_pending", approval };
      if (!choicesFor(approval).includes(input.choice)) {
        throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Approval choice is not allowed");
      }
      if (scope.issue === "inactive_scope") return { kind: "not_active", approval };

      const receipt = await tx.taskPlanProviderApprovalResolution.create({
        data: {
          workspaceId: approval.workspaceId,
          taskId: approval.taskId,
          approvalId: approval.id,
          activeClaimKey: approval.id,
          providerRunId: approval.providerRunId,
          nodeAttemptId: approval.nodeAttemptId ?? approval.providerRun.nodeAttemptId,
          planRunId: approval.planRunId,
          resolutionKey,
          resolutionDigest,
          canonicalizer: approvalResolutionCanonicalizer,
          canonicalizerVersion: approvalResolutionCanonicalizerVersion,
          status: "claimed",
          leaseOwner,
          leaseExpiresAt,
        },
      });
      return { kind: "claimed", approval, claim: { receipt, resolutionKey, resolutionDigest, leaseOwner } };
    });
  } catch (error) {
    if (retryOnUniqueConflict && isPrismaUniqueConflict(error)) {
      return preflightProviderApprovalResolution(input, false);
    }
    throw error;
  }
}

async function completeReceiptInTransaction(
  tx: Prisma.TransactionClient,
  claim: ResolutionClaim,
  result: CanonicalApprovalResult,
  completedAt: Date,
  status: "completed" | "failed",
) {
  const receipt = await tx.taskPlanProviderApprovalResolution.updateMany({
    where: {
      id: claim.receipt.id,
      resolutionKey: claim.resolutionKey,
      resolutionDigest: claim.resolutionDigest,
      status: "claimed",
      leaseOwner: claim.leaseOwner,
    },
    data: {
      status,
      activeClaimKey: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      canonicalResult: toJsonInput(result),
      completedAt,
    },
  });
  if (receipt.count !== 1) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Provider approval resolution claim changed");
}

function providerApprovalIdentity(
  input: Pick<ResolveProviderApprovalInput, "taskId" | "approvalId" | "workBlockId" | "planRunId">,
) {
  return {
    id: input.approvalId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    planRunId: input.planRunId,
  };
}

async function checkProviderApprovalScope(
  client: Prisma.TransactionClient | typeof db,
  input: Pick<ResolveProviderApprovalInput, "taskId" | "approvalId" | "workBlockId" | "planRunId">,
): Promise<ApprovalScopeCheck> {
  const approval = await client.taskPlanProviderApproval.findFirst({
    where: providerApprovalIdentity(input),
    include: approvalInclude,
  });
  if (!approval) return { issue: "missing" };
  if (approval.status !== pendingStatus) return { issue: "not_pending", approval };

  const reason = await inactiveScopeReason(client, approval, input);
  return reason ? { issue: "inactive_scope", approval, reason } : { issue: null, approval };
}

async function inactiveScopeReason(
  client: Prisma.TransactionClient | typeof db,
  approval: ResolvedProviderApproval,
  input: Pick<ResolveProviderApprovalInput, "taskId" | "workBlockId" | "planRunId">,
): Promise<string | null> {
  const { planRun, providerRun } = approval;
  const nodeAttempt = providerRun.nodeAttempt;
  if (approval.taskId !== input.taskId || approval.workBlockId !== input.workBlockId || approval.planRunId !== input.planRunId) return "approval_scope_mismatch";
  if (approval.providerRunId !== providerRun.id || providerRun.planRunId !== planRun.id) return "provider_run_scope_mismatch";
  if (!approval.nodeAttemptId || approval.nodeAttemptId !== providerRun.nodeAttemptId || nodeAttempt.id !== approval.nodeAttemptId) return "node_attempt_scope_mismatch";
  if (providerRun.status !== "waiting_for_approval") return "provider_run_not_waiting_for_approval";
  if (!["running", "waiting_for_approval"].includes(nodeAttempt.status)) return "node_attempt_not_current";
  if (providerRun.taskId !== input.taskId || providerRun.planId !== planRun.planId) return "provider_run_plan_mismatch";
  if (nodeAttempt.taskId !== input.taskId || nodeAttempt.planRunId !== planRun.id || nodeAttempt.planId !== planRun.planId) return "node_attempt_plan_mismatch";
  const run = providerRun.run;
  if (!providerRun.runId || !run) return "provider_run_missing_canonical_run";
  if (!["Pending", "Running", "WaitingForApproval", "WaitingForInput"].includes(run.status)) return "canonical_run_not_active";
  if (run.taskId !== input.taskId) return "canonical_run_task_mismatch";
  if (run.nodeAttemptId !== nodeAttempt.id) return "canonical_run_node_attempt_mismatch";
  if (run.workBlockId !== planRun.workBlockId || run.workBlockId !== input.workBlockId) return "canonical_run_work_block_mismatch";
  if ((run.occurrenceId ?? null) !== (planRun.occurrenceId ?? null)) return "canonical_run_occurrence_mismatch";
  if (nodeAttempt.executionEpoch > planRun.executionEpoch) return "execution_epoch_mismatch";
  const latestAttempt = await client.taskPlanNodeAttempt.findFirst({
    where: { taskId: input.taskId, planRunId: planRun.id, nodeId: nodeAttempt.nodeId },
    orderBy: [{ attemptNumber: "desc" }, { startedAt: "desc" }],
    select: { id: true },
  });
  if (latestAttempt?.id !== nodeAttempt.id) return "obsolete_node_attempt";
  const latestProviderRun = await client.taskPlanProviderRun.findFirst({
    where: { taskId: input.taskId, planRunId: planRun.id, nodeAttemptId: nodeAttempt.id },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latestProviderRun?.id !== providerRun.id) return "obsolete_provider_run";

  const activeSession = await client.executionSession.findUnique({
    where: { taskId_activeScopeKey: { taskId: input.taskId, activeScopeKey: "active" } },
    select: { id: true, status: true, planId: true, workBlockId: true, occurrenceId: true, currentNodeAttemptId: true },
  });
  if (!activeSession || activeSession.status !== "Active") return "inactive_execution_session";
  if (activeSession.planId !== planRun.planId) return "active_session_plan_mismatch";
  if (activeSession.workBlockId !== planRun.workBlockId || activeSession.workBlockId !== input.workBlockId) return "active_session_work_block_mismatch";
  if ((activeSession.occurrenceId ?? null) !== (planRun.occurrenceId ?? null)) return "active_session_occurrence_mismatch";
  if (activeSession.currentNodeAttemptId !== nodeAttempt.id) return "active_session_node_attempt_mismatch";

  if (input.workBlockId) {
    const occurrence = await client.taskOccurrence.findUnique({ where: { workBlockId: input.workBlockId }, select: { id: true } });
    if ((occurrence?.id ?? null) !== (planRun.occurrenceId ?? null)) return "work_block_occurrence_mismatch";
  }
  return null;
}

function choicesFor(approval: ResolvedProviderApproval): ProviderApprovalChoice[] {
  return Array.isArray(approval.choices)
    ? approval.choices.filter((choice): choice is ProviderApprovalChoice =>
      choice === "approve_once" || choice === "approve_session" || choice === "approve_always" || choice === "deny"
    )
    : [];
}

function notActiveResult(approval: ResolvedProviderApproval, choice: ProviderApprovalChoice): ResolveProviderApprovalResult {
  return resultFromCanonical(approval, canonicalResult({ provider: approval.provider, choice, resolved: 0, status: "not_active" }));
}

function notPendingResult(approval: ResolvedProviderApproval, choice: ProviderApprovalChoice): ResolveProviderApprovalResult {
  return resultFromCanonical(approval, canonicalResult({ provider: approval.provider, choice, resolved: 0, status: "not_pending" }));
}

function inFlightResult(approval: ResolvedProviderApproval, choice: ProviderApprovalChoice): ResolveProviderApprovalResult {
  return resultFromCanonical(approval, canonicalResult({ provider: approval.provider, choice, resolved: 0, status: "in_flight" }));
}

function resultFromCanonical(approval: ResolvedProviderApproval, result: CanonicalApprovalResult): ResolveProviderApprovalResult {
  return {
    approval,
    choice: result.choice,
    resolved: result.resolved,
    status: result.status,
  };
}

function canonicalResult(input: {
  provider: string;
  choice: ProviderApprovalChoice;
  resolved: number;
  status: PublicResolutionStatus;
}): CanonicalApprovalResult {
  return {
    canonicalizer: approvalResolutionCanonicalizer,
    canonicalizerVersion: approvalResolutionCanonicalizerVersion,
    provider: publicProviderDescriptor(input.provider),
    choice: input.choice,
    resolved: Math.max(0, input.resolved),
    status: input.status,
  };
}

function canonicalResultFromReceipt(receipt: TaskPlanProviderApprovalResolution): CanonicalApprovalResult | null {
  if (!receipt.canonicalResult || (receipt.status !== "completed" && receipt.status !== "failed")) return null;
  const value = receipt.canonicalResult as Record<string, unknown>;
  if (value.canonicalizer !== approvalResolutionCanonicalizer) return null;
  if (value.canonicalizerVersion !== approvalResolutionCanonicalizerVersion) return null;
  const choice = value.choice;
  const status = value.status;
  if (choice !== "approve_once" && choice !== "approve_session" && choice !== "approve_always" && choice !== "deny") return null;
  if (status !== "resolved" && status !== "not_pending" && status !== "not_active" && status !== "failed" && status !== "in_flight") return null;
  if (typeof value.resolved !== "number") return null;
  return {
    canonicalizer: approvalResolutionCanonicalizer,
    canonicalizerVersion: approvalResolutionCanonicalizerVersion,
    provider: publicProviderDescriptor(typeof value.provider === "string" ? value.provider : null),
    choice,
    resolved: Math.max(0, value.resolved),
    status,
  };
}

function approvalResolutionDigest(input: ResolveProviderApprovalInput) {
  return stableJsonHash({
    canonicalizer: approvalResolutionCanonicalizer,
    canonicalizerVersion: approvalResolutionCanonicalizerVersion,
    taskId: input.taskId,
    approvalId: input.approvalId,
    workBlockId: input.workBlockId,
    planRunId: input.planRunId,
    resolutionKey: input.idempotencyKey,
    choice: input.choice,
    resolveAll: input.resolveAll === true,
    note: input.note ?? null,
  });
}

function providerRpcIdempotencyKey(claim: ResolutionClaim) {
  return `${approvalResolutionCanonicalizer}:${approvalResolutionCanonicalizerVersion}:${claim.receipt.id}:${claim.resolutionDigest}`;
}

function sanitizeProviderResolutionRaw(raw: unknown) {
  if (raw === undefined) return undefined;
  return { status: "provider_resolution_recorded" };
}

function isPrismaUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
