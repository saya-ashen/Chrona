import type {
  ChronaToolOperation,
  ChronaToolResult,
} from "@chrona/contracts";
import { db } from "@/lib/db";
import {
  appendCanonicalEvent,
  appendRawEventLog,
  appendTaskTimelineItem,
} from "@/modules/events";
import type { ToolAuditContext, ToolAuditScope } from "./types";

export async function startToolAudit(input: {
  operationId: string;
  operation: ChronaToolOperation;
}): Promise<ToolAuditContext | null> {
  const { operation } = input;
  const workspaceId = operation.input.workspaceId;
  if (!workspaceId) return null;
  const taskId = operation.input.taskId ?? null;
  const auditScope = await resolveToolAuditScope({
    taskId,
    sessionId: operation.input.sessionId ?? null,
    nodeId: nodeIdFromOperation(operation) ?? null,
  });
  const node = auditScope.nodeId
    ? await nodeTitleForExecutionSession(taskId, auditScope.planId ?? null, auditScope.nodeId)
    : null;
  const raw = await appendRawEventLog({
    workspaceId,
    taskId,
    runId: auditScope.runId ?? null,
    taskSessionId: operation.input.sessionId ?? null,
    executionSessionId: auditScope.executionSessionId ?? null,
    planId: auditScope.planId ?? null,
    planRunId: auditScope.planRunId ?? null,
    nodeAttemptId: auditScope.nodeAttemptId ?? null,
    providerRunId: auditScope.providerRunId ?? null,
    nodeId: auditScope.nodeId ?? null,
    nodeTitle: node?.title ?? null,
    source: "chrona_tool",
    direction: "inbound",
    rawType: operation.toolName,
    rawPayload: operation,
    metadata: { operationId: input.operationId, idempotencyKey: operation.input.idempotencyKey },
    nativeToolCallId: input.operationId,
    externalRef: `chrona_tool.input:${input.operationId}`,
    correlationId: input.operationId,
    occurredAt: new Date(),
  });
  const invocation = await db.toolInvocation.create({
    data: {
      workspaceId,
      taskId,
      runId: auditScope.runId ?? null,
      executionSessionId: auditScope.executionSessionId ?? null,
      planId: auditScope.planId ?? null,
      planRunId: auditScope.planRunId ?? null,
      nodeAttemptId: auditScope.nodeAttemptId ?? null,
      providerRunId: auditScope.providerRunId ?? null,
      nodeId: auditScope.nodeId ?? null,
      toolName: operation.toolName,
      toolKind: operation.toolName.startsWith("chrona.node.") ? "node" : "chrona",
      status: "started",
      inputRawEventId: raw.id,
      inputPayload: operation.input.payload as never,
      inputSummary: summarizeToolInput(operation),
      nativeToolCallId: input.operationId,
      externalRef: input.operationId,
      correlationId: input.operationId,
      startedAt: new Date(),
    },
    select: { id: true },
  });
  return {
    operationId: input.operationId,
    toolName: operation.toolName,
    workspaceId,
    taskId,
    runId: auditScope.runId ?? null,
    executionSessionId: auditScope.executionSessionId ?? null,
    planId: auditScope.planId ?? null,
    planRunId: auditScope.planRunId ?? null,
    nodeAttemptId: auditScope.nodeAttemptId ?? null,
    providerRunId: auditScope.providerRunId ?? null,
    nodeId: auditScope.nodeId ?? null,
    nodeTitle: node?.title ?? null,
    inputRawEventId: raw.id,
    invocationId: invocation.id,
  };
}

async function resolveToolAuditScope(input: {
  taskId: string | null;
  sessionId: string | null;
  nodeId: string | null;
}): Promise<ToolAuditScope> {
  const sessionId = input.sessionId;
  const run = await findToolAuditRun(sessionId);
  const session = await findToolAuditExecutionSession(input.taskId, sessionId);
  const nodeAttemptByNode = await findToolAuditNodeAttemptByNode(input.taskId, input.nodeId);
  const providerRun = nodeAttemptByNode
    ? await findToolAuditProviderRunByNodeAttempt(input.taskId, fieldValue(nodeAttemptByNode, "id"))
    : await findToolAuditProviderRun(input.taskId, fieldValue(run, "runtimeRunRef"));
  const nodeAttemptId = firstValue(
    fieldValue(nodeAttemptByNode, "id"),
    fieldValue(providerRun, "nodeAttemptId"),
    fieldValue(session, "currentNodeAttemptId"),
  );
  const nodeAttempt = await findToolAuditNodeAttempt(input.taskId, nodeAttemptId);

  return {
    runId: fieldValue(run, "id"),
    executionSessionId: fieldValue(session, "id"),
    planId: firstValue(
      fieldValue(providerRun, "planId"),
      fieldValue(nodeAttempt, "planId"),
      fieldValue(session, "planId"),
    ),
    planRunId: firstValue(fieldValue(providerRun, "planRunId"), fieldValue(nodeAttempt, "planRunId")),
    nodeAttemptId,
    providerRunId: fieldValue(providerRun, "id"),
    nodeId: firstValue(input.nodeId, fieldValue(nodeAttempt, "nodeId"), fieldValue(session, "currentNodeId")),
  };
}

