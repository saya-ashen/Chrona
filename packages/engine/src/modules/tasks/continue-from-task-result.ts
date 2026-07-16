import { db } from "@/lib/db";
import { chat } from "@/modules/ai/feature-normalizers";
import { getAiClientForTask } from "@/modules/ai/runtime/client-resolution";
import { getCurrentExecution } from "@/modules/plan-execution/use-cases/get-current-execution";
import type { ChatMessage } from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { createTask } from "./create-task";

type FollowUpHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ContinueFromTaskResultInput = {
  taskId: string;
  instruction: string;
  intent: "ask" | "create_task";
  history?: FollowUpHistoryMessage[];
};

export type ContinueFromTaskResultDeps = {
  chat: typeof chat;
  getAiClientForTask: typeof getAiClientForTask;
  getCurrentExecution: typeof getCurrentExecution;
};

const DEFAULT_DEPS: ContinueFromTaskResultDeps = {
  chat,
  getAiClientForTask,
  getCurrentExecution,
};

const RESULT_CONTEXT_LIMIT = 7_000;
const FOLLOW_UP_TITLE_LIMIT = 120;

function compactResultContext(value: unknown) {
  const serialized = JSON.stringify(value, null, 2);
  if (!serialized) return "No structured result content was available.";
  if (serialized.length <= RESULT_CONTEXT_LIMIT) return serialized;
  return `${serialized.slice(0, RESULT_CONTEXT_LIMIT)}\n…`;
}

function followUpTitle(instruction: string) {
  const firstLine =
    instruction.split(/\r?\n/, 1)[0]?.trim() || instruction.trim();
  return firstLine.length <= FOLLOW_UP_TITLE_LIMIT
    ? firstLine
    : `${firstLine.slice(0, FOLLOW_UP_TITLE_LIMIT - 1).trimEnd()}…`;
}

async function acceptedResultContext(
  taskId: string,
  deps: ContinueFromTaskResultDeps,
) {
  const execution = await deps.getCurrentExecution({ taskId });
  return compactResultContext(
    execution.planOutput?.spec ?? execution.planOutput,
  );
}

async function persistConversation(input: {
  taskId: string;
  instruction: string;
  response: string;
}) {
  await db.$transaction(async (tx) => {
    const latest = await tx.taskAssistantMessage.findFirst({
      where: { taskId: input.taskId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const firstSequence = (latest?.sequence ?? 0) + 1;
    await tx.taskAssistantMessage.createMany({
      data: [
        {
          taskId: input.taskId,
          role: "user",
          content: input.instruction,
          sequence: firstSequence,
        },
        {
          taskId: input.taskId,
          role: "assistant",
          content: input.response,
          sequence: firstSequence + 1,
        },
      ],
    });
  });
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

  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      status: true,
      priority: true,
      executionRuntime: true,
      executionConfig: true,
      aiClientId: true,
      artifacts: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { title: true, type: true, uri: true },
      },
    },
  });
  const latestRun = task
    ? await db.run.findFirst({
        where: { taskId: task.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      })
    : null;

  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  if (task.status !== "Done" || latestRun?.status !== "Completed") {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Accept the completed task result before continuing from it",
    );
  }

  const resultContext = await acceptedResultContext(task.id, deps);
  const artifactContext = task.artifacts.length
    ? task.artifacts
        .map(
          (artifact) =>
            `- ${artifact.title} (${artifact.type})${artifact.uri ? `: ${artifact.uri}` : ""}`,
        )
        .join("\n")
    : "No deliverables were attached.";

  if (input.intent === "create_task") {
    const description = [
      `Continue from the accepted result of “${task.title}” (${task.id}).`,
      "",
      "Next task:",
      instruction,
      "",
      "Accepted result context:",
      resultContext,
      "",
      "Source deliverables:",
      artifactContext,
    ].join("\n");
    const created = await createTask({
      workspaceId: task.workspaceId,
      title: followUpTitle(instruction),
      description: description.slice(0, 10_000),
      priority: task.priority,
      executionRuntime: task.executionRuntime,
      executionConfig: task.executionConfig as Record<string, unknown>,
      aiClientId: task.aiClientId,
      parentTaskId: task.id,
      autoPlanGeneration: false,
      autoExecute: false,
    });

    return {
      intent: "create_task" as const,
      taskId: created.taskId,
      workspaceId: created.workspaceId,
      parentTaskId: task.id,
      title: followUpTitle(instruction),
    };
  }
  const client = await deps.getAiClientForTask({
    taskId: task.id,
    purpose: "task.plan",
  });
  if (!client) {
    throw new EngineError(
      ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND,
      "No AI client is configured for this task",
    );
  }

  const history: ChatMessage[] = (input.history ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const response = await deps.chat(client, {
    messages: [
      {
        role: "system",
        content: [
          "Answer questions about the accepted Chrona task result below.",
          "Use only the supplied result and deliverable context. State clearly when the context does not contain an answer.",
          "Do not claim to run tools, alter the accepted task, or create a new task.",
          "Respond in the same language as the user's question.",
          "",
          `Source task: ${task.title} (${task.id})`,
          `Accepted run: ${latestRun.id}`,
          "",
          "Accepted result:",
          resultContext,
          "",
          "Deliverables:",
          artifactContext,
        ].join("\n"),
      },
      ...history,
      { role: "user", content: instruction },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
  });

  await persistConversation({
    taskId: task.id,
    instruction,
    response: response.content,
  });

  return {
    intent: "ask" as const,
    answer: response.content,
    source: response.source,
  };
}
