/* eslint-disable max-lines-per-function, complexity -- Provider attachment keeps exact attempt, Run, and session checks in one transaction. */
import { Prisma, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { NodeAttempt } from "@chrona/contracts/ai";
import type { AgentProviderClient, ProviderRunRef } from "@chrona/providers-foundation";
import { withPlanExecutionDurability } from "./persistence/scheduler-durability";
import {
  assertRuntimeExecutionScope,
  type RuntimeExecutionScope,
  type RuntimeScopeAssertionOptions,
} from "./persistence/runtime-execution-scope";
import { ACTIVE_RUN_STATUSES } from "./persistence/task-execution-store";

const MODEL_PIN_SOURCE_AUTOMATIC = "automatic";
const MODEL_PIN_SOURCE_USER = "user";

export async function resolveTaskModel(input: {
  taskId: string;
  executionConfig: Record<string, unknown>;
  pinnedModel: string | null;
  pinnedModelSource: string | null;
  providerClient: AgentProviderClient;
}): Promise<string | undefined> {
  const configuredModel = nonEmptyString(input.executionConfig.model);
  if (configuredModel) return persistConfiguredModel(input, configuredModel);

  const pinnedModel = nonEmptyString(input.pinnedModel);
  if (pinnedModel && input.pinnedModelSource !== MODEL_PIN_SOURCE_USER) return pinnedModel;
  if (pinnedModel) await clearUserPinnedModel(input.taskId);
  return resolveAutomaticTaskModel(input);
}

async function persistConfiguredModel(
  input: Parameters<typeof resolveTaskModel>[0],
  configuredModel: string,
): Promise<string> {
  if (input.pinnedModel === configuredModel && input.pinnedModelSource === MODEL_PIN_SOURCE_USER) return configuredModel;
  await withPlanExecutionDurability((tx) => tx.task.update({
    where: { id: input.taskId },
    data: { pinnedModel: configuredModel, pinnedModelSource: MODEL_PIN_SOURCE_USER },
  }));
  return configuredModel;
}

async function clearUserPinnedModel(taskId: string): Promise<void> {
  await withPlanExecutionDurability((tx) => tx.task.update({
    where: { id: taskId },
    data: { pinnedModel: null, pinnedModelSource: null },
  }));
}

async function resolveAutomaticTaskModel(input: Parameters<typeof resolveTaskModel>[0]): Promise<string | undefined> {
  if (!supportsAutomaticTaskModel(input.providerClient)) return undefined;
  const effectiveModel = await requireEffectiveModel(input.providerClient);
  const claimed = await withPlanExecutionDurability((tx) => tx.task.updateMany({
    where: { id: input.taskId, pinnedModel: null },
    data: { pinnedModel: effectiveModel, pinnedModelSource: MODEL_PIN_SOURCE_AUTOMATIC },
  }));
  return claimed.count === 1 ? effectiveModel : resolveConcurrentTaskModel(input.taskId, effectiveModel);
}

function supportsAutomaticTaskModel(providerClient: AgentProviderClient): boolean {
  const model = providerClient.getConfigurationCapabilities?.().model;
  return Boolean(model?.supported && model.taskOverride);
}

async function requireEffectiveModel(providerClient: AgentProviderClient): Promise<string> {
  if (!providerClient.getRuntimeDiagnostics) {
    throw new Error(`Runtime '${providerClient.provider}' cannot resolve an effective model for task pinning`);
  }
  const effectiveModel = nonEmptyString((await providerClient.getRuntimeDiagnostics()).model);
  if (!effectiveModel) {
    throw new Error(`Runtime '${providerClient.provider}' did not resolve an effective model for task pinning`);
  }
  return effectiveModel;
}

async function resolveConcurrentTaskModel(taskId: string, effectiveModel: string): Promise<string> {
  const concurrent = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionConfig: true, pinnedModel: true },
  });
  return nonEmptyString((concurrent.executionConfig as Record<string, unknown>).model)
    ?? nonEmptyString(concurrent.pinnedModel)
    ?? effectiveModel;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}


