import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type EventContext = {
  workspaceId: string;
  taskId?: string | null;
  workBlockId?: string | null;
  occurrenceId?: string | null;
  runId?: string | null;
  taskSessionId?: string | null;
  executionSessionId?: string | null;
  planId?: string | null;
  planRunId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  nodeId?: string | null;
  nodeTitle?: string | null;
  correlationId?: string | null;
};

export type AppendRawEventLogInput = EventContext & {
  source: string;
  direction: string;
  rawType: string;
  provider?: string | null;
  runtimeName?: string | null;
  rawPayload?: unknown;
  rawText?: string | null;
  metadata?: Record<string, unknown> | null;
  nativeRunId?: string | null;
  nativeEventId?: string | null;
  nativeToolCallId?: string | null;
  externalRef?: string | null;
  sequence?: number | null;
  parentRawEventId?: string | null;
  causationRawEventId?: string | null;
  occurredAt?: Date | null;
};

export type AppendCanonicalEventInput = EventContext & {
  eventType: string;
  eventVersion?: number;
  rawEventId?: string | null;
  parentEventId?: string | null;
  causationEventId?: string | null;
  actorType: string;
  actorId?: string | null;
  source: string;
  payload: Record<string, unknown>;
  summary?: string | null;
  severity?: string | null;
  dedupeKey?: string | null;
  occurredAt?: Date | null;
};

