import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent, appendRawEventLog } from "@/modules/events";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import { toJsonInput } from "./ai-runtime-persistence";

export type RuntimeEventPersistenceContext = {
  workspaceId: string;
  taskId: string;
  workBlockId?: string | null;
  runId: string;
  taskSessionId?: string | null;
  planId?: string | null;
  planRunId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  runtimeName: string;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
};

export async function persistProviderRuntimeEvent(input: {
  context?: RuntimeEventPersistenceContext;
  event: ProviderRunEvent;
  fallbackIndex: number;
}) {
  if (!input.context) return;
  try {
    await persistRuntimeEvent(input.context, input.event, input.fallbackIndex);
  } catch {
    // Runtime event persistence must not interrupt provider streaming.
  }
}

async function persistRuntimeEvent(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, fallbackIndex: number): Promise<void> {
  const occurredAt = eventTime(event.timestamp);
  const sequence = event.sequence ?? fallbackIndex;
  const rawEvent = await appendRawEventLog(rawEventInput(context, event, sequence, occurredAt));
  const canonicalEvent = await appendCanonicalEvent(canonicalEventInput(context, event, rawEvent.id, sequence, occurredAt));
  await updateLatestTaskEvent(context.taskId, canonicalEvent.id, rawEvent.id);
  await updateProviderRunAuditRefs(auditReferenceInput(context, event, rawEvent.id, canonicalEvent.id));
  await persistOrReconcileApproval(context, event, rawEvent.id, canonicalEvent.id, occurredAt);
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
    workspaceId: context.workspaceId, taskId: context.taskId, runId: context.runId,
    taskSessionId: context.taskSessionId ?? null, planId: context.planId ?? null,
    nodeAttemptId: context.nodeAttemptId ?? null, providerRunId: context.providerRunId ?? null,
    nodeId: context.nodeContext?.nodeId ?? null, nodeTitle: context.nodeContext?.nodeTitle ?? null,
  };
}

function eventTransport(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, sequence: number, occurredAt: Date) {
  return {
    source: "provider" as const, direction: "inbound" as const, rawType: event.rawEventType ?? event.type,
    provider: event.provider, runtimeName: context.runtimeName, rawPayload: rawPayloadForProviderEvent(event),
    metadata: hasRawProviderPayload(event) ? { normalizedEvent: event } : null,
    nativeRunId: event.nativeRunId ?? event.runId, externalRef: eventReference(context, event, sequence), sequence,
    correlationId: context.providerRunId ?? context.runId, occurredAt,
  };
}

function canonicalEventInput(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, sequence: number, occurredAt: Date) {
  return {
    eventType: `provider.${event.type}`, workspaceId: context.workspaceId, taskId: context.taskId,
    workBlockId: context.workBlockId, runId: context.runId, taskSessionId: context.taskSessionId ?? null,
    planId: context.planId ?? null, nodeAttemptId: context.nodeAttemptId ?? null,
    providerRunId: context.providerRunId ?? null, nodeId: context.nodeContext?.nodeId ?? null,
    nodeTitle: context.nodeContext?.nodeTitle ?? null, rawEventId,
    correlationId: context.providerRunId ?? context.runId, actorType: "runtime" as const,
    actorId: context.runtimeName, source: "provider" as const,
    payload: { runtimeName: context.runtimeName, provider: event.provider, runId: event.runId, nativeRunId: event.nativeRunId, sequence, rawEventType: event.rawEventType, event },
    summary: summaryForProviderEvent(event), dedupeKey: eventReference(context, event, sequence), occurredAt,
  };
}

function eventReference(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, sequence: number): string {
  return `provider.runtime:${context.runId}:${sequence}:${event.type}:${event.rawEventType ?? "event"}`;
}

async function updateLatestTaskEvent(taskId: string, eventId: string, rawEventId: string): Promise<void> {
  await db.task.update({ where: { id: taskId }, data: { latestEventId: eventId, latestRawEventId: rawEventId } }).catch(() => undefined);
}

function auditReferenceInput(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, eventId: string) {
  return {
    providerRunRecordId: context.providerRunId, rawEventId, eventId, eventType: event.type,
    nativeRunId: event.nativeRunId ?? event.runId ?? null, runtimeName: context.runtimeName,
    correlationId: context.providerRunId ?? context.runId,
  };
}

async function persistOrReconcileApproval(context: RuntimeEventPersistenceContext, event: ProviderRunEvent, rawEventId: string, eventId: string, observedAt: Date): Promise<void> {
  if (event.type === "approval_required") return persistProviderApproval({ context, providerRunId: context.providerRunId, rawEventId, eventId, event, requestedAt: observedAt });
  return reconcilePendingProviderApprovals({ providerRunId: context.providerRunId, event, observedAt });
}

const HERMES_DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

