import { db } from "@/lib/db";
import {
  ensureDefaultTaskSession,
  buildDefaultTaskSessionKey,
} from "@/modules/task-execution/task-sessions";

export type EnsureNodeChildSessionInput = {
  taskId: string;
  planId: string;
  nodeId: string;
  nodeTitle: string;
  runtimeName?: string;
};

export type EnsureNodeChildSessionResult = {
  sessionId: string;
  sessionKey: string;
  runId: string;
  childTaskId: string | undefined;
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
  const runtimeName = input.runtimeName ?? "openclaw";

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
    label: `${task.title} · ${input.nodeTitle} · Plan node child session`,
  });

  return {
    sessionId: session.id,
    sessionKey: session.sessionKey,
    runId: "",
    childTaskId: undefined,
  };
}

export async function startNodeChildRun(input: {
  taskId: string;
  childSessionId: string;
  childSessionKey: string;
  prompt: string;
  runtimeName?: string;
}): Promise<{ runId: string; runtimeRunRef: string | null }> {
  const runtimeName = input.runtimeName ?? "openclaw";

  const { RunStatus, TaskStatus, Prisma } = await import("@/generated/prisma/client");

  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { workspaceId: true, runtimeInput: true, runtimeInputVersion: true, runtimeModel: true, runtimeConfig: true },
  });

  // Create run record as Pending first
  const run = await db.run.create({
    data: {
      taskId: input.taskId,
      taskSessionId: input.childSessionId,
      runtimeName,
      runtimeSessionRef: input.childSessionKey,
      status: RunStatus.Pending,
      triggeredBy: "system",
      startedAt: new Date(),
      syncStatus: "healthy",
    },
  });

  // Actually invoke the runtime
  let runtimeRunRef: string | null = null;
  try {
    const { createRuntimeExecutionAdapter } = await import("@/modules/task-execution/execution-registry");
    const adapter = await createRuntimeExecutionAdapter(runtimeName);
    const created = await adapter.createRun({
      prompt: input.prompt,
      runtimeInput: (task.runtimeInput as Record<string, unknown> | undefined) ?? {},
      runtimeSessionKey: input.childSessionKey,
    });

    runtimeRunRef = created.runtimeRunRef ?? null;
    const nextStatus = created.runStarted ? RunStatus.Running : RunStatus.Pending;

    await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef,
        runtimeSessionRef: created.runtimeSessionKey ?? created.runtimeSessionRef ?? input.childSessionKey,
        status: nextStatus,
        syncStatus: "healthy",
      },
    });

    // Persist the runtime output immediately — the adapter's in-memory sessions
    // are lost when this function returns, so we must read output now.
    let hasAssistantOutput = false;
    try {
      const runtimeSessionKey = created.runtimeSessionKey ?? created.runtimeSessionRef ?? input.childSessionKey;
      const history = await adapter.readHistory({ runtimeSessionKey }) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      if (history?.messages?.length) {
        for (let i = 0; i < history.messages.length; i++) {
          const msg = history.messages[i];
          if (typeof msg?.role === "string" && typeof msg?.content === "string" && msg.content.length > 0) {
            await db.conversationEntry.create({
              data: {
                runId: run.id,
                role: msg.role,
                content: msg.content,
                sequence: i + 1,
                runtimeTs: new Date(),
              },
            });
            if (msg.role === "assistant") {
              hasAssistantOutput = true;
            }
          }
        }
      }
    } catch {
      // output persist is best-effort; do not fail the run start
    }

    await db.taskSession.update({
      where: { id: input.childSessionId },
      data: {
        status: "running",
        lastRunStatus: hasAssistantOutput ? RunStatus.Completed : nextStatus,
        activeRunId: run.id,
      },
    });

    if (hasAssistantOutput) {
      await db.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.Completed,
          endedAt: new Date(),
          syncStatus: "healthy",
        },
      });
    }
  } catch (err) {
    // Runtime invoke failed — mark run as Failed
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.run.update({
      where: { id: run.id },
      data: { status: RunStatus.Failed, errorSummary: message },
    });
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
    runId: run.id,
    actorType: "system",
    actorId: "plan-orchestrator",
    source: "plan_execution",
    payload: {
      runtime_name: runtimeName,
      triggered_by: "system",
      child_session_key: input.childSessionKey,
    },
    dedupeKey: `run.started:${run.id}`,
  });

  return { runId: run.id, runtimeRunRef };
}
