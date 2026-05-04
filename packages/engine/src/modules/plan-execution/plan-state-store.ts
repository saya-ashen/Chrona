import { db } from "@/lib/db";
import {
  ensureDefaultTaskSession,
  buildDefaultTaskSessionKey,
} from "@/modules/task-execution/task-sessions";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

export type MainSessionEventType =
  | "execution_started"
  | "executable_path_computed"
  | "node_started"
  | "node_completed"
  | "node_waiting_for_user"
  | "node_waiting_for_approval"
  | "node_blocked"
  | "child_session_created"
  | "child_run_started"
  | "replan_proposed"
  | "execution_completed"
  | "user_input_received"
  | "plan_accepted";

export type MainSessionEventPayload = Record<string, unknown>;

export async function ensurePlanMainSession(input: {
  taskId: string;
  planId: string;
  runtimeName?: string;
}) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { title: true, workspaceId: true, defaultSessionId: true },
  });

  const runtimeName = input.runtimeName ?? "openclaw";

  const session = await ensureDefaultTaskSession({
    taskId: input.taskId,
    taskTitle: task.title,
    runtimeName,
    defaultSessionId: task.defaultSessionId,
    suffix: `plan-${input.planId}`,
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

export async function findPlanMainSession(input: {
  taskId: string;
  planId: string;
}) {
  const runtimeName = "openclaw";
  const expectedKey = buildDefaultTaskSessionKey({
    taskId: input.taskId,
    runtimeName,
    suffix: `plan-${input.planId}`,
  });

  const session = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: expectedKey,
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
  eventType: MainSessionEventType;
  payload: MainSessionEventPayload;
}) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true },
  });

  await appendCanonicalEvent({
    eventType: `plan_execution.${input.eventType}`,
    workspaceId: task.workspaceId,
    taskId: input.taskId,
    runId: null,
    actorType: "system",
    actorId: "plan-orchestrator",
    source: "plan_execution",
    payload: {
      session_id: input.sessionId,
      plan_id: input.planId,
      ...input.payload,
    },
    dedupeKey: `plan_execution.${input.eventType}:${input.taskId}:${input.sessionId}:${Object.values(input.payload).join(",").slice(0, 64)}`,
    runtimeTs: new Date(),
  });
}