async function reconcilePendingProviderApprovals(input: {
  providerRunId?: string | null;
  event: ProviderRunEvent;
  observedAt: Date;
}) {
  if (!input.providerRunId) return;

  const pendingApprovals = await db.taskPlanProviderApproval.findMany({
    where: {
      providerRunId: input.providerRunId,
      status: "pending",
    },
    select: {
      id: true,
      requestedAt: true,
    },
  });
  if (pendingApprovals.length === 0) return;

  const isTerminalEvent =
    input.event.type === "run_completed" ||
    input.event.type === "run_failed" ||
    input.event.type === "run_cancelled";
  const expiredApprovalIds = pendingApprovals
    .filter((approval) =>
      isTerminalEvent || input.observedAt.getTime() - approval.requestedAt.getTime() >= HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
    )
    .map((approval) => approval.id);
  if (expiredApprovalIds.length === 0) return;

  await db.taskPlanProviderApproval.updateMany({
    where: {
      id: { in: expiredApprovalIds },
      status: "pending",
    },
    data: {
      status: "superseded",
      resolvedAt: input.observedAt,
      resolvedBy: "provider",
      resolutionRaw: toJsonInput({
        resolution_source: "provider_reconciliation",
        reason: isTerminalEvent
          ? "provider_run_ended_without_chrona_resolution"
          : "provider_continued_after_default_approval_timeout",
        inferred_result: "default_denied",
        timeoutMs: HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
        observed_event_type: input.event.type,
        observed_status: "run" in input.event ? input.event.run?.status : undefined,
        nativeRunId: input.event.nativeRunId ?? input.event.runId,
      }),
    },
  });
}

async function persistProviderApproval(input: {
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
  await db.taskPlanProviderApproval.upsert({
    where: { providerRunId_approvalRef: { providerRunId: scope.providerRunId, approvalRef } },
    update: approvalUpdate(input, approval),
    create: approvalCreate(input, scope, approval, approvalRef),
  });
}

function approvalScope(input: { context: RuntimeEventPersistenceContext; providerRunId?: string | null }) {
  const { context, providerRunId } = input;
  if (!providerRunId || !context.planId || !context.planRunId) return null;
  return { providerRunId, planId: context.planId, planRunId: context.planRunId };
}

function approvalUpdate(input: { rawEventId: string; eventId: string; requestedAt: Date }, approval: Extract<ProviderRunEvent, { type: "approval_required" }>['approval']) {
  return { rawEventId: input.rawEventId, responseEventId: input.eventId, rawPayload: toJsonInput(approval.raw), requestedAt: input.requestedAt, updatedAt: new Date() };
}

function approvalCreate(
  input: { context: RuntimeEventPersistenceContext; rawEventId: string; eventId: string; requestedAt: Date },
  scope: { providerRunId: string; planId: string; planRunId: string },
  approval: Extract<ProviderRunEvent, { type: "approval_required" }>['approval'],
  approvalRef: string,
) {
  const { context } = input;
  return {
    workspaceId: context.workspaceId, taskId: context.taskId, workBlockId: context.workBlockId ?? null,
    planId: scope.planId, planRunId: scope.planRunId, nodeAttemptId: context.nodeAttemptId ?? null,
    providerRunId: scope.providerRunId, nodeId: context.nodeContext?.nodeId ?? null, nodeTitle: context.nodeContext?.nodeTitle ?? null,
    provider: approval.provider, runtimeName: context.runtimeName, nativeRunId: approval.nativeRunId ?? approval.runId,
    approvalRef, kind: approval.kind, providerKind: approval.providerKind, title: approval.title, summary: approval.summary,
    description: approval.description, riskLevel: approval.riskLevel, subject: toJsonInput(approval.subject),
    choices: toJsonInput(approval.choices) as Prisma.InputJsonValue, scopePolicy: toJsonInput(approval.scopePolicy),
    rawPayload: toJsonInput(approval.raw), status: "pending", requestedAt: input.requestedAt,
    rawEventId: input.rawEventId, responseEventId: input.eventId,
  };
}

async function updateProviderRunAuditRefs(input: {
  providerRunRecordId?: string | null;
  rawEventId: string;
  eventId: string;
  eventType: string;
  nativeRunId?: string | null;
  runtimeName: string;
  correlationId: string;
}) {
  if (!input.providerRunRecordId) return;
  const existing = await db.taskPlanProviderRun.findUnique({
    where: { id: input.providerRunRecordId },
    select: { firstRawEventId: true },
  });
  const terminalStatus = (() => {
    if (input.eventType === "run_completed") return "completed";
    if (input.eventType === "run_failed") return "failed";
    if (input.eventType === "run_cancelled") return "cancelled";
    return null;
  })();
  await db.taskPlanProviderRun.update({
    where: { id: input.providerRunRecordId },
    data: {
      runtimeName: input.runtimeName,
      nativeRunId: input.nativeRunId ?? undefined,
      firstRawEventId: existing?.firstRawEventId ?? input.rawEventId,
      lastRawEventId: input.rawEventId,
      completedByEventId: input.eventType === "run_completed" ? input.eventId : undefined,
      failedByEventId: input.eventType === "run_failed" ? input.eventId : undefined,
      status: terminalStatus ?? (input.eventType === "approval_required" ? "waiting_for_approval" : undefined),
      finishedAt: terminalStatus ? new Date() : undefined,
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
