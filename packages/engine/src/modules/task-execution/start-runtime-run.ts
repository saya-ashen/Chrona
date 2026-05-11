import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  PreparedAiFeatureSpec,
} from "@chrona/contracts/ai";
import type {
  BridgeResponse,
  OpenClawChatHistory,
  OpenClawGatewayRequest,
} from "@chrona/openclaw";

type StartRuntimeRunMode = "allow_async" | "require_sync_output";

type StartRuntimeRunInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  runtimeInput: Record<string, unknown>;
  prompt: string;
  featureSpec?: PreparedAiFeatureSpec;
  triggeredBy: "system" | "user";
  mode: StartRuntimeRunMode;
  client: OpenClawResponseClient;
};

type StartRuntimeRunResult = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  runStarted: boolean;
  status: RunStatus;
  errorSummary: string | null;
  hasAssistantOutput: boolean;
  conversationEntryIds: string[];
  response: BridgeResponse;
};

export type OpenClawResponseClient = {
  create(input: {
    request: OpenClawGatewayRequest;
  }): Promise<{ response: BridgeResponse }>;
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
    const request = buildExecutionGatewayRequest({
      instructions: input.prompt,
      runtimeInput: input.runtimeInput,
      featureSpec: input.featureSpec,
      sessionKey: input.runtimeSessionKey,
      sessionId: input.runtimeSessionKey,
      taskId: input.taskId,
      executionRuntime: input.runtimeName,
    });
    const { response: started } = await input.client.create({
      request,
    });

    const runtimeSessionKey = started.sessionId || input.runtimeSessionKey;
    const runtimeRunRef = started.responseId ?? started.runId ?? null;

    const persistedHistory = await persistRuntimeHistory({
      runId: run.id,
      runtimeSessionKey,
      request,
      response: started,
    });

    const status = deriveRunStatus({
      mode: input.mode,
      runStarted: !started.error,
      hasAssistantOutput: persistedHistory.hasAssistantOutput,
      savedMessageCount: persistedHistory.conversationEntryIds.length,
      providerStatus: normalizeProviderStatus(started.responseStatus, started.error),
    });
    const errorSummary =
      status === RunStatus.Failed
        ? buildRuntimeStartError({
            mode: input.mode,
            runStarted: !started.error,
            hasAssistantOutput: persistedHistory.hasAssistantOutput,
            savedMessageCount: persistedHistory.conversationEntryIds.length,
            runtimeRunRef,
            providerError: started.error ?? null,
          })
        : null;

    await db.run.update({
      where: { id: run.id },
      data: {
        runtimeRunRef,
        runtimeSessionRef: runtimeSessionKey,
        status,
        syncStatus: "healthy",
        endedAt: status === RunStatus.Completed ? new Date() : null,
        errorSummary,
      },
    });

    return {
      runId: run.id,
      runtimeRunRef,
      runtimeSessionKey,
      runStarted: !started.error,
      status,
      errorSummary,
      hasAssistantOutput: persistedHistory.hasAssistantOutput,
      conversationEntryIds: persistedHistory.conversationEntryIds,
      response: started,
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

function buildRuntimeStartError(input: {
  mode: StartRuntimeRunMode;
  runStarted: boolean;
  hasAssistantOutput: boolean;
  savedMessageCount: number;
  runtimeRunRef: string | null;
  providerError?: string | null;
}): string {
  if (!input.runStarted) {
    return [
      "Runtime provider did not accept the run",
      input.providerError ? `providerError=${input.providerError}` : null,
      input.runtimeRunRef ? `runtimeRunRef=${input.runtimeRunRef}` : null,
    ]
      .filter(Boolean)
      .join("; ");
  }

  if (input.mode === "require_sync_output" && !input.hasAssistantOutput) {
    return [
      "Runtime completed without assistant output",
      `savedMessages=${input.savedMessageCount}`,
      input.runtimeRunRef ? `runtimeRunRef=${input.runtimeRunRef}` : null,
    ]
      .filter(Boolean)
      .join("; ");
  }

  return [
    "Runtime run failed during startup",
    `savedMessages=${input.savedMessageCount}`,
    input.runtimeRunRef ? `runtimeRunRef=${input.runtimeRunRef}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function normalizeProviderStatus(
  status: string | undefined,
  error: string | null,
): string | undefined {
  if (error) return "Failed";
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "requires_action":
      return "WaitingForApproval";
    case "queued":
    case "in_progress":
      return "Running";
    default:
      return status;
  }
}

function deriveRunStatus(input: {
  mode: StartRuntimeRunMode;
  runStarted: boolean;
  hasAssistantOutput: boolean;
  savedMessageCount: number;
  providerStatus?: string;
}): RunStatus {
  switch (input.providerStatus) {
    case "Failed":
      return RunStatus.Failed;
    case "Cancelled":
      return RunStatus.Cancelled;
    case "WaitingForInput":
      return RunStatus.WaitingForInput;
    case "WaitingForApproval":
      return RunStatus.WaitingForApproval;
    case "Running":
      return input.mode === "require_sync_output" ? RunStatus.Failed : RunStatus.Running;
    case "Completed":
      if (input.mode === "require_sync_output" && !input.hasAssistantOutput) {
        return RunStatus.Failed;
      }
      return RunStatus.Completed;
  }

  if (input.mode === "require_sync_output") {
    if (!input.runStarted) {
      return RunStatus.Failed;
    }
    if (input.savedMessageCount === 0 || !input.hasAssistantOutput) {
      return RunStatus.Failed;
    }
    return RunStatus.Completed;
  }

  if (!input.runStarted) {
    return RunStatus.Failed;
  }

  if (input.hasAssistantOutput) {
    return RunStatus.Completed;
  }

  return RunStatus.Running;
}

async function persistRuntimeHistory(input: {
  runId: string;
  runtimeSessionKey: string;
  request: OpenClawGatewayRequest;
  response: BridgeResponse;
}): Promise<{
  hasAssistantOutput: boolean;
  conversationEntryIds: string[];
}> {
  try {
    const history: OpenClawChatHistory = {
      messages: [
        { role: "user", content: extractUserText(input.request.body) },
        ...(input.response.output
          ? [{ role: "assistant", content: input.response.output }]
          : []),
      ],
    };
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

function buildExecutionGatewayRequest(input: {
  instructions: string;
  runtimeInput: Record<string, unknown>;
  featureSpec?: PreparedAiFeatureSpec;
  sessionKey: string;
  sessionId: string;
  taskId: string;
  executionRuntime: string;
}): OpenClawGatewayRequest {
  const parts: string[] = [];
  parts.push(`Task id: ${input.taskId}`);
  parts.push(`Execution runtime: ${input.executionRuntime}`);
  if (Object.keys(input.runtimeInput).length > 0) {
    parts.push(`Runtime input JSON:\n${JSON.stringify(input.runtimeInput, null, 2)}`);
  }
  parts.push(input.instructions);

  const body: Record<string, unknown> = {
    model: "openclaw",
    user: input.sessionKey,
    input: [
      { type: "message", role: "user", content: parts.join("\n\n") },
    ],
    stream: false,
  };
  const maxTokens = input.runtimeInput.maxTokens ?? input.runtimeInput.maxOutputTokens;
  if (typeof maxTokens === "number") {
    body.max_output_tokens = maxTokens;
  }

  return {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    body,
    feature: input.featureSpec?.feature,
    featureSpec: input.featureSpec,
  };
}

function extractUserText(body: Record<string, unknown>): string {
  const input = body.input;
  if (!Array.isArray(input)) return "";
  const message = input.find(
    (item): item is { role: string; content: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).role === "user" &&
      typeof (item as Record<string, unknown>).content === "string",
  );
  return message?.content ?? "";
}