export type EnsuredProviderRunRecord = {
  id: string;
  runId: string;
  planRunId: string;
  executionScope: string;
  nodeAttemptId: string;
  identity: "created" | "existing";
  providerRunRef?: string;
  nativeRunId?: string;
  runtimeRunRef?: string;
  runtimeSessionRef?: string;
  providerSessionRef?: string;
};

export async function ensureProviderRunRecord(input: {
  workspaceId: string;
  taskId: string;
  expectedExecutionEpoch: number;
  expectedExecutionSessionId: string;
  workBlockId?: string | null;
  occurrenceId?: string | null;
  runId: string;
  nodeAttempt: NodeAttempt;
  providerRunIdempotencyKey: string;
  aiClientId: string;
  aiClientConfigDigest: string;
  providerName: string;
}): Promise<EnsuredProviderRunRecord> {
  return withPlanExecutionDurability(async (tx) => {
    const planRun = await tx.taskPlanRun.findFirst({
      where: {
        taskId: input.taskId,
        planId: input.nodeAttempt.graphId,
        workBlockId: input.workBlockId ?? null,
        occurrenceId: input.occurrenceId ?? null,
        executionEpoch: input.expectedExecutionEpoch,
      },
      select: { id: true, executionEpoch: true, executionScopeId: true },
    });
    if (!planRun) throw new Error(`Plan run missing for task ${input.taskId} and plan ${input.nodeAttempt.graphId}`);
    const activeExecutionSession = await tx.executionSession.findFirst({
      where: {
        id: input.expectedExecutionSessionId,
        taskId: input.taskId,
        planId: input.nodeAttempt.graphId,
        workBlockId: input.workBlockId ?? null,
        status: "Active",
      },
      select: { id: true, currentNodeAttemptId: true },
    });
    if (!activeExecutionSession) {
      throw new Error("Execution session changed before provider run attachment");
    }
    const planClaim = await tx.taskPlanRun.updateMany({
      where: { id: planRun.id, executionEpoch: input.expectedExecutionEpoch },
      data: { executionEpoch: input.expectedExecutionEpoch },
    });
    const nodeAttempt = await upsertNodeAttempt(input, planRun, tx);
    const sessionClaim = await tx.executionSession.updateMany({
      where: { id: activeExecutionSession.id, currentNodeAttemptId: nodeAttempt.id, status: "Active" },
      data: { status: "Active" },
    });
    if (planClaim.count !== 1 || sessionClaim.count !== 1) {
      throw new Error("Execution scope changed before provider run attachment");
    }
    const existingProviderRun = await tx.taskPlanProviderRun.findUnique({
      where: { idempotencyKey: input.providerRunIdempotencyKey },
      select: {
        id: true,
        aiClientId: true,
        aiClientConfigDigest: true,
        providerName: true,
        runId: true,
        taskId: true,
        planId: true,
        planRunId: true,
        nodeAttemptId: true,
        status: true,
        providerRunRef: true,
        nativeRunId: true,
      },
    });
    if (existingProviderRun) {
      if (
        existingProviderRun.taskId !== input.taskId
        || existingProviderRun.aiClientId !== input.aiClientId
        || existingProviderRun.aiClientConfigDigest !== input.aiClientConfigDigest
        || existingProviderRun.providerName !== input.providerName
        || existingProviderRun.runId !== input.runId
        || existingProviderRun.planId !== input.nodeAttempt.graphId
        || existingProviderRun.planRunId !== planRun.id
        || existingProviderRun.nodeAttemptId !== nodeAttempt.id
      ) {
        throw new Error("Provider run idempotency key belongs to another execution scope");
      }
      if (
        nodeAttempt.executionEpoch > planRun.executionEpoch
        || nodeAttempt.status !== "running"
        || !["running", "waiting_for_approval"].includes(existingProviderRun.status)
      ) {
        throw new Error("Provider run attachment belongs to an inactive execution attempt");
      }
      const exactRunId = existingProviderRun.runId;
      if (!exactRunId) {
        throw new Error("Provider run attachment is missing its canonical Run identity");
      }
      const activeRuntimeRunRef = existingProviderRun.providerRunRef ?? existingProviderRun.nativeRunId;
      const [activeRun, replayRun] = await Promise.all([
        activeRuntimeRunRef ? tx.run.findFirst({ where: { taskId: input.taskId, runtimeRunRef: activeRuntimeRunRef }, select: { runtimeRunRef: true, runtimeSessionRef: true, taskSession: { select: { providerSessionRef: true } } } }) : null,
        input.runId ? tx.run.findUnique({ where: { id: input.runId }, select: { runtimeRunRef: true, runtimeSessionRef: true, taskSession: { select: { providerSessionRef: true } } } }) : null,
      ]);
      return {
        id: existingProviderRun.id,
        runId: exactRunId,
        planRunId: existingProviderRun.planRunId,
        nodeAttemptId: existingProviderRun.nodeAttemptId,
        identity: "existing",
        providerRunRef: nonEmptyString(existingProviderRun.providerRunRef),
        nativeRunId: nonEmptyString(existingProviderRun.nativeRunId),
        runtimeRunRef: nonEmptyString(activeRun?.runtimeRunRef) ?? nonEmptyString(replayRun?.runtimeRunRef),
        executionScope: planRun.executionScopeId,
        runtimeSessionRef: nonEmptyString(activeRun?.runtimeSessionRef) ?? nonEmptyString(replayRun?.runtimeSessionRef),
        providerSessionRef: nonEmptyString(activeRun?.taskSession?.providerSessionRef) ?? nonEmptyString(replayRun?.taskSession?.providerSessionRef),
      };
    }
    if (nodeAttempt.executionEpoch > planRun.executionEpoch || nodeAttempt.status !== "running") {
      throw new Error("Provider run cannot start from an inactive or earlier-epoch node attempt");
    }
    const created = await tx.taskPlanProviderRun.create({
      data: {
        runId: input.runId,
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        planId: input.nodeAttempt.graphId,
        planRunId: planRun.id,
        nodeAttemptId: nodeAttempt.id,
        aiClientId: input.aiClientId,
        aiClientConfigDigest: input.aiClientConfigDigest,
        providerName: input.providerName,
        runtimeName: input.providerName,
        idempotencyKey: input.providerRunIdempotencyKey,
        status: "running",
      },
      select: { id: true, runId: true, planRunId: true, nodeAttemptId: true },
    });
    return { ...created, runId: input.runId, executionScope: planRun.executionScopeId, identity: "created" };
  });
}

