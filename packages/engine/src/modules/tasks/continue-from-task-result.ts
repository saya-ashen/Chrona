import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { chat } from "@/modules/ai/feature-normalizers";
import { getAiClientForTask } from "@/modules/ai/runtime/client-resolution";
import type { ChatMessage } from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { createTask } from "./create-task";
import {
  getAcceptedResultContext,
  type AcceptedResultContext,
} from "./accepted-result-context";

type ContinueFromTaskResultInput = {
  taskId: string;
  requestId?: string;
  instruction: string;
  intent: "ask" | "create_task";
  sessionStrategy?: "fork_source_session" | "fresh_with_result";
};

export type ContinueFromTaskResultDeps = {
  chat: typeof chat;
  getAiClientForTask: typeof getAiClientForTask;
  getAcceptedResultContext: typeof getAcceptedResultContext;
  createTask: typeof createTask;
};

const DEFAULT_DEPS: ContinueFromTaskResultDeps = {
  chat,
  getAiClientForTask,
  getAcceptedResultContext,
  createTask,
};

const FOLLOW_UP_TITLE_LIMIT = 120;

function followUpTitle(instruction: string) {
  const firstLine = instruction.split(/\r?\n/, 1)[0]?.trim() || instruction.trim();
  return firstLine.length <= FOLLOW_UP_TITLE_LIMIT
    ? firstLine
    : `${firstLine.slice(0, FOLLOW_UP_TITLE_LIMIT - 1).trimEnd()}…`;
}

function artifactContext(context: AcceptedResultContext) {
  return context.artifacts.length
    ? context.artifacts
        .map((artifact) =>
          `- ${artifact.title} (${artifact.type})${artifact.uri ? `: ${artifact.uri}` : ""}`,
        )
        .join("\n")
    : "No deliverables were attached.";
}

function resultFollowUpPrompt(
  context: AcceptedResultContext,
  instruction: string,
) {
  return [
    "The Chrona task result has been accepted. Continue the existing conversation and answer the user's follow-up question.",
    "Do not change the accepted result, task, plan, execution, files, or artifacts.",
    "Do not call execution lifecycle or mutation tools. If the request requires new work, tell the user to create a next task.",
    "Use the accepted result below as the authoritative final outcome. You may use prior session context to explain process and reasoning.",
    "State clearly when neither the accepted result nor the existing conversation contains the answer.",
    "Respond in the same language as the user's question.",
    "",
    `Source task: ${context.task.title}`,
    `Accepted run: ${context.acceptance.runId}`,
    "",
    "Accepted result:",
    context.summary,
    "",
    "Deliverables:",
    artifactContext(context),
    "",
    "User follow-up:",
    instruction,
  ].join("\n");
}

function fallbackSystemContext(context: AcceptedResultContext) {
  return [
    "Answer questions about the accepted Chrona task result below.",
    "Use only the supplied accepted result, deliverables, and follow-up history.",
    "State clearly when the context does not contain an answer.",
    "Do not claim to run tools, alter the accepted task, or create a new task.",
    "Respond in the same language as the user's question.",
    "",
    `Source task: ${context.task.title}`,
    `Accepted run: ${context.acceptance.runId}`,
    "",
    "Accepted result:",
    context.summary,
    "",
    "Deliverables:",
    artifactContext(context),
  ].join("\n");
}

