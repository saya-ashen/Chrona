/* eslint-disable complexity, @typescript-eslint/no-unnecessary-condition -- Persistence CAS paths defensively validate legacy and concurrent row states. */
import {
  AiFeatureRunStatus as PrismaAiFeatureRunStatus,
  db,
  Prisma,
  type AiFeatureRun,
  type AiFeatureRunAction,
  type AiFeatureRunActionStatus as PrismaAiFeatureRunActionStatus,
  type AiFeatureRunObservation,
} from "@chrona/db";
import type {
  AiFeatureRuntimeError,
  AiFeatureManifest,
  AiFeatureRunStatus,
  AiJsonObject,
  AiObjective,
  AiObservationEnvelope,
  AiRunResult,
  CompletionValidation,
  ProposedAction,
} from "@chrona/contracts/ai-feature-runtime";
import type {
  AiFeatureRunActionRecord,
  AiFeatureRunPublicRead,
  AiFeatureRunRecord,
  AiFeatureRunRepositoryPort,
  ClaimAiFeatureRunActionInput,
  ClaimAiFeatureRunActionResult,
  ClaimAiFeatureRunInput,
  CreateAiFeatureRunInput,
  CreateAiFeatureRunResult,
  ReadAiFeatureRunPublicInput,
  ReleaseAiFeatureRunLeaseInput,
  UpdateAiFeatureRunInput,
} from "../../feature-runtime/run-repository";
import { withSchedulerWorkOwnership } from "@/modules/orchestration/scheduler-lease-repository";
import { currentSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";

const statusToDb: Record<AiFeatureRunStatus, PrismaAiFeatureRunStatus> = {
  queued: "Queued",
  preparing_observations: "PreparingObservations",
  starting_provider: "StartingProvider",
  running: "Running",
  validating: "Validating",
  committing_result: "CommittingResult",
  completed: "Completed",
  needs_input: "NeedsInput",
  cannot_complete: "CannotComplete",
  failed: "Failed",
  cancelled: "Cancelled",
};

const statusFromDb: Record<PrismaAiFeatureRunStatus, AiFeatureRunStatus> = {
  Queued: "queued",
  PreparingObservations: "preparing_observations",
  StartingProvider: "starting_provider",
  Running: "running",
  Validating: "validating",
  CommittingResult: "committing_result",
  Completed: "completed",
  NeedsInput: "needs_input",
  CannotComplete: "cannot_complete",
  Failed: "failed",
  Cancelled: "cancelled",
};


const actionStatusFromDb: Record<PrismaAiFeatureRunActionStatus, AiFeatureRunActionRecord["status"]> = {
  Pending: "pending",
  Executing: "executing",
  Completed: "completed",
  Failed: "failed",
  Proposed: "failed",
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function optionalJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined ? Prisma.JsonNull : asJson(value);
}

function date(value: string | undefined): Date | null | undefined {
  return value === undefined ? undefined : new Date(value);
}

function iso(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function errorFromRecord(record: { errorCode: string | null; errorMessage: string | null }): AiFeatureRuntimeError | undefined {
  return record.errorCode && record.errorMessage
    ? { code: record.errorCode as AiFeatureRuntimeError["code"], message: record.errorMessage }
    : undefined;
}
type AiFeatureRunWithObservations = AiFeatureRun & { observations: AiFeatureRunObservation[] };

type AiFeatureRunActionWithOutputObservation = AiFeatureRunAction & {
  outputObservation: AiFeatureRunObservation | null;
};


function mapObservation(record: AiFeatureRunObservation): AiObservationEnvelope {
  return {
    observationId: record.observationId,
    type: { id: record.observationType, version: record.observationVersion },
    key: record.observationKey,
    revision: record.revision,
    observedAt: record.observedAt.toISOString(),
    canonicalizerId: record.canonicalizerId,
    hashAlgorithm: "sha256",
    contentHash: record.contentHash,
    data: record.payload as AiJsonObject,
  };
}

function mapAction(record: AiFeatureRunActionWithOutputObservation): AiFeatureRunActionRecord {
  return {
    id: record.id,
    runId: record.runId,
    callId: record.callId,
    executionKey: record.executionKey,
    action: { id: record.actionId, version: record.actionVersion },
    status: record.errorCode === "action_outcome_unknown" ? "outcome_unknown" : actionStatusFromDb[record.status] ?? "failed",
    attempt: record.attempt,
    ...(record.leaseOwner ? { leaseOwner: record.leaseOwner } : {}),
    ...(iso(record.leaseExpiresAt) ? { leaseExpiresAt: iso(record.leaseExpiresAt) } : {}),
    input: record.input as AiJsonObject,
    inputHash: record.inputHash,
    ...(record.outputObservation ? { outputObservation: mapObservation(record.outputObservation) } : {}),
    ...(errorFromRecord(record) ? { error: errorFromRecord(record)! } : {}),
  };
}

function mapRun(record: AiFeatureRunWithObservations): AiFeatureRunRecord {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    feature: { id: record.featureId, version: record.featureVersion },
    manifest: record.manifest as AiFeatureManifest,
    manifestHash: record.manifestHash,
    subject: {
      type: record.subjectType,
      id: record.subjectId,
      ...(record.subjectRevision ? { revision: record.subjectRevision } : {}),
    },
    operation: { kind: record.operationKind, operationId: record.operationId },
    input: record.input as AiJsonObject,
    inputHash: record.inputHash,
    objective: record.objective as AiObjective,
    status: statusFromDb[record.status],
    stateVersion: record.stateVersion,
    attempt: record.attempt,
    observations: (record.observations ?? []).map(mapObservation),
    proposedActions: (record.proposedActions ?? []) as ProposedAction[],
    ...(record.terminalResult ? { result: record.terminalResult as AiRunResult } : {}),
    ...(record.terminalCandidate ? { terminalCandidate: record.terminalCandidate } : {}),
    ...(record.completionReport ? { completion: record.completionReport as CompletionValidation } : {}),
    ...(errorFromRecord(record) ? { error: errorFromRecord(record)! } : {}),
    ...(record.commitReference ? { commitReference: record.commitReference as AiJsonObject } : {}),
    ...(record.providerRunRef ? { providerRunRef: record.providerRunRef } : {}),
    ...(record.providerResumeRef ? { providerResumeRef: record.providerResumeRef } : {}),
    ...(iso(record.startedAt) ? { startedAt: iso(record.startedAt)! } : {}),
    ...(record.providerClientId ? { providerClientId: record.providerClientId } : {}),
    ...(record.providerName ? { providerName: record.providerName } : {}),
    ...(record.providerConfigFingerprint ? { providerConfigFingerprint: record.providerConfigFingerprint } : {}),
    ...(iso(record.finishedAt) ? { finishedAt: iso(record.finishedAt)! } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.leaseOwner ? { leaseOwner: record.leaseOwner } : {}),
    ...(iso(record.leaseExpiresAt) ? { leaseExpiresAt: iso(record.leaseExpiresAt)! } : {}),
  };
}

async function getRun(client: typeof db | Prisma.TransactionClient, id: string): Promise<AiFeatureRunRecord | null> {
  const record = await client.aiFeatureRun.findUnique({
    where: { id },
    include: {
      observations: { orderBy: { sequence: "asc" } },
      actions: { include: { outputObservation: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return record ? mapRun(record) : null;
}

function runUpdateData(input: UpdateAiFeatureRunInput): Prisma.AiFeatureRunUpdateManyMutationInput {
  return {
    status: statusToDb[input.status],
    stateVersion: { increment: 1 },
    ...(input.result !== undefined ? { terminalResult: optionalJson(input.result) } : {}),
    ...(input.terminalCandidate !== undefined ? { terminalCandidate: optionalJson(input.terminalCandidate) } : {}),
    ...(input.completion !== undefined ? { completionReport: optionalJson(input.completion) } : {}),
    ...(input.error !== undefined ? { errorCode: input.error.code, errorMessage: input.error.message } : {}),
    ...(input.proposedActions !== undefined ? { proposedActions: optionalJson(input.proposedActions) } : {}),
    ...(input.commitReference !== undefined ? { commitReference: optionalJson(input.commitReference) } : {}),
    ...(input.providerRunRef !== undefined ? { providerRunRef: input.providerRunRef } : {}),
    ...(input.providerResumeRef !== undefined ? { providerResumeRef: input.providerResumeRef } : {}),
    ...(input.startedAt !== undefined ? { startedAt: date(input.startedAt) } : {}),
    ...(input.finishedAt !== undefined ? { finishedAt: date(input.finishedAt) } : {}),
  };
}

function observationData(observation: AiObservationEnvelope, sequence: number, delivery: "Seed" | "ActionResult") {
  return {
    sequence,
    observationId: observation.observationId,
    observationType: observation.type.id,
    observationVersion: observation.type.version,
    observationKey: observation.key,
    revision: observation.revision,
    delivery,
    canonicalizerId: observation.canonicalizerId,
    hashAlgorithm: observation.hashAlgorithm,
    contentHash: observation.contentHash,
    payload: asJson(observation.data),
    observedAt: new Date(observation.observedAt),
  };
}

export type AtomicAiFeatureRunCommit = {
  runId: string;
  expectedStateVersion: number;
  leaseOwner: string;
  terminal: {
    result: AiRunResult;
    completion?: CompletionValidation;
    proposedActions: readonly ProposedAction[];
    finishedAt: string;
  };
  commitReference?: AiJsonObject;
};

/** Finalizes a feature run within the caller's product-projection transaction. */
export async function commitAiFeatureRunAtomically(
  tx: Prisma.TransactionClient,
  input: AtomicAiFeatureRunCommit,
): Promise<boolean> {
  const updated = await tx.aiFeatureRun.updateMany({
    where: { id: input.runId, stateVersion: input.expectedStateVersion, leaseOwner: input.leaseOwner },
    data: {
      status: statusToDb[input.terminal.result.status],
      stateVersion: { increment: 1 },
      terminalResult: asJson(input.terminal.result),
      completionReport: optionalJson(input.terminal.completion),
      proposedActions: asJson(input.terminal.proposedActions),
      commitReference: optionalJson(input.commitReference),
      committedAt: new Date(input.terminal.finishedAt),
      finishedAt: new Date(input.terminal.finishedAt),
    },
  });
  return updated.count === 1;
}

/** Prisma-backed persistence adapter for the feature runtime's durable protocol. */
export class PrismaAiFeatureRunStore implements AiFeatureRunRepositoryPort {
  constructor(private readonly client: typeof db | Prisma.TransactionClient = db) {}

  async pinProviderBinding(input: {
    runId: string;
    providerClientId: string;
    providerName: string;
    providerConfigFingerprint: string;
  }): Promise<AiFeatureRunRecord> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      await tx.aiFeatureRun.updateMany({
        where: {
          id: input.runId,
          providerClientId: null,
          providerName: null,
          providerConfigFingerprint: null,
        },
        data: {
          providerClientId: input.providerClientId,
          providerName: input.providerName,
          providerConfigFingerprint: input.providerConfigFingerprint,
        },
      });
      const run = await getRun(tx, input.runId);
      if (!run) throw new Error(`AI Feature Run '${input.runId}' does not exist.`);
      if (
        run.providerClientId !== input.providerClientId
        || run.providerName !== input.providerName
        || run.providerConfigFingerprint !== input.providerConfigFingerprint
      ) {
        throw new Error(`AI Feature Run '${input.runId}' is pinned to a different provider client.`);
      }
      return run;
    });
  }
  async createOrRead(input: CreateAiFeatureRunInput): Promise<CreateAiFeatureRunResult> {
    const existing = await this.client.aiFeatureRun.findFirst({
      where: {
        workspaceId: input.workspaceId,
        featureId: input.feature.id,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        operationKind: input.operation.kind,
        operationId: input.operation.operationId,
      },
    });
    if (existing) return { kind: "existing", run: (await getRun(this.client, existing.id))! };

    try {
      await this.client.aiFeatureRun.create({
        data: {
          id: input.id,
          workspaceId: input.workspaceId,
          featureId: input.feature.id,
          featureVersion: input.feature.version,
          manifest: asJson(input.manifest),
          manifestHash: input.manifestHash,
          operationId: input.operation.operationId,
          operationKind: input.operation.kind,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          subjectRevision: input.subject.revision ?? null,
          status: PrismaAiFeatureRunStatus.Queued,
          objective: asJson(input.objective),
          input: asJson(input.input),
          inputHash: input.inputHash,
        },
      });
      return { kind: "created", run: (await getRun(this.client, input.id))! };
    } catch {
      const raced = await this.client.aiFeatureRun.findFirst({
        where: {
          workspaceId: input.workspaceId,
          featureId: input.feature.id,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          operationKind: input.operation.kind,
          operationId: input.operation.operationId,
        },
      });
      if (!raced) throw new Error("Unable to create AI feature run.");
      return { kind: "existing", run: (await getRun(this.client, raced.id))! };
    }
  }

  async update(input: UpdateAiFeatureRunInput): Promise<AiFeatureRunRecord | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const result = await tx.aiFeatureRun.updateMany({
        where: { id: input.runId, stateVersion: input.expectedStateVersion, ...(input.leaseOwner ? { leaseOwner: input.leaseOwner } : {}) },
        data: runUpdateData(input),
      });
      if (result.count !== 1) return null;
      if (input.observations !== undefined) {
        await tx.aiFeatureRunObservation.deleteMany({ where: { runId: input.runId } });
        if (input.observations.length) {
          await tx.aiFeatureRunObservation.createMany({
            data: input.observations.map((observation, sequence) => ({ runId: input.runId, ...observationData(observation, sequence, "Seed") })),
          });
        }
      }
      return getRun(tx, input.runId);
    });
  }

  async claim(input: ClaimAiFeatureRunInput): Promise<AiFeatureRunRecord | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const claimed = await tx.aiFeatureRun.updateMany({
        where: {
          id: input.runId,
          stateVersion: input.expectedStateVersion,
          OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: new Date(input.now) } }],
        },
        data: { leaseOwner: input.leaseOwner, leaseExpiresAt: new Date(input.leaseExpiresAt), heartbeatAt: new Date(input.now), stateVersion: { increment: 1 }, attempt: { increment: 1 } },
      });
      return claimed.count === 1 ? getRun(tx, input.runId) : null;
    });
  }

  async heartbeatLease(input: { runId: string; leaseOwner: string; leaseExpiresAt: string; now: string }): Promise<AiFeatureRunRecord | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const renewed = await tx.aiFeatureRun.updateMany({
        where: { id: input.runId, leaseOwner: input.leaseOwner, leaseExpiresAt: { gt: new Date(input.now) } },
        data: { leaseExpiresAt: new Date(input.leaseExpiresAt), heartbeatAt: new Date(input.now) },
      });
      return renewed.count === 1 ? getRun(tx, input.runId) : null;
    });
  }

  async releaseLease(input: ReleaseAiFeatureRunLeaseInput): Promise<AiFeatureRunRecord | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const released = await tx.aiFeatureRun.updateMany({
        where: { id: input.runId, stateVersion: input.expectedStateVersion, leaseOwner: input.leaseOwner },
        data: { leaseOwner: null, leaseExpiresAt: null, stateVersion: { increment: 1 } },
      });
      return released.count === 1 ? getRun(tx, input.runId) : null;
    });
  }

  async claimAction(input: ClaimAiFeatureRunActionInput): Promise<ClaimAiFeatureRunActionResult | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const run = await tx.aiFeatureRun.findFirst({ where: { id: input.runId, stateVersion: input.expectedRunStateVersion, leaseOwner: input.leaseOwner } });
      if (!run) return null;
      const existing = await tx.aiFeatureRunAction.findUnique({ where: { executionKey: input.executionKey }, include: { outputObservation: true } });
      if (existing) {
        if (existing.status !== "Executing" || !existing.leaseExpiresAt || existing.leaseExpiresAt > new Date(input.now)) return { kind: "existing", action: mapAction(existing) };
        const replayable = input.executionSemantics === "read_only" || input.executionSemantics === "domain_idempotent" || input.executionSemantics === "idempotent_external";
        if (!replayable || existing.attempt >= 2) {
          const marked = await tx.aiFeatureRunAction.updateMany({
            where: { id: existing.id, status: "Executing", leaseExpiresAt: { lte: new Date(input.now) } },
            data: { status: "Failed", leaseOwner: null, leaseExpiresAt: null, errorCode: "action_outcome_unknown", errorMessage: "Action lease expired after execution began; durable reconciliation is required.", finishedAt: new Date(input.now) },
          });
          if (marked.count === 1) {
            const action = await tx.aiFeatureRunAction.findUnique({ where: { id: existing.id }, include: { outputObservation: true } });
            return action ? { kind: "outcome_unknown", action: { ...mapAction(action), status: "outcome_unknown" } } : null;
          }
        } else {
          const reclaimed = await tx.aiFeatureRunAction.updateMany({
            where: { id: existing.id, status: "Executing", leaseExpiresAt: { lte: new Date(input.now) } },
            data: { leaseOwner: input.leaseOwner, leaseExpiresAt: new Date(input.leaseExpiresAt), attempt: { increment: 1 } },
          });
          if (reclaimed.count === 1) {
            const action = await tx.aiFeatureRunAction.findUnique({ where: { id: existing.id }, include: { outputObservation: true } });
            return action ? { kind: "claimed", action: mapAction(action) } : null;
          }
        }
        const raced = await tx.aiFeatureRunAction.findUnique({ where: { executionKey: input.executionKey }, include: { outputObservation: true } });
        return raced ? { kind: "existing", action: mapAction(raced) } : null;
      }
      if (input.maxCalls !== undefined) {
        const count = await tx.aiFeatureRunAction.count({ where: { runId: input.runId, actionId: input.action.id } });
        if (count >= input.maxCalls) return null;
      }
      const action = await tx.aiFeatureRunAction.create({
        data: {
          id: input.id,
          runId: input.runId,
          callId: input.callId,
          executionKey: input.executionKey,
          actionId: input.action.id,
          actionVersion: input.action.version,
          mode: "Invoke",
          status: "Executing",
          attempt: 1,
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          input: asJson(input.input),
          inputHash: input.inputHash,
        },
        include: { outputObservation: true },
      });
      return { kind: "claimed", action: mapAction(action) };
    });
  }

  async completeAction(input: { actionId: string; executionKey: string; expectedRunStateVersion: number; leaseOwner: string; outputObservation: AiObservationEnvelope }): Promise<{ action: AiFeatureRunActionRecord; run: AiFeatureRunRecord } | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const action = await tx.aiFeatureRunAction.findFirst({ where: { id: input.actionId, executionKey: input.executionKey, status: "Executing", leaseOwner: input.leaseOwner } });
      if (!action) return null;
      const run = await tx.aiFeatureRun.findFirst({ where: { id: action.runId, stateVersion: input.expectedRunStateVersion, leaseOwner: input.leaseOwner }, include: { observations: true } });
      if (!run) return null;
      const observation = await tx.aiFeatureRunObservation.create({
        data: { runId: run.id, ...observationData(input.outputObservation, run.observations.length, "ActionResult") },
      });
      const actionResult = await tx.aiFeatureRunAction.update({
        where: { id: action.id },
        data: { status: "Completed", outputObservationId: observation.observationId, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
        include: { outputObservation: true },
      });
      const advanced = await tx.aiFeatureRun.updateMany({
        where: { id: run.id, stateVersion: input.expectedRunStateVersion, leaseOwner: input.leaseOwner },
        data: { stateVersion: { increment: 1 } },
      });
      if (advanced.count !== 1) throw new Error("Feature run changed while recording action output.");
      return { action: mapAction(actionResult), run: (await getRun(tx, run.id))! };
    });
  }

  async failAction(input: { actionId: string; executionKey: string; leaseOwner: string; error: AiFeatureRuntimeError }): Promise<AiFeatureRunActionRecord | null> {
    return withSchedulerWorkOwnership(currentSchedulerWorkContext(), async (tx) => {
      const action = await tx.aiFeatureRunAction.updateMany({
        where: { id: input.actionId, executionKey: input.executionKey, status: "Executing", leaseOwner: input.leaseOwner },
        data: { status: "Failed", errorCode: input.error.code, errorMessage: input.error.message, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      if (action.count !== 1) return null;
      const record = await tx.aiFeatureRunAction.findUnique({ where: { id: input.actionId }, include: { outputObservation: true } });
      return record ? mapAction(record) : null;
    });
  }

  getById(runId: string): Promise<AiFeatureRunRecord | null> {
    return getRun(db, runId);
  }

  async listRecoverableRuns(before: string, queuedBefore: string, limit: number): Promise<AiFeatureRunRecord[]> {
    const records = await db.aiFeatureRun.findMany({
      where: {
        status: { in: [PrismaAiFeatureRunStatus.Queued, PrismaAiFeatureRunStatus.PreparingObservations, PrismaAiFeatureRunStatus.StartingProvider, PrismaAiFeatureRunStatus.Running, PrismaAiFeatureRunStatus.Validating, PrismaAiFeatureRunStatus.CommittingResult] },
        OR: [
          { leaseExpiresAt: { lte: new Date(before) } },
          { status: { not: PrismaAiFeatureRunStatus.Queued }, leaseExpiresAt: null },
          { status: PrismaAiFeatureRunStatus.Queued, leaseExpiresAt: null, createdAt: { lte: new Date(queuedBefore) } },
        ],
      },
      orderBy: [{ leaseExpiresAt: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: { id: true },
    });
    return (await Promise.all(records.map(({ id }) => getRun(db, id)))).filter((run): run is AiFeatureRunRecord => run !== null);
  }


  async readPublic(input: ReadAiFeatureRunPublicInput): Promise<AiFeatureRunPublicRead | null> {
    const run = await db.aiFeatureRun.findFirst({
      where: {
        id: input.runId,
        workspaceId: input.workspaceId,
        featureId: input.feature.id,
        featureVersion: input.feature.version,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        ...(input.subject.revision ? { subjectRevision: input.subject.revision } : {}),
      },
      select: { status: true, stateVersion: true, attempt: true, errorCode: true, startedAt: true, finishedAt: true, createdAt: true, updatedAt: true },
    });
    if (!run) return null;
    return {
      status: statusFromDb[run.status],
      stateVersion: run.stateVersion,
      attempt: run.attempt,
      ...(run.errorCode ? { error: { code: run.errorCode as AiFeatureRuntimeError["code"], messageKey: `ai_feature_runtime.${run.errorCode}` } } : {}),
      ...(iso(run.startedAt) ? { startedAt: iso(run.startedAt)! } : {}),
      ...(iso(run.finishedAt) ? { finishedAt: iso(run.finishedAt)! } : {}),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}
