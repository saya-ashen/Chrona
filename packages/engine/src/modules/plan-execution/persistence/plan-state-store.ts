import { db } from "@/lib/db";
import {
  buildLegacyPlanExecutionTaskSessionKey,
  buildPlanExecutionTaskSessionKey,
  ensurePlanExecutionTaskSession,
} from "@/modules/execution-runtime";
import {
  appendCanonicalEvent,
  appendRawEventLog,
  appendTaskTimelineItem,
} from "@/modules/events";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import type { PlanGraphCommandEnvelope } from "../types";

type MainSessionEventType =
  | "execution_started"
  | "executable_path_computed"
  | "node_started"
  | "node_completed"
  | "node_waiting_for_user"
  | "node_waiting_for_approval"
  | "node_blocked"
  | "graph_mutation_applied"
  | "node_result_submitted"
  | "result_finalization_started"
  | "result_finalization_ready"
  | "result_finalization_failed"
  | "continuation_skipped"
  | "replan_proposed"
  | "execution_completed"
  | "user_input_received"
  | "plan_accepted";

type MainSessionEventPayload = Record<string, unknown>;

export async function ensurePlanMainSession(input: {
  taskId: string;
  planId: string;
  runtimeName?: string;
}) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { title: true, workspaceId: true },
  });

  const session = await ensurePlanExecutionTaskSession({
    taskId: input.taskId,
    taskTitle: task.title,
    runtimeName: input.runtimeName ?? "default",
    planId: input.planId,
    label: `${task.title} · Plan execution main session`,
  });

  return {
    id: session.id,
    taskId: session.taskId,
    sessionKey: session.sessionKey,
    runtimeName: session.runtimeName,
    status: session.status,
    label: session.label,
    workspaceId: task.workspaceId,
  };
}

async function _findPlanMainSession(input: {
  taskId: string;
  planId: string;
}) {
  const expectedKey = buildPlanExecutionTaskSessionKey({
    taskId: input.taskId,
    planId: input.planId,
  });
  const legacyKey = buildLegacyPlanExecutionTaskSessionKey({
    taskId: input.taskId,
    planId: input.planId,
  });

  const session = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: { in: [expectedKey, legacyKey] },
    },
  });

  return session
    ? {
        id: session.id,
        taskId: session.taskId,
        sessionKey: session.sessionKey,
        runtimeName: session.runtimeName,
        status: session.status,
        label: session.label,
      }
    : null;
}