async function upsertNodeAttempt(
  input: Parameters<typeof ensureProviderRunRecord>[0] & { nodeAttempt: NodeAttempt },
  planRun: { id: string; executionEpoch: number },
  tx: Prisma.TransactionClient,
) {
  const attempt = input.nodeAttempt;
  const existing = await tx.taskPlanNodeAttempt.findUnique({
    where: { idempotencyKey: attempt.idempotencyKey },
    select: {
      id: true,
      taskId: true,
      planId: true,
      planRunId: true,
      nodeId: true,
      nodeLayerId: true,
      executionContextSnapshotId: true,
      attemptNumber: true,
      executionEpoch: true,
      status: true,
      startedAt: true,
    },
  });
  if (existing) {
    if (
      existing.id !== attempt.id
      || existing.taskId !== input.taskId
      || existing.planId !== attempt.graphId
      || existing.planRunId !== planRun.id
      || existing.nodeId !== attempt.nodeId
      || existing.nodeLayerId !== attempt.nodeLayerId
      || existing.executionContextSnapshotId !== attempt.executionContextSnapshotId
      || existing.attemptNumber !== attempt.attemptNumber
      || existing.startedAt.getTime() !== new Date(attempt.startedAt).getTime()
      || existing.executionEpoch > planRun.executionEpoch
    ) {
      throw new Error("Node attempt idempotency key belongs to another execution scope");
    }
    if (existing.executionEpoch < planRun.executionEpoch || existing.status !== "running") {
      return { id: existing.id, executionEpoch: existing.executionEpoch, status: existing.status };
    }
    return tx.taskPlanNodeAttempt.update({
      where: { id: existing.id },
      data: nodeAttemptUpdate(attempt),
      select: { id: true, executionEpoch: true, status: true },
    });
  }
  throw new Error("Provider run requires a persisted active node attempt");
}

