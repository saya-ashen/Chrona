/* eslint-disable complexity, max-params, @typescript-eslint/no-unnecessary-condition -- Event persistence validates hostile provider payloads and exact scope fields. */
import { Prisma } from "@/generated/prisma/client";
import { appendCanonicalEvent, appendRawEventLog } from "@/modules/events";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import { toJsonInput } from "./ai-runtime-persistence";
import { withPlanExecutionDurability } from "./persistence/scheduler-durability";
import { assertRuntimeExecutionScope, type RuntimeExecutionScope } from "./persistence/runtime-execution-scope";

export type RuntimeEventPersistenceContext = RuntimeExecutionScope;

let afterRawEventPersistedForTest: (() => void | Promise<void>) | undefined;

export function setAfterRawEventPersistedForTest(hook?: () => void | Promise<void>) {
  afterRawEventPersistedForTest = hook;
}

export async function persistProviderRuntimeEvent(input: {
  context?: RuntimeEventPersistenceContext;
  event: ProviderRunEvent;
  fallbackIndex: number;
}) {
  if (!input.context) return;
  await persistRuntimeEvent(input.context, input.event, input.fallbackIndex);
}

async function persistRuntimeEvent(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, fallbackIndex: number): Promise<void> {
  const occurredAt = eventTime(event.timestamp);
  const sequence = event.sequence ?? fallbackIndex;
  await withPlanExecutionDurability(async (tx) => {
    await assertRuntimeExecutionScope(tx, context);
    const rawEvent = await appendRawEventLog(rawEventInput(context, event, sequence, occurredAt), tx);
    await afterRawEventPersistedForTest?.();
    const canonicalEvent = await appendCanonicalEvent(canonicalEventInput(context, event, rawEvent.id, sequence, occurredAt), tx);
    await updateLatestEventPointers(tx, context, canonicalEvent.id, rawEvent.id, canonicalEvent.ingestSequence);
    await updateProviderRunAuditRefs(tx, auditReferenceInput(context, event, rawEvent.id, canonicalEvent.id));
    await persistOrReconcileApproval(tx, context, event, rawEvent.id, canonicalEvent.id, occurredAt);
  });
}