export type AppendTaskTimelineItemInput = EventContext & {
  taskId: string;
  kind: string;
  title: string;
  body?: string | null;
  severity?: string | null;
  status?: string | null;
  eventId?: string | null;
  rawEventId?: string | null;
  toolInvocationId?: string | null;
  sortTime?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export async function appendRawEventLog(input: AppendRawEventLogInput, client: Prisma.TransactionClient = db) {
  const payloadHash = hashEventPayload({
    rawPayload: input.rawPayload ?? null,
    rawText: input.rawText ?? null,
    metadata: input.metadata ?? null,
  });
  const contextRefs = await resolveRawEventContextRefs(input, client);
  const createData = {
    workspaceId: input.workspaceId,
    taskId: contextRefs.taskId,
    workBlockId: input.workBlockId ?? null,
    occurrenceId: input.occurrenceId ?? null,
    runId: contextRefs.runId,
    taskSessionId: input.taskSessionId ?? null,
    executionSessionId: input.executionSessionId ?? null,
    planId: input.planId ?? null,
    planRunId: input.planRunId ?? null,
    nodeAttemptId: input.nodeAttemptId ?? null,
    providerRunId: input.providerRunId ?? null,
    nodeId: input.nodeId ?? null,
    nodeTitle: input.nodeTitle ?? null,
    source: input.source,
    direction: input.direction,
    rawType: input.rawType,
    provider: input.provider ?? null,
    runtimeName: input.runtimeName ?? null,
    rawPayload: toJsonInput(input.rawPayload),
    rawText: input.rawText ?? null,
    metadata: toJsonInput(input.metadata),
    nativeRunId: input.nativeRunId ?? null,
    nativeEventId: input.nativeEventId ?? null,
    nativeToolCallId: input.nativeToolCallId ?? null,
    externalRef: input.externalRef ?? null,
    sequence: input.sequence ?? null,
    correlationId: input.correlationId ?? null,
    parentRawEventId: input.parentRawEventId ?? null,
    causationRawEventId: input.causationRawEventId ?? null,
    payloadHash,
    occurredAt: input.occurredAt ?? null,
  };

  if (input.externalRef) {
    return client.rawEventLog.upsert({
      where: { source_externalRef: { source: input.source, externalRef: input.externalRef } },
      update: {},
      create: createData,
    });
  }

  return client.rawEventLog.create({ data: createData });
}

async function resolveRawEventContextRefs(input: AppendRawEventLogInput, client: Prisma.TransactionClient) {
  const [task, run] = await Promise.all([
    input.taskId
      ? client.task.findUnique({ where: { id: input.taskId }, select: { id: true } })
      : Promise.resolve(null),
    input.runId
      ? client.run.findUnique({ where: { id: input.runId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return {
    taskId: task?.id ?? null,
    runId: run?.id ?? null,
  };
}

export async function appendCanonicalEvent(input: AppendCanonicalEventInput, client?: Prisma.TransactionClient) {
  if (client) return appendCanonicalEventInTransaction(input, client);
  return db.$transaction((tx) => appendCanonicalEventInTransaction(input, tx));
}

async function appendCanonicalEventInTransaction(input: AppendCanonicalEventInput, client: Prisma.TransactionClient) {
  if (input.dedupeKey) {
    const existing = await client.event.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return existing;
  }

  const [sequence, contextRefs] = await Promise.all([
    client.eventIngestSequence.upsert({
      where: { id: "global" },
      update: { value: { increment: 1 } },
      create: { id: "global", value: 1 },
      select: { value: true },
    }),
    resolveCanonicalEventContextRefs(input, client),
  ]);
  const createData = {
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? 1,
    workspaceId: input.workspaceId,
    taskId: contextRefs.taskId,
    workBlockId: contextRefs.workBlockId,
    occurrenceId: input.occurrenceId ?? null,
    runId: contextRefs.runId,
    taskSessionId: input.taskSessionId ?? null,
    executionSessionId: input.executionSessionId ?? null,
    planId: input.planId ?? null,
    planRunId: input.planRunId ?? null,
    nodeAttemptId: input.nodeAttemptId ?? null,
    providerRunId: input.providerRunId ?? null,
    nodeId: input.nodeId ?? null,
    nodeTitle: input.nodeTitle ?? null,
    rawEventId: contextRefs.rawEventId,
    parentEventId: input.parentEventId ?? null,
    causationEventId: input.causationEventId ?? null,
    correlationId: input.correlationId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    source: input.source,
    payload: toJsonInput(input.payload) ?? Prisma.JsonNull,
    summary: input.summary ?? null,
    severity: input.severity ?? null,
    dedupeKey: input.dedupeKey ?? null,
    occurredAt: input.occurredAt ?? null,
    ingestSequence: sequence.value,
  };

  if (!input.dedupeKey) return client.event.create({ data: createData });
  return client.event.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: createData,
  });
}

async function resolveCanonicalEventContextRefs(input: AppendCanonicalEventInput, client: Prisma.TransactionClient) {
  const [task, workBlock, run, rawEvent] = await Promise.all([
    input.taskId
      ? client.task.findUnique({ where: { id: input.taskId }, select: { id: true } })
      : Promise.resolve(null),
    input.workBlockId
      ? client.workBlock.findUnique({ where: { id: input.workBlockId }, select: { id: true } })
      : Promise.resolve(null),
    input.runId
      ? client.run.findUnique({ where: { id: input.runId }, select: { id: true } })
      : Promise.resolve(null),
    input.rawEventId
      ? client.rawEventLog.findUnique({ where: { id: input.rawEventId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return {
    taskId: task?.id ?? null,
    workBlockId: workBlock?.id ?? null,
    runId: run?.id ?? null,
    rawEventId: rawEvent?.id ?? null,
  };
}

export async function appendTaskTimelineItem(
  input: AppendTaskTimelineItemInput,
  client: Prisma.TransactionClient = db,
) {
  return client.taskTimelineItem.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      runId: input.runId ?? null,
      executionSessionId: input.executionSessionId ?? null,
      nodeId: input.nodeId ?? null,
      nodeAttemptId: input.nodeAttemptId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? null,
      status: input.status ?? null,
      eventId: input.eventId ?? null,
      rawEventId: input.rawEventId ?? null,
      toolInvocationId: input.toolInvocationId ?? null,
      sortTime: input.sortTime ?? new Date(),
      metadata: toJsonInput(input.metadata),
    },
  });
}

export function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hashEventPayload(value: unknown) {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
