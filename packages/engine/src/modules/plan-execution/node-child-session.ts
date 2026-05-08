import { db } from "@/lib/db";
import {
  ensureDefaultTaskSession,
  buildDefaultTaskSessionKey,
} from "@/modules/task-execution/task-sessions";
import { startRuntimeRun } from "@/modules/task-execution/start-runtime-run";
import { OPENCLAW_RUNTIME_ADAPTER_KEY as DEFAULT_RUNTIME_ADAPTER_KEY } from "@chrona/openclaw";

type EnsureNodeChildSessionInput = {
  taskId: string;
  planId: string;
  nodeId: string;
  nodeTitle: string;
  runtimeName?: string;
};

type EnsureNodeChildSessionResult = {
  sessionId: string;
  sessionKey: string;
  runId: string;
  childTaskId: string | undefined;
};

type StartNodeChildRunInput = {
  taskId: string;
  childSessionId: string;
  childSessionKey: string;
  prompt: string;
  runtimeName?: string;
};

type StartNodeChildRunResult = {
  runId: string;
  runtimeRunRef: string | null;
};

function buildNodeChildSessionKey(input: {
  taskId: string;
  runtimeName: string;
  planId: string;
  nodeId: string;
}) {
  return buildDefaultTaskSessionKey({
    taskId: input.taskId,
    runtimeName: input.runtimeName,
    suffix: `plan-${input.planId}-node-${input.nodeId}`,
  });
}

export async function ensureNodeChildSession(
  input: EnsureNodeChildSessionInput,
): Promise<EnsureNodeChildSessionResult> {
  const runtimeName = input.runtimeName ?? DEFAULT_RUNTIME_ADAPTER_KEY;

  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { title: true, workspaceId: true },
  });

  const expectedKey = buildNodeChildSessionKey({
    taskId: input.taskId,
    runtimeName,
    planId: input.planId,
    nodeId: input.nodeId,
  });

  const existingSession = await db.taskSession.findFirst({
    where: {
      taskId: input.taskId,
      sessionKey: expectedKey,
    },
  });

  if (existingSession) {
    return {
      sessionId: existingSession.id,
      sessionKey: existingSession.sessionKey,
      runId: existingSession.activeRunId ?? "",
      childTaskId: undefined,
    };
  }

  const session = await ensureDefaultTaskSession({
    taskId: input.taskId,
    taskTitle: task.title,
    runtimeName,
    suffix: `plan-${input.planId}-node-${input.nodeId}`,
    label: `${task.title} \u00b7 ${input.nodeTitle} \u00b7 Plan node child session`,
  });

  return {
    sessionId: session.id,
    sessionKey: session.sessionKey,
    runId: "",
    childTaskId: undefined,
  };
}

export async function startNodeChildRun(
  input: StartNodeChildRunInput,
): Promise<StartNodeChildRunResult> {
  const runtimeName = input.runtimeName ?? DEFAULT_RUNTIME_ADAPTER_KEY;

  const { RunStatus } = await import("@/generated/prisma/client");

  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true, runtimeInput: true },
  });

  let runtimeRunRef: string | null = null;
  let runId = "";
  try {
    const started = await startRuntimeRun({
      taskId: input.taskId,
      taskSessionId: input.childSessionId,
      runtimeName,
      runtimeSessionKey: input.childSessionKey,
      runtimeInput: (task.runtimeInput as Record<string, unknown> | undefined) ?? {},
      prompt: input.prompt,
      triggeredBy: "system",
      mode: "allow_async",
    });

    runtimeRunRef = started.runtimeRunRef;
    runId = started.runId;

    await db.taskSession.update({
      where: { id: input.childSessionId },
      data: {
        status: "running",
        lastRunStatus: started.status,
        activeRunId: started.runId,
      },
    });
  } catch (err) {
    await db.taskSession.update({
      where: { id: input.childSessionId },
      data: { status: "failed", lastRunStatus: RunStatus.Failed },
    });
    throw err;
  }

  const { appendCanonicalEvent } = await import("@/modules/events/append-canonical-event");

  await appendCanonicalEvent({
    eventType: "run.started",
    workspaceId: task.workspaceId,
    taskId: input.taskId,
    runId,
    actorType: "system",
    actorId: "plan-orchestrator",
    source: "plan_execution",
    payload: {
      runtime_name: runtimeName,
      triggered_by: "system",
      child_session_key: input.childSessionKey,
    },
    dedupeKey: `run.started:${runId}`,
  });

  return { runId, runtimeRunRef };
}