function eventTime(timestamp: unknown): Date {
  const value = typeof timestamp === "string" ? new Date(timestamp) : new Date();
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function rawEventInput(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, sequence: number, occurredAt: Date) {
  return {
    ...eventOwnership(context),
    ...eventTransport(context, event, sequence, occurredAt),
  };
}

function eventOwnership(context: RuntimeEventPersistenceContext) {
  return {
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    workBlockId: context.workBlockId,
    occurrenceId: context.occurrenceId,
    runId: context.runId,
    taskSessionId: context.taskSessionId,
    executionSessionId: context.executionSessionId,
    planId: context.planId,
    planRunId: context.planRunId,
    nodeAttemptId: context.nodeAttemptId,
    providerRunId: context.providerRunId,
    nodeId: context.nodeContext?.nodeId ?? null,
    nodeTitle: context.nodeContext?.nodeTitle ?? null,
  };
}

function eventTransport(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, sequence: number, occurredAt: Date) {
  return {
    source: "provider" as const,
    direction: "inbound" as const,
    rawType: event.rawEventType ?? event.type,
    provider: event.provider,
    runtimeName: context.runtimeName,
    rawPayload: rawPayloadForProviderEvent(event),
    metadata: hasRawProviderPayload(event) ? { normalizedEvent: event } : null,
    nativeRunId: event.nativeRunId ?? event.runId,
    externalRef: eventReference(context, event, sequence),
    sequence,
    correlationId: context.providerRunId ?? context.runId,
    occurredAt,
  };
}

function canonicalEventInput(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, sequence: number, occurredAt: Date) {
  return {
    eventType: `provider.${event.type}`,
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    workBlockId: context.workBlockId,
    occurrenceId: context.occurrenceId,
    runId: context.runId,
    taskSessionId: context.taskSessionId,
    planId: context.planId,
    executionSessionId: context.executionSessionId,
    planRunId: context.planRunId,
    nodeAttemptId: context.nodeAttemptId,
    providerRunId: context.providerRunId,
    nodeId: context.nodeContext?.nodeId ?? null,
    nodeTitle: context.nodeContext?.nodeTitle ?? null,
    rawEventId,
    correlationId: context.providerRunId,
    actorType: "runtime" as const,
    actorId: context.runtimeName,
    source: "provider" as const,
    payload: {
      executionScope: context.executionScope,
      providerLabel: "AI provider",
      runtimeLabel: "Execution runtime",
      runtimeName: context.runtimeName,
      provider: event.provider,
      runId: event.runId,
      nativeRunId: event.nativeRunId,
      sequence,
      rawEventType: event.rawEventType,
      event: {
        ...event,
        ...(["tool_call", "tool_progress", "tool_started", "tool_completed"].includes(event.type)
          ? { toolLabel: "Runtime tool" }
          : {}),
      },
    },
    summary: summaryForProviderEvent(event),
    dedupeKey: eventReference(context, event, sequence),
    occurredAt,
  };
}

function eventReference(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, sequence: number): string {
  return `provider.runtime:${context.providerRunId}:${sequence}:${event.type}:${event.rawEventType ?? "event"}`;
}

async function updateLatestEventPointers(tx: Prisma.TransactionClient, context: RuntimeEventPersistenceContext, eventId: string, rawEventId: string, ingestSequence: number): Promise<void> {
  const newer = { lt: ingestSequence };
  const staleOrEmpty = { OR: [{ latestEventSequence: null }, { latestEventSequence: newer }] };
  await tx.task.updateMany({
    where: { id: context.taskId, ...staleOrEmpty },
    data: { latestEventId: eventId, latestRawEventId: rawEventId, latestEventSequence: ingestSequence },
  });
  await tx.taskPlanRun.updateMany({
    where: { id: context.planRunId, ...staleOrEmpty },
    data: { latestEventId: eventId, latestRawEventId: rawEventId, latestEventSequence: ingestSequence },
  });
  if (context.workBlockId) {
    await tx.workBlock.updateMany({
      where: { id: context.workBlockId, ...staleOrEmpty },
      data: { latestEventId: eventId, latestRawEventId: rawEventId, latestEventSequence: ingestSequence },
    });
  }
}

function auditReferenceInput(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, eventId: string) {
  return {
    providerRunRecordId: context.providerRunId, rawEventId, eventId, eventType: event.type,
    nativeRunId: event.nativeRunId ?? event.runId ?? null, runtimeName: context.runtimeName,
    correlationId: context.providerRunId ?? context.runId,
  };
}

async function persistOrReconcileApproval(tx: Prisma.TransactionClient, context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, eventId: string, observedAt: Date): Promise<void> {
  if (event.type === "approval_required") return persistProviderApproval(tx, { context, providerRunId: context.providerRunId, rawEventId, eventId, event, requestedAt: observedAt });
  return reconcilePendingProviderApprovals(tx, {
    providerRunId: context.providerRunId,
    workBlockId: context.workBlockId,
    planRunId: context.planRunId,
    event,
    observedAt,
  });
}


const HERMES_DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

async function reconcilePendingProviderApprovals(tx: Prisma.TransactionClient, input: {
  providerRunId?: string | null;
  workBlockId?: string | null;
  planRunId?: string | null;
  event: ProviderRunEvent;
  observedAt: Date;
}) {
  if (!input.providerRunId || !input.planRunId) return;
  const pendingApprovals = await tx.taskPlanProviderApproval.findMany({
    where: {
      providerRunId: input.providerRunId,
      workBlockId: input.workBlockId ?? null,
      planRunId: input.planRunId,
      status: "pending",
    },
    select: { id: true, requestedAt: true },
  });
  const isTerminalEvent = ["run_completed", "run_failed", "run_cancelled"].includes(input.event.type);
  const expiredApprovalIds = pendingApprovals
    .filter((approval) => isTerminalEvent || input.observedAt.getTime() - approval.requestedAt.getTime() >= HERMES_DEFAULT_APPROVAL_TIMEOUT_MS)
    .map((approval) => approval.id);
  if (expiredApprovalIds.length === 0) return;
  await tx.taskPlanProviderApproval.updateMany({
    where: {
      id: { in: expiredApprovalIds },
      providerRunId: input.providerRunId,
      workBlockId: input.workBlockId ?? null,
      planRunId: input.planRunId,
      status: "pending",
    },
    data: {
      status: "superseded",
      resolvedAt: input.observedAt,
      resolvedBy: "provider",
      resolutionRaw: toJsonInput({
        resolution_source: "provider_reconciliation",
        reason: isTerminalEvent ? "provider_run_terminal" : "provider_continued_after_default_approval_timeout",
        inferred_result: isTerminalEvent ? "superseded" : "default_denied",
        timeoutMs: HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
        observed_event_type: input.event.type,
        observed_status: "run" in input.event ? input.event.run?.status : undefined,
        nativeRunId: input.event.nativeRunId ?? input.event.runId,
      }),
    },
  });
}

async function persistProviderApproval(tx: Prisma.TransactionClient, input: {
  context: RuntimeEventPersistenceContext;
  providerRunId?: string | null;
  rawEventId: string;
  eventId: string;
  event: Extract<ProviderRunEvent, { type: "approval_required" }>;
  requestedAt: Date;
}) {
  const scope = approvalScope(input);
  if (!scope) return;
  const approval = input.event.approval;
  const approvalRef = approval.id ?? `${input.event.sequence ?? 0}:${approval.providerKind ?? approval.kind}`;
  await tx.taskPlanProviderApproval.upsert({
    where: { providerRunId_approvalRef: { providerRunId: scope.providerRunId, approvalRef } },
    update: approvalUpdate(input, approval),
    create: approvalCreate(input, scope, approval, approvalRef),
  });
}

function approvalScope(input: { context: RuntimeEventPersistenceContext; providerRunId?: string | null }) {
  const { context, providerRunId } = input;
  if (!providerRunId) return null;
  return { providerRunId, workBlockId: context.workBlockId, planId: context.planId, planRunId: context.planRunId };
}

function approvalUpdate(input: { rawEventId: string; eventId: string; requestedAt: Date }, approval: Extract<ProviderRunEvent, { type: "approval_required" }>["approval"]) {
  return { rawEventId: input.rawEventId, responseEventId: input.eventId, rawPayload: toJsonInput(approval.raw), requestedAt: input.requestedAt, updatedAt: new Date() };
}

function approvalCreate(
  input: { context: RuntimeEventPersistenceContext; rawEventId: string; eventId: string; requestedAt: Date },
  scope: { providerRunId: string; workBlockId: string | null; planId: string; planRunId: string },
  approval: Extract<ProviderRunEvent, { type: "approval_required" }>["approval"],
  approvalRef: string,
) {
  return {
    workspaceId: input.context.workspaceId,
    taskId: input.context.taskId,
    workBlockId: scope.workBlockId,
    planId: scope.planId,
    planRunId: scope.planRunId,
    nodeAttemptId: input.context.nodeAttemptId,
    providerRunId: scope.providerRunId,
    nodeId: input.context.nodeContext?.nodeId ?? null,
    nodeTitle: input.context.nodeContext?.nodeTitle ?? null,
    provider: approval.provider,
    runtimeName: input.context.runtimeName,
    nativeRunId: approval.nativeRunId ?? approval.runId,
    approvalRef,
    kind: approval.kind,
    providerKind: approval.providerKind,
    title: approval.title,
    summary: approval.summary,
    description: approval.description,
    riskLevel: approval.riskLevel,
    subject: toJsonInput(approval.subject),
    choices: toJsonInput(approval.choices) as Prisma.InputJsonValue,
    scopePolicy: toJsonInput(approval.scopePolicy),
    rawPayload: toJsonInput(approval.raw),
    status: "pending",
    requestedAt: input.requestedAt,
    rawEventId: input.rawEventId,
    responseEventId: input.eventId,
  };
}

async function updateProviderRunAuditRefs(tx: Prisma.TransactionClient, input: {
  providerRunRecordId?: string | null;
  rawEventId: string;
  eventId: string;
  eventType: string;
  nativeRunId?: string | null;
  runtimeName: string;
  correlationId: string;
}) {
  if (!input.providerRunRecordId) return;
  const existing = await tx.taskPlanProviderRun.findUnique({
    where: { id: input.providerRunRecordId },
    select: { firstRawEventId: true },
  });
  if (!existing) return;
  const terminalStatuses = ["completed", "failed", "cancelled"];
  const requestedStatus = (() => {
    if (input.eventType === "run_completed") return "completed";
    if (input.eventType === "run_failed") return "failed";
    if (input.eventType === "run_cancelled") return "cancelled";
    if (input.eventType === "approval_required") return "waiting_for_approval";
    return null;
  })();
  const terminalTransition = requestedStatus !== null && terminalStatuses.includes(requestedStatus);
  await tx.taskPlanProviderRun.updateMany({
    where: {
      id: input.providerRunRecordId,
      ...(requestedStatus ? { status: { notIn: terminalStatuses } } : {}),
    },
    data: {
      runtimeName: input.runtimeName,
      nativeRunId: input.nativeRunId ?? undefined,
      firstRawEventId: existing.firstRawEventId ?? input.rawEventId,
      lastRawEventId: input.rawEventId,
      completedByEventId: terminalTransition && requestedStatus === "completed" ? input.eventId : undefined,
      failedByEventId: terminalTransition && requestedStatus === "failed" ? input.eventId : undefined,
      status: requestedStatus ?? undefined,
      finishedAt: terminalTransition ? new Date() : undefined,
      correlationId: input.correlationId,
    },
  });
}

function summaryForProviderEvent(event: ProviderRunEvent) {
  if (event.type === "tool_started" || event.type === "tool_completed") {
    const toolName = "toolName" in event ? event.toolName : undefined;
    return typeof toolName === "string" ? toolName : event.type;
  }
  if (event.type === "run_failed") return event.error;
  return event.type;
}

function hasRawProviderPayload(event: ProviderRunEvent): event is ProviderRunEvent & { raw: unknown } {
  return "raw" in event && event.raw !== undefined;
}

function rawPayloadForProviderEvent(event: ProviderRunEvent) {
  return hasRawProviderPayload(event) ? event.raw : event;
}
