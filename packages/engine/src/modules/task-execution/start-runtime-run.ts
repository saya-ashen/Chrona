import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createRuntimeExecutionAdapter } from "./execution-registry";

type StartRuntimeRunMode = "allow_async" | "require_sync_output";

type StartRuntimeRunInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  runtimeInput: Record<string, unknown>;
  prompt: string;
  triggeredBy: "system" | "user";
  mode: StartRuntimeRunMode;
};

type StartRuntimeRunResult = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  runStarted: boolean;
  status: RunStatus;
  hasAssistantOutput: boolean;
  conversationEntryIds: string[];
};

type RuntimeHistory = {
  messages?: Array<{ role?: string; content?: string }>;
};

export async function startRuntimeRun(
  input: StartRuntimeRunInput,
): Promise<StartRuntimeRunResult> {
  const run = await db.run.create({
    data: {
      taskId: input.taskId,
      taskSessionId: input.taskSessionId,
      runtimeName: input.runtimeName,
      runtimeSessionRef: input.runtimeSessionKey,
      status: RunStatus.Pending,
      triggeredBy: input.triggeredBy,
      startedAt: new Date(),
      syncStatus: "healthy",
    },
  });

  try {
    const adapter = await createRuntimeExecutionAdapter(input.runtimeName);
    const created = await adapter.createRun({
      prompt: input.prompt,
      runtimeInput: input.runtimeInput,
      runtimeSessionKey: input.runtimeSessionKey,
    });

    const runtimeSessionKey =
      created.runtimeSessionKey ??
      created.runtimeSessionRef ??
      input.runtimeSessionKey;
    const runtimeRunRef = created.runtimeRunRef ?? null;

    const persistedHistory = await persistRuntimeHistory({
      adapter,
      runId: run.id,
      runtimeSessionKey,
    });

    const status = deriveRunStatus({
      mode: input.mode,
      runStarted: created.runStarted,
      hasAssistantOutput: persistedHistory.hasAssistantOutput,
      savedMessageCount: persistedHistory.conversationEntryIds.length,
    });

    await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef,
        runtimeSessionRef: runtimeSessionKey,
        status,
        syncStatus: "healthy",
        endedAt: status === RunStatus.Completed ? new Date() : null,
      },
    });

    return {
      runId: run.id,
      runtimeRunRef,
      runtimeSessionKey,
      runStarted: created.runStarted,
      status,
      hasAssistantOutput: persistedHistory.hasAssistantOutput,
      conversationEntryIds: persistedHistory.conversationEntryIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.run.update({
      where: { id: run.id },
      data: { status: RunStatus.Failed, errorSummary: message },
    });
    throw error;
  }
}

function deriveRunStatus(input: {
  mode: StartRuntimeRunMode;
  runStarted: boolean;
  hasAssistantOutput: boolean;
  savedMessageCount: number;
}): RunStatus {
  if (input.mode === "require_sync_output") {
    if (!input.runStarted) {
      return RunStatus.Failed;
    }
    if (input.savedMessageCount === 0 || !input.hasAssistantOutput) {
      return RunStatus.Failed;
    }
    return RunStatus.Completed;
  }

  if (input.hasAssistantOutput) {
    return RunStatus.Completed;
  }

  return input.runStarted ? RunStatus.Running : RunStatus.Pending;
}

async function persistRuntimeHistory(input: {
  adapter: Awaited<ReturnType<typeof createRuntimeExecutionAdapter>>;
  runId: string;
  runtimeSessionKey: string;
}): Promise<{
  hasAssistantOutput: boolean;
  conversationEntryIds: string[];
}> {
  try {
    const history = (await input.adapter.readHistory({
      runtimeSessionKey: input.runtimeSessionKey,
    })) as RuntimeHistory;
    const conversationEntryIds: string[] = [];
    let hasAssistantOutput = false;

    if (history?.messages?.length) {
      for (let index = 0; index < history.messages.length; index += 1) {
        const message = history.messages[index];
        if (
          typeof message?.role !== "string" ||
          typeof message?.content !== "string" ||
          message.content.length === 0
        ) {
          continue;
        }

        const created = await db.conversationEntry.create({
          data: {
            runId: input.runId,
            role: message.role,
            content: message.content,
            sequence: index + 1,
            runtimeTs: new Date(),
          },
          select: { id: true },
        });
        conversationEntryIds.push(created.id);
        if (message.role === "assistant") {
          hasAssistantOutput = true;
        }
      }
    }

    return { hasAssistantOutput, conversationEntryIds };
  } catch {
    // Initial history hydrate is best-effort. Runtime sync remains source of truth.
    return { hasAssistantOutput: false, conversationEntryIds: [] };
  }
}
