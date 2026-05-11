import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PreparedAiFeatureSpec } from "@chrona/contracts/ai";
import type {
  BridgeResponse,
  OpenClawChatHistory,
  OpenClawGatewayRequest,
} from "@chrona/openclaw";
import { requireAiClient } from "../ai/runtime/client-resolution";

export type AiRuntimeInvocationInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  runtimeInput: Record<string, unknown>;
  instructions: string;
  featureSpec: PreparedAiFeatureSpec;
  triggeredBy: "system" | "user";
  clientId?: string | null;
};

export type AiRuntimeInvocation = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  conversationEntryIds: string[];
  response: BridgeResponse;
};

export class AiRuntimeInvoker {
  async invoke(input: AiRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
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
      const client = await requireAiClient(input.clientId);
      if (!client.providerClient) {
        throw new Error(
          `AI client '${client.record.name}' does not support runtime execution`,
        );
      }

      const request = buildExecutionGatewayRequest({
        instructions: input.instructions,
        runtimeInput: input.runtimeInput,
        featureSpec: input.featureSpec,
        sessionKey: input.runtimeSessionKey,
        sessionId: input.runtimeSessionKey,
        taskId: input.taskId,
        executionRuntime: input.runtimeName,
      });
      const response = await client.providerClient.execute({ request });
      const runtimeSessionKey = response.sessionId || input.runtimeSessionKey;
      const runtimeRunRef = response.responseId ?? response.runId ?? null;
      const conversationEntryIds = await persistRuntimeHistory({
        runId: run.id,
        request,
        response,
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          runtimeRunRef,
          runtimeSessionRef: runtimeSessionKey,
          status: response.error ? RunStatus.Failed : RunStatus.Running,
          syncStatus: "healthy",
          errorSummary: response.error,
        },
      });

      return {
        runId: run.id,
        runtimeRunRef,
        runtimeSessionKey,
        conversationEntryIds,
        response,
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
}

function buildExecutionGatewayRequest(input: {
  instructions: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
  sessionKey: string;
  sessionId: string;
  taskId: string;
  executionRuntime: string;
}): OpenClawGatewayRequest {
  const aiInput = buildExecutionAiInput({
    taskId: input.taskId,
    executionRuntime: input.executionRuntime,
    runtimeInput: input.runtimeInput,
    featureSpec: input.featureSpec,
  });
  const parts: string[] = [];
  parts.push(`Task id: ${input.taskId}`);
  parts.push(`Execution runtime: ${input.executionRuntime}`);
  if (Object.keys(input.runtimeInput).length > 0) {
    parts.push(
      `Runtime input JSON:\n${JSON.stringify(input.runtimeInput, null, 2)}`,
    );
  }
  parts.push(input.instructions);

  const maxTokens =
    input.runtimeInput.maxTokens ?? input.runtimeInput.maxOutputTokens;

  return {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    instructions: input.featureSpec.instructions ?? parts.join("\n\n"),
    input: aiInput,
    structuredOutputSchema: input.featureSpec.structuredOutputSchema,
    maxOutputTokens: typeof maxTokens === "number" ? maxTokens : undefined,
  };
}

function buildExecutionAiInput(input: {
  taskId: string;
  executionRuntime: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
}): string | Record<string, unknown> {
  const runtimeInput = input.runtimeInput;
  const completedNodeTitles = Array.isArray(runtimeInput.completedNodeTitles)
    ? runtimeInput.completedNodeTitles.filter(
        (title): title is string =>
          typeof title === "string" && title.trim().length > 0,
      )
    : [];

  switch (input.featureSpec.feature) {
    case "execute_task_node":
      return {
        taskId: input.taskId,
        runtime: input.executionRuntime,
        planTitle:
          typeof runtimeInput.planTitle === "string"
            ? runtimeInput.planTitle
            : undefined,
        node: {
          title:
            typeof runtimeInput.nodeTitle === "string"
              ? runtimeInput.nodeTitle
              : undefined,
          objective:
            typeof runtimeInput.nodeObjective === "string"
              ? runtimeInput.nodeObjective
              : undefined,
          expectedOutput:
            typeof runtimeInput.expectedOutput === "string"
              ? runtimeInput.expectedOutput
              : undefined,
          completionCriteria:
            typeof runtimeInput.completionCriteria === "string"
              ? runtimeInput.completionCriteria
              : undefined,
        },
        completedNodeTitles,
      };
    case "evaluate_condition_node":
      return {
        taskId: input.taskId,
        runtime: input.executionRuntime,
        planTitle:
          typeof runtimeInput.planTitle === "string"
            ? runtimeInput.planTitle
            : undefined,
        node: {
          title:
            typeof runtimeInput.nodeTitle === "string"
              ? runtimeInput.nodeTitle
              : undefined,
          condition:
            typeof runtimeInput.condition === "string"
              ? runtimeInput.condition
              : undefined,
          branches: Array.isArray(runtimeInput.branches)
            ? runtimeInput.branches
            : undefined,
          defaultNextNodeId:
            typeof runtimeInput.defaultNextNodeId === "string"
              ? runtimeInput.defaultNextNodeId
              : undefined,
        },
        completedNodeTitles,
      };
    case "review_checkpoint_node":
      return {
        taskId: input.taskId,
        runtime: input.executionRuntime,
        planTitle:
          typeof runtimeInput.planTitle === "string"
            ? runtimeInput.planTitle
            : undefined,
        node: {
          title:
            typeof runtimeInput.nodeTitle === "string"
              ? runtimeInput.nodeTitle
              : undefined,
          checkpointType:
            typeof runtimeInput.checkpointType === "string"
              ? runtimeInput.checkpointType
              : undefined,
          prompt:
            typeof runtimeInput.prompt === "string"
              ? runtimeInput.prompt
              : undefined,
          options: Array.isArray(runtimeInput.options)
            ? runtimeInput.options
            : undefined,
        },
        completedNodeTitles,
      };
    default:
      return {
        taskId: input.taskId,
        executionRuntime: input.executionRuntime,
        runtimeInput,
      };
  }
}

async function persistRuntimeHistory(input: {
  runId: string;
  request: OpenClawGatewayRequest;
  response: BridgeResponse;
}): Promise<string[]> {
  try {
    const assistantContent = extractAssistantContent(input.response);
    const history: OpenClawChatHistory = {
      messages: [
        { role: "user", content: extractUserText(input.request) },
        ...(assistantContent
          ? [{ role: "assistant", content: assistantContent }]
          : []),
      ],
    };
    const conversationEntryIds: string[] = [];

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
    }

    return conversationEntryIds;
  } catch {
    return [];
  }
}

function extractAssistantContent(response: BridgeResponse): string | null {
  const output = response.output.trim();
  if (output) return output;

  const parsed = response.structured?.ok ? response.structured.parsed : null;
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.output === "string" && record.output.trim()) {
    return record.output.trim();
  }
  if (typeof record.summary === "string" && record.summary.trim()) {
    return record.summary.trim();
  }

  return JSON.stringify(record);
}

function extractUserText(request: OpenClawGatewayRequest): string {
  const segments = [request.instructions];
  try {
    segments.push(JSON.stringify(request.input, null, 2));
  } catch {
    segments.push(String(request.input));
  }
  return segments.filter(Boolean).join("\n\n");
}