export async function appendMainSessionEvent(input: {
  taskId: string;
  planId: string;
  sessionId: string;
  workBlockId?: string | null;
  eventType: MainSessionEventType;
  nodeId?: string | null;
  nodeTitle?: string | null;
  payload: MainSessionEventPayload;
  rawEvent?: unknown;
  envelope?: PlanGraphCommandEnvelope;
}) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true },
  });

  const occurredAt = new Date();
  const rawEvent = await appendRawEventLog({
    workspaceId: task.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    taskSessionId: input.sessionId,
    planId: input.planId,
    nodeId: input.nodeId ?? null,
    nodeTitle: input.nodeTitle ?? null,
    source: "graph_runtime",
    direction: "inbound",
    rawType: input.eventType,
    rawPayload: input.rawEvent ?? {
      type: input.eventType,
      payload: input.payload,
    },
    metadata: {
      planId: input.planId,
      sessionId: input.sessionId,
      command: input.envelope?.command.type,
      actor: input.envelope?.actor,
      origin: input.envelope?.origin,
      correlation: input.envelope?.correlation,
    },
    externalRef: planExecutionEventKey(input),
    correlationId: input.sessionId,
    occurredAt,
  });

  const event = await appendCanonicalEvent({
    eventType: `plan_execution.${input.eventType}`,
    workspaceId: task.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    taskSessionId: input.sessionId,
    planId: input.planId,
    runId: null,
    nodeId: input.nodeId ?? null,
    nodeTitle: input.nodeTitle ?? null,
    rawEventId: rawEvent.id,
    correlationId: input.envelope?.origin.requestId ?? input.sessionId,
    actorType: actorTypeForEnvelope(input.envelope),
    actorId: actorIdForEnvelope(input.envelope),
    source: "plan_execution",
    payload: {
      session_id: input.sessionId,
      plan_id: input.planId,
      command: input.envelope?.command.type,
      actor: input.envelope?.actor,
      origin: input.envelope?.origin,
      correlation: input.envelope?.correlation,
      ...input.payload,
    },
    dedupeKey: planExecutionEventKey(input),
    summary: timelineTitle(input.eventType, input.nodeTitle),
    severity: input.eventType === "node_blocked" ? "warning" : "info",
    occurredAt,
  });

  await appendTaskTimelineItem({
    workspaceId: task.workspaceId,
    workBlockId: input.workBlockId,
    taskId: input.taskId,
    taskSessionId: input.sessionId,
    planId: input.planId,
    nodeId: input.nodeId ?? null,
    nodeTitle: input.nodeTitle ?? null,
    kind: `plan_execution.${input.eventType}`,
    title: timelineTitle(input.eventType, input.nodeTitle),
    body: timelineBody(input.payload),
    severity: input.eventType === "node_blocked" ? "warning" : "info",
    status: input.eventType,
    eventId: event.id,
    rawEventId: rawEvent.id,
    sortTime: occurredAt,
    metadata: {
      planId: input.planId,
      sessionId: input.sessionId,
      command: input.envelope?.command.type,
      actor: input.envelope?.actor,
      origin: input.envelope?.origin,
      correlation: input.envelope?.correlation,
    },
  });

  await db.task.update({
    where: { id: input.taskId },
    data: {
      latestEventId: event.id,
      latestRawEventId: rawEvent.id,
      blockedByEventId: input.eventType === "node_blocked" ? event.id : undefined,
      blockedByRawEventId: input.eventType === "node_blocked" ? rawEvent.id : undefined,
    },
  });

  publishTaskWorkspaceUpdatedEvent({
    taskId: input.taskId,
    workspaceId: task.workspaceId,
    workBlockId: input.workBlockId,
    reason: `plan_execution.${input.eventType}`,
  });
}

function planExecutionEventKey(input: {
  taskId: string;
  sessionId: string;
  eventType: MainSessionEventType;
  nodeId?: string | null;
  payload: MainSessionEventPayload;
  envelope?: PlanGraphCommandEnvelope;
}) {
  const origin = input.envelope?.origin;
  const uniqueRef =
    origin?.requestId ??
    input.envelope?.correlation.toolInvocationId ??
    input.envelope?.correlation.providerRunId ??
    input.envelope?.correlation.nodeAttemptId;
  return [
    "plan_execution",
    input.eventType,
    input.taskId,
    input.sessionId,
    input.nodeId ?? "none",
    uniqueRef ?? Object.values(input.payload).join(",").slice(0, 64),
  ].join(":");
}

function timelineTitle(eventType: MainSessionEventType, nodeTitle?: string | null) {
  if (nodeTitle) return `${nodeTitle}: ${eventType}`;
  return eventType;
}

function timelineBody(payload: MainSessionEventPayload) {
  const summary = payload.summary ?? payload.reason ?? payload.prompt ?? payload.status;
  return typeof summary === "string" ? summary : null;
}

function actorTypeForEnvelope(envelope?: PlanGraphCommandEnvelope) {
  return envelope?.actor.type ?? "system";
}

function actorIdForEnvelope(envelope?: PlanGraphCommandEnvelope) {
  const actor = envelope?.actor;
  if (!actor) return "plan-orchestrator";
  if (actor.type === "user") return actor.userId ?? null;
  if (actor.type === "agent") return actor.actorId ?? actor.toolInvocationId ?? actor.providerRunId ?? null;
  if (actor.type === "system") return actor.service;
  return actor.integration;
}
