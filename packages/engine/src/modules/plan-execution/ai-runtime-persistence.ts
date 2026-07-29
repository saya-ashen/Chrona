import { Prisma, RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { NodeAttempt } from "@chrona/contracts/ai";
import type { AgentProviderClient, ProviderRunRef } from "@chrona/providers-foundation";

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
  await db.task.update({
    where: { id: input.taskId },
    data: { pinnedModel: configuredModel, pinnedModelSource: MODEL_PIN_SOURCE_USER },
  });
  return configuredModel;
}

async function clearUserPinnedModel(taskId: string): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { pinnedModel: null, pinnedModelSource: null },
  });
}

async function resolveAutomaticTaskModel(input: Parameters<typeof resolveTaskModel>[0]): Promise<string | undefined> {
  if (!supportsAutomaticTaskModel(input.providerClient)) return undefined;
  const effectiveModel = await requireEffectiveModel(input.providerClient);
  const claimed = await db.task.updateMany({
    where: { id: input.taskId, pinnedModel: null },
    data: { pinnedModel: effectiveModel, pinnedModelSource: MODEL_PIN_SOURCE_AUTOMATIC },
  });
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

export async function ensureProviderRunRecord(input: {
  workspaceId: string;
  taskId: string;
  nodeAttempt?: NodeAttempt;
  nodeAttemptId?: string;
  providerRunIdempotencyKey?: string;
}) {
  if (!input.nodeAttempt || !input.providerRunIdempotencyKey) return null;
  const planRun = await db.taskPlanRun.findFirst({
    where: { taskId: input.taskId, planId: input.nodeAttempt.graphId },
    select: { id: true, executionEpoch: true },
  });
  if (!planRun) throw new Error(`Plan run missing for task ${input.taskId} and plan ${input.nodeAttempt.graphId}`);
  const nodeAttempt = await upsertNodeAttempt({ ...input, nodeAttempt: input.nodeAttempt }, planRun);
  return db.taskPlanProviderRun.upsert({
    where: { idempotencyKey: input.providerRunIdempotencyKey },
    update: { status: "running" },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.nodeAttempt.graphId,
      planRunId: planRun.id,
      nodeAttemptId: nodeAttempt.id,
      idempotencyKey: input.providerRunIdempotencyKey,
      status: "running",
    },
    select: { id: true, planRunId: true, nodeAttemptId: true },
  });
}

async function upsertNodeAttempt(
  input: Parameters<typeof ensureProviderRunRecord>[0] & { nodeAttempt: NodeAttempt },
  planRun: { id: string; executionEpoch: number },
) {
  const attempt = input.nodeAttempt;
  return db.taskPlanNodeAttempt.upsert({
    where: { idempotencyKey: attempt.idempotencyKey },
    update: nodeAttemptUpdate(attempt),
    create: nodeAttemptCreate(input, planRun),
    select: { id: true },
  });
}

function nodeAttemptUpdate(attempt: NodeAttempt) {
  return {
    status: attempt.status,
    runtimeSnapshot: toJsonInput(attempt.runtimeSnapshot),
    finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    error: toJsonInput(attempt.error),
  };
}

function nodeAttemptCreate(
  input: Parameters<typeof ensureProviderRunRecord>[0] & { nodeAttempt: NodeAttempt },
  planRun: { id: string; executionEpoch: number },
) {
  const attempt = input.nodeAttempt;
  return {
    id: attempt.id,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId: attempt.graphId,
    planRunId: planRun.id,
    nodeId: attempt.nodeId,
    nodeLayerId: attempt.nodeLayerId,
    executionContextSnapshotId: attempt.executionContextSnapshotId,
    idempotencyKey: attempt.idempotencyKey,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    executionEpoch: planRun.executionEpoch,
    startedAt: new Date(attempt.startedAt),
    finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    error: toJsonInput(attempt.error),
    runtimeSnapshot: toJsonInput(attempt.runtimeSnapshot),
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
) {
  if (!providerRunRecordId) return;
  await db.taskPlanProviderRun.update({ where: { id: providerRunRecordId }, data });
}

export async function persistRuntimeRunRef(runId: string | undefined, run: ProviderRunRef) {
  if (!runId) return;
  const runtimeSessionRef = requireRuntimeSessionId(run.sessionId, "provider run ref");
  const runtimeRunRef = await uniqueRuntimeRunRef(runId, run.nativeRunId ?? run.runId);
  await db.run.update({
    where: { id: runId },
    data: { runtimeRunRef, runtimeSessionRef, status: RunStatus.Running, syncStatus: "healthy" },
  });
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

export async function persistTaskSessionProviderRef(taskSessionId: string | undefined, providerSessionRef: string): Promise<void> {
  if (!taskSessionId) return;
  await db.taskSession.update({ where: { id: taskSessionId }, data: { providerSessionRef } });
}

export function requireRuntimeSessionId(value: string | undefined, source: string) {
  const sessionId = value?.trim();
  if (!sessionId || sessionId === "unknown") throw new Error(`Runtime ${source} missing sessionId`);
  return sessionId;
}