async function fallbackHistory(taskId: string, acceptedRunId: string) {
  const entries = await db.taskResultContinuation.findMany({
    where: {
      taskId,
      acceptedRunId,
      intent: "ask",
      status: "completed",
      answer: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { instruction: true, answer: true },
  });
  return entries.reverse().flatMap((entry) => [
    { role: "user" as const, content: entry.instruction },
    { role: "assistant" as const, content: entry.answer ?? "" },
  ]);
}

function continuationResponse(entry: {
  id: string;
  requestId: string;
  acceptedRunId: string;
  intent: string;
  status: string;
  instruction: string;
  answer: string | null;
  answerSource: string | null;
  contextSource: string | null;
  sessionStrategy: string | null;
  createdTaskId: string | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}, createdTask?: { id: string; title: string } | null) {
  return {
    id: entry.id,
    requestId: entry.requestId,
    acceptedRunId: entry.acceptedRunId,
    intent: entry.intent as "ask" | "create_task",
    status: entry.status as "pending" | "completed" | "failed",
    instruction: entry.instruction,
    answer: entry.answer,
    answerSource: entry.answerSource,
    contextSource: entry.contextSource as
      | "source_session"
      | "accepted_result_fallback"
      | null,
    sessionStrategy: entry.sessionStrategy as
      | "fork_source_session"
      | "fresh_with_result"
      | null,
    createdTask: createdTask ?? null,
    cache: {
      readInputTokens: entry.cacheReadInputTokens,
      creationInputTokens: entry.cacheCreationInputTokens,
    },
    error: entry.errorMessage,
    createdAt: entry.createdAt.toISOString(),
    completedAt: entry.completedAt?.toISOString() ?? null,
  };
}

async function existingResponse(taskId: string, requestId: string) {
  const entry = await db.taskResultContinuation.findUnique({
    where: { taskId_requestId: { taskId, requestId } },
  });
  if (!entry) return null;
  const createdTask = entry.createdTaskId
    ? await db.task.findUnique({
        where: { id: entry.createdTaskId },
        select: { id: true, title: true },
      })
    : null;
  return continuationResponse(entry, createdTask);
}

function isSessionUnavailable(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /session.*(not found|missing|unavailable|cannot|can't|invalid)|ENOENT/i.test(message);
}

async function answerFollowUp(input: {
  context: AcceptedResultContext;
  instruction: string;
  deps: ContinueFromTaskResultDeps;
}) {
  const client = await input.deps.getAiClientForTask({
    taskId: input.context.task.id,
    purpose: "task.plan",
  });
  if (!client) {
    throw new EngineError(
      ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND,
      "No AI client is configured for this task",
    );
  }

  const providerSessionRef = input.context.acceptance.providerSessionRef;
  if (client.providerClient?.runConversationTurn && providerSessionRef) {
    try {
      const response = await client.providerClient.runConversationTurn({
        sessionRef: providerSessionRef,
        prompt: resultFollowUpPrompt(input.context, input.instruction),
        mode: "resume",
        toolPolicy: "result_follow_up",
      });
      return {
        answer: response.outputText,
        source: client.record.type,
        contextSource: "source_session" as const,
        providerSessionRef: response.sessionRef,
        usage: response.usage ?? null,
      };
    } catch (cause) {
      if (!isSessionUnavailable(cause)) throw cause;
    }
  }

  const history: ChatMessage[] = await fallbackHistory(
    input.context.task.id,
    input.context.acceptance.runId,
  );
  const response = await input.deps.chat(client, {
    messages: [
      { role: "system", content: fallbackSystemContext(input.context) },
      ...history,
      { role: "user", content: input.instruction },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
  });
  return {
    answer: response.content,
    source: response.source,
    contextSource: "accepted_result_fallback" as const,
    providerSessionRef: null,
    usage: null,
  };
}

async function createNextTask(input: {
  context: AcceptedResultContext;
  instruction: string;
  sessionStrategy: "fork_source_session" | "fresh_with_result";
  deps: ContinueFromTaskResultDeps;
}) {
  const created = await input.deps.createTask({
    workspaceId: input.context.task.workspaceId,
    title: followUpTitle(input.instruction),
    description: [
      `Continue from the accepted result of “${input.context.task.title}”.`,
      "",
      "Next task:",
      input.instruction,
      "",
      `Accepted run: ${input.context.acceptance.runId}`,
      `Accepted at: ${input.context.acceptance.acceptedAt}`,
      "",
      "Accepted result:",
      input.context.summary,
      "",
      "Deliverables:",
      artifactContext(input.context),
    ].join("\n").slice(0, 10_000),
    priority: input.context.task.priority,
    executionRuntime: input.context.task.executionRuntime,
    executionConfig: input.context.task.executionConfig,
    aiClientId: input.context.task.aiClientId,
    parentTaskId: input.context.task.id,
    autoPlanGeneration: false,
    autoExecute: false,
  });

  let providerSessionRef: string | null = null;
  if (
    input.sessionStrategy === "fork_source_session" &&
    input.context.acceptance.providerSessionRef
  ) {
    const client = await input.deps.getAiClientForTask({
      taskId: input.context.task.id,
      purpose: "task.plan",
    });
    if (client?.providerClient?.runConversationTurn) {
      try {
        const fork = await client.providerClient.runConversationTurn({
          sessionRef: input.context.acceptance.providerSessionRef,
          mode: "fork",
          toolPolicy: "result_follow_up",
          prompt: [
            "This conversation is now the context branch for a new Chrona task.",
            "Do not perform the task yet. Retain the source context and wait for the new task plan/execution prompt.",
            `New task: ${input.instruction}`,
          ].join("\n"),
        });
        providerSessionRef = fork.sessionRef;
      } catch (cause) {
        if (!isSessionUnavailable(cause)) throw cause;
      }
    }
  }

  const targetSession = await db.taskSession.findFirst({
    where: { taskId: created.taskId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (providerSessionRef && targetSession) {
    await db.taskSession.update({
      where: { id: targetSession.id },
      data: { providerSessionRef },
    });
  }

  return {
    taskId: created.taskId,
    workspaceId: created.workspaceId,
    parentTaskId: input.context.task.id,
    title: followUpTitle(input.instruction),
    providerSessionRef,
  };
}

export async function continueFromTaskResult(
  input: ContinueFromTaskResultInput,
  deps: ContinueFromTaskResultDeps = DEFAULT_DEPS,
) {
  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Follow-up instruction is required",
    );
  }
  const requestId = input.requestId ?? randomUUID();
  const existing = await existingResponse(input.taskId, requestId);
  if (existing) return existing;

  const context = await deps.getAcceptedResultContext(input.taskId);
  const sessionStrategy =
    input.intent === "create_task"
      ? input.sessionStrategy ?? "fork_source_session"
      : null;
  const pending = await db.taskResultContinuation.create({
    data: {
      taskId: input.taskId,
      acceptedRunId: context.acceptance.runId,
      requestId,
      intent: input.intent,
      status: "pending",
      instruction,
      sourceTaskSessionId: context.acceptance.taskSessionId,
      providerSessionRef: context.acceptance.providerSessionRef,
      sessionStrategy,
    },
  });

  try {
    if (input.intent === "create_task") {
      const result = await createNextTask({
        context,
        instruction,
        sessionStrategy: sessionStrategy ?? "fork_source_session",
        deps,
      });
      const completed = await db.taskResultContinuation.update({
        where: { id: pending.id },
        data: {
          status: "completed",
          createdTaskId: result.taskId,
          providerSessionRef: result.providerSessionRef,
          completedAt: new Date(),
        },
      });
      return continuationResponse(completed, {
        id: result.taskId,
        title: result.title,
      });
    }

    const result = await answerFollowUp({ context, instruction, deps });
    const completed = await db.taskResultContinuation.update({
      where: { id: pending.id },
      data: {
        status: "completed",
        answer: result.answer,
        answerSource: result.source,
        contextSource: result.contextSource,
        providerSessionRef: result.providerSessionRef,
        cacheReadInputTokens: result.usage?.cacheReadInputTokens,
        cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
        completedAt: new Date(),
      },
    });
    return continuationResponse(completed);
  } catch (cause) {
    await db.taskResultContinuation.update({
      where: { id: pending.id },
      data: {
        status: "failed",
        errorCode: cause instanceof EngineError ? cause.code : "internal",
        errorMessage: cause instanceof Error ? cause.message : String(cause),
        completedAt: new Date(),
      },
    });
    throw cause;
  }
}

export async function getTaskResultFollowUpState(taskId: string) {
  const context = await getAcceptedResultContext(taskId);
  const client = await getAiClientForTask({ taskId, purpose: "task.plan" });
  const capabilities = client?.providerClient?.getConversationCapabilities?.();
  let available = Boolean(
    context.acceptance.providerSessionRef &&
      capabilities?.resume &&
      client?.providerClient?.runConversationTurn,
  );
  let health: "fresh" | "moderate" | "high" | "compacted" | "unavailable" | "unknown" =
    available ? "unknown" : "unavailable";
  if (
    available &&
    context.acceptance.providerSessionRef &&
    client?.providerClient?.inspectConversation
  ) {
    const state = await client.providerClient.inspectConversation(
      context.acceptance.providerSessionRef,
    );
    available = state.available;
    if (!state.available) health = "unavailable";
    else if (state.compacted) health = "compacted";
    else if (state.contextTokens && state.contextWindow) {
      const pressure = state.contextTokens / state.contextWindow;
      health = pressure >= 0.75 ? "high" : pressure >= 0.5 ? "moderate" : "fresh";
    }
  }

  const entries = await db.taskResultContinuation.findMany({
    where: { taskId, acceptedRunId: context.acceptance.runId },
    orderBy: { createdAt: "asc" },
  });
  const createdTaskIds = entries
    .map((entry) => entry.createdTaskId)
    .filter((id): id is string => Boolean(id));
  const createdTasks = createdTaskIds.length
    ? await db.task.findMany({
        where: { id: { in: createdTaskIds } },
        select: { id: true, title: true },
      })
    : [];
  const createdById = new Map(createdTasks.map((task) => [task.id, task]));

  return {
    acceptedRunId: context.acceptance.runId,
    acceptedAt: context.acceptance.acceptedAt,
    sourceSession: {
      available,
      provider: client?.record.type ?? context.task.executionRuntime,
      health,
      supportsFork: Boolean(available && capabilities?.fork),
      supportsResume: Boolean(available && capabilities?.resume),
    },
    entries: entries.map((entry) =>
      continuationResponse(
        entry,
        entry.createdTaskId ? createdById.get(entry.createdTaskId) : null,
      ),
    ),
  };
}