function nodeAttemptUpdate(attempt: NodeAttempt) {
  return {
    status: attempt.status,
    runtimeSnapshot: toJsonInput(attempt.runtimeSnapshot),
    finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    error: toJsonInput(attempt.error),
  };
}


export function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function updateProviderRunRecord(
  providerRunRecordId: string | undefined,
  data: {
    providerRunRef?: string | null;
    runtimeName?: string | null;
    nativeRunId?: string | null;
    firstRawEventId?: string | null;
    lastRawEventId?: string | null;
    completedByEventId?: string | null;
    failedByEventId?: string | null;
    correlationId?: string | null;
    status: string;
    finishedAt?: Date | null;
  },
  scope?: RuntimeExecutionScope,
  scopeOptions?: RuntimeScopeAssertionOptions,
) {
  if (!providerRunRecordId) return;
  if (!scope) throw new Error("Provider run update requires durable execution scope");
  const terminalStatuses = ["completed", "failed", "cancelled"];
  await withPlanExecutionDurability(async (tx) => {
    await assertRuntimeExecutionScope(tx, scope, scopeOptions);
    await tx.taskPlanProviderRun.updateMany({
      where: {
        id: providerRunRecordId,
        status: { notIn: terminalStatuses },
      },
      data,
    });
  });
}

export async function persistRuntimeRunRef(
  runId: string | undefined,
  run: ProviderRunRef,
  scope?: RuntimeExecutionScope,
) {
  if (!runId) return;
  const runtimeSessionRef = requireRuntimeSessionId(run.sessionId, "provider run ref");
  const runtimeRunRef = await uniqueRuntimeRunRef(runId, run.nativeRunId ?? run.runId);
  const updated = await withPlanExecutionDurability(async (tx) => {
    if (scope) await assertRuntimeExecutionScope(tx, scope);
    return tx.run.updateMany({
      where: { id: runId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      data: { runtimeRunRef, runtimeSessionRef, status: RunStatus.Running, syncStatus: "healthy" },
    });
  });
  if (updated.count !== 1) throw new Error("Provider run started after the durable run became inactive.");
}

export async function uniqueRuntimeRunRef(runId: string, providerRunRef: string | null) {
  if (!providerRunRef) return null;
  const existing = await db.run.findUnique({ where: { runtimeRunRef: providerRunRef }, select: { id: true } });
  return !existing || existing.id === runId ? providerRunRef : `${providerRunRef}:${runId}`;
}

export async function readTaskSessionProviderRef(taskSessionId: string | undefined): Promise<string | undefined> {
  if (!taskSessionId) return undefined;
  const session = await db.taskSession.findUnique({ where: { id: taskSessionId }, select: { providerSessionRef: true } });
  return session?.providerSessionRef?.trim() || undefined;
}

export async function persistTaskSessionProviderRef(
  taskSessionId: string | undefined,
  providerSessionRef: string,
  scope?: RuntimeExecutionScope,
  scopeOptions?: RuntimeScopeAssertionOptions,
): Promise<void> {
  if (!taskSessionId) return;
  await withPlanExecutionDurability(async (tx) => {
    if (scope) await assertRuntimeExecutionScope(tx, scope, scopeOptions);
    await tx.taskSession.update({ where: { id: taskSessionId }, data: { providerSessionRef } });
  });
}
export function requireRuntimeSessionId(value: string | undefined, source: string) {
  const sessionId = value?.trim();
  if (!sessionId || sessionId === "unknown") throw new Error(`Runtime ${source} missing sessionId`);
  return sessionId;
}