function firstValue(...values: Array<string | null | undefined>) {
  return values.find((value) => value !== null && value !== undefined) ?? null;
}

function fieldValue<T extends Record<string, string | null>, K extends keyof T>(
  value: T | null,
  key: K,
) {
  return value?.[key] ?? null;
}

async function findToolAuditRun(sessionId: string | null) {
  if (!sessionId) return null;
  return db.run.findFirst({
    where: {
      OR: [{ id: sessionId }, { runtimeSessionRef: sessionId }, { runtimeRunRef: sessionId }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, runtimeRunRef: true },
  });
}

async function findToolAuditProviderRun(taskId: string | null, providerRunRef: string | null) {
  if (!taskId || !providerRunRef) return null;
  return db.taskPlanProviderRun.findFirst({
    where: { taskId, providerRunRef },
    orderBy: { updatedAt: "desc" },
    select: { id: true, planId: true, planRunId: true, nodeAttemptId: true },
  });
}

async function findToolAuditProviderRunByNodeAttempt(
  taskId: string | null,
  nodeAttemptId: string | null,
) {
  if (!taskId || !nodeAttemptId) return null;
  return db.taskPlanProviderRun.findFirst({
    where: { taskId, nodeAttemptId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, planId: true, planRunId: true, nodeAttemptId: true },
  });
}

async function findToolAuditExecutionSession(taskId: string | null, sessionId: string | null) {
  if (!taskId) return null;
  const select = { id: true, planId: true, currentNodeId: true, currentNodeAttemptId: true };
  const exactSession = sessionId
    ? await db.executionSession.findFirst({
        where: { taskId, id: sessionId, status: { in: ["Active", "Paused"] } },
        orderBy: { updatedAt: "desc" },
        select,
      })
    : null;
  if (exactSession) return exactSession;
  return db.executionSession.findFirst({
    where: { taskId, status: { in: ["Active", "Paused"] } },
    orderBy: { updatedAt: "desc" },
    select,
  });
}

async function findToolAuditNodeAttempt(taskId: string | null, nodeAttemptId: string | null) {
  if (!taskId || !nodeAttemptId) return null;
  return db.taskPlanNodeAttempt.findFirst({
    where: { taskId, id: nodeAttemptId },
    select: { planId: true, planRunId: true, nodeId: true },
  });
}

async function findToolAuditNodeAttemptByNode(taskId: string | null, nodeId: string | null) {
  if (!taskId || !nodeId) return null;
  return db.taskPlanNodeAttempt.findFirst({
    where: { taskId, nodeId, status: { in: ["running", "blocked", "waiting_for_user", "waiting_for_approval"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, planId: true, planRunId: true, nodeId: true },
  });
}

export async function finishToolAudit(
  audit: ToolAuditContext | null,
  operation: ChronaToolOperation,
  result: ChronaToolResult,
  status: "accepted" | "rejected" | "validation_error" | "duplicate",
) {
  if (!audit) return;
  const now = new Date();
  const raw = await appendRawEventLog({
    workspaceId: audit.workspaceId,
    taskId: audit.taskId ?? null,
    runId: audit.runId ?? null,
    taskSessionId: operation.input.sessionId ?? null,
    executionSessionId: audit.executionSessionId ?? null,
    planId: audit.planId ?? null,
    planRunId: audit.planRunId ?? null,
    nodeAttemptId: audit.nodeAttemptId ?? null,
    providerRunId: audit.providerRunId ?? null,
    nodeId: audit.nodeId ?? null,
    nodeTitle: audit.nodeTitle ?? null,
    source: "chrona_tool",
    direction: "outbound",
    rawType: `${operation.toolName}.${status}`,
    rawPayload: result,
    nativeToolCallId: audit.operationId,
    externalRef: `chrona_tool.result:${audit.operationId}`,
    correlationId: audit.operationId,
    causationRawEventId: audit.inputRawEventId ?? null,
    occurredAt: now,
  });
  const event = await appendCanonicalEvent({
    eventType: `tool.${status}`,
    workspaceId: audit.workspaceId,
    taskId: audit.taskId ?? null,
    workBlockId: null,
    runId: audit.runId ?? null,
    taskSessionId: operation.input.sessionId ?? null,
    executionSessionId: audit.executionSessionId ?? null,
    planId: audit.planId ?? null,
    planRunId: audit.planRunId ?? null,
    nodeAttemptId: audit.nodeAttemptId ?? null,
    providerRunId: audit.providerRunId ?? null,
    nodeId: audit.nodeId ?? null,
    nodeTitle: audit.nodeTitle ?? null,
    rawEventId: raw.id,
    correlationId: audit.operationId,
    actorType: operation.input.actorType,
    actorId: operation.input.actorId ?? null,
    source: "chrona_tool",
    payload: {
      toolName: operation.toolName,
      status,
      resultStatus: result.status,
      branchRef: branchRefFromOperation(operation),
      message: result.message,
    },
    summary: result.message,
    severity: status === "accepted" || status === "duplicate" ? "info" : "warning",
    dedupeKey: `chrona_tool.${status}:${audit.operationId}`,
    occurredAt: now,
  });
  await db.toolInvocation.update({
    where: { id: audit.invocationId ?? audit.operationId },
    data: {
      status,
      outputRawEventId: raw.id,
      canonicalEventId: event.id,
      outputPayload: result as never,
      outputSummary: result.message,
      completedAt: now,
    },
  }).catch(() => undefined);
  if (audit.taskId) {
    await appendTaskTimelineItem({
      workspaceId: audit.workspaceId,
      taskId: audit.taskId,
      runId: audit.runId ?? null,
      taskSessionId: operation.input.sessionId ?? null,
      executionSessionId: audit.executionSessionId ?? null,
      planId: audit.planId ?? null,
      planRunId: audit.planRunId ?? null,
      nodeAttemptId: audit.nodeAttemptId ?? null,
      providerRunId: audit.providerRunId ?? null,
      nodeId: audit.nodeId ?? null,
      nodeTitle: audit.nodeTitle ?? null,
      kind: `tool.${status}`,
      title: operation.toolName,
      body: result.message,
      severity: status === "accepted" || status === "duplicate" ? "info" : "warning",
      status,
      eventId: event.id,
      rawEventId: raw.id,
      toolInvocationId: audit.invocationId ?? null,
      sortTime: now,
      metadata: { resultStatus: result.status, branchRef: branchRefFromOperation(operation) },
    });
    await db.task.update({
      where: { id: audit.taskId },
      data: { latestEventId: event.id, latestRawEventId: raw.id },
    }).catch(() => undefined);
  }
  if (operation.toolName === "chrona.node.condition_select" && status === "accepted") {
    const branchRef = branchRefFromOperation(operation);
    const selectedEvent = await appendCanonicalEvent({
      eventType: "condition.selected",
      workspaceId: audit.workspaceId,
      taskId: audit.taskId ?? null,
      workBlockId: null,
      runId: audit.runId ?? null,
      taskSessionId: operation.input.sessionId ?? null,
      executionSessionId: audit.executionSessionId ?? null,
      planId: audit.planId ?? null,
      planRunId: audit.planRunId ?? null,
      nodeAttemptId: audit.nodeAttemptId ?? null,
      providerRunId: audit.providerRunId ?? null,
      nodeId: audit.nodeId ?? null,
      nodeTitle: audit.nodeTitle ?? null,
      rawEventId: audit.inputRawEventId ?? raw.id,
      correlationId: audit.operationId,
      actorType: operation.input.actorType,
      actorId: operation.input.actorId ?? null,
      source: "chrona_tool",
      payload: {
        toolName: operation.toolName,
        branchRef,
        summary: summaryFromOperationPayload(operation),
      },
      summary: branchRef ? `Selected ${branchRef}` : "Condition branch selected",
      dedupeKey: `condition.selected:${audit.operationId}`,
      occurredAt: now,
    });
    if (audit.invocationId) {
      await db.toolInvocation.update({
        where: { id: audit.invocationId },
        data: { canonicalEventId: selectedEvent.id },
      }).catch(() => undefined);
    }
  }
}

async function nodeTitleForExecutionSession(
  taskId: string | null,
  planId: string | null,
  nodeId: string | null,
) {
  if (!taskId || !planId || !nodeId) return null;
  const planRun = await db.taskPlanRun.findFirst({
    where: { taskId, planId },
    select: { planRun: true },
  });
  const nodes = (planRun?.planRun as { mutableGraph?: { graph?: { nodes?: unknown[] } } } | null)
    ?.mutableGraph?.graph?.nodes;
  if (!Array.isArray(nodes)) return null;
  const node = nodes.find(
    (candidate): candidate is { id: string; title?: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === nodeId,
  );
  return node ?? null;
}

function summarizeToolInput(operation: ChronaToolOperation) {
  const branchRef = branchRefFromOperation(operation);
  const summary = summaryFromOperationPayload(operation);
  return [operation.toolName, branchRef, summary].filter(Boolean).join(" · ");
}

function branchRefFromOperation(operation: ChronaToolOperation) {
  const payload = operation.input.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { branchRef?: unknown }).branchRef === "string"
    ? (payload as { branchRef: string }).branchRef
    : undefined;
}

function nodeIdFromOperation(operation: ChronaToolOperation) {
  const payload = operation.input.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { nodeId?: unknown }).nodeId === "string"
    ? (payload as { nodeId: string }).nodeId
    : undefined;
}

function summaryFromOperationPayload(operation: ChronaToolOperation) {
  const payload = operation.input.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { summary?: unknown }).summary === "string"
    ? (payload as { summary: string }).summary
    : undefined;
}
