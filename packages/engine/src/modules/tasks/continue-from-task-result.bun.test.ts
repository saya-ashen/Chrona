import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@chrona/db";
import { appendCanonicalEvent } from "../events";
import {
  resetTestDb,
  seedTask,
  seedWorkspace,
} from "../../../../../apps/server/src/__tests__/bun-test-helpers";
import { createTask } from "./create-task";
import type { ContinueFromTaskResultDeps } from "./continue-from-task-result";

const chatRequests: Array<{
  messages: Array<{ role: string; content: string }>;
}> = [];
const chatMock = mock(
  async (
    _client: unknown,
    request: { messages: Array<{ role: string; content: string }> },
  ) => {
    chatRequests.push(request);
    return {
      content: "The accepted result supports three relevant projects.",
      source: "test",
    };
  },
);
const handoffConversationMock = mock(async () => ({
  sessionRef: "provider-session-new",
  handoffText: "Compacted handoff",
}));
const getAiClientForTaskMock = mock(async () => ({
  record: { type: "hermes" },
  providerClient: {
    getConversationCapabilities: () => ({
      resume: true,
      fork: true,
      compact: true,
      handoff: "native" as const,
      contextUsage: "detailed" as const,
    }),
    handoffConversation: handoffConversationMock,
  },
}));
const acceptedContextMock = mock(async (taskId: string) => {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.status !== "Done") {
    throw new Error("Accept the completed task result before continuing from it");
  }
  const run = await db.run.findFirstOrThrow({ where: { taskId, status: "Completed" } });
  const artifacts = await db.artifact.findMany({ where: { taskId, runId: run.id } });
  return {
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      goalId: task.goalId,
      priority: task.priority,
      executionRuntime: task.executionRuntime,
      executionConfig: task.executionConfig as Record<string, unknown>,
      aiClientId: task.aiClientId,
    },
    acceptance: {
      runId: run.id,
      acceptedAt: new Date().toISOString(),
      taskSessionId: run.taskSessionId,
      providerSessionRef: run.runtimeSessionRef,
    },
    summary: "Accepted result summary",
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
    })),
  };
});

import { continueFromTaskResult } from "./continue-from-task-result";

const deps = {
  chat: chatMock,
  getAiClientForTask: getAiClientForTaskMock,
  getAcceptedResultContext: acceptedContextMock,
  createTask,
} as unknown as ContinueFromTaskResultDeps;

async function seedAcceptedTask(title = "Accepted source task") {
  const { workspaceId } = await seedWorkspace("Result continuation");
  const { taskId } = await seedTask(workspaceId, { title, status: "Done" });
  const run = await db.run.create({
    data: {
      taskId,
      runtimeName: "hermes",
      status: "Completed",
      triggeredBy: "test",
      endedAt: new Date(),
    },
  });
  await db.task.update({
    where: { id: taskId },
    data: { status: "Done", latestRunId: run.id },
  });
  await db.artifact.create({
    data: {
      taskId,
      workspaceId,
      title: "Accepted report",
      type: "file",
      uri: ".chrona/outputs/report.json",
      runId: run.id,
    },
  });
  await appendCanonicalEvent({
    eventType: "task.result_accepted",
    workspaceId,
    taskId,
    runId: run.id,
    actorType: "user",
    source: "test",
    payload: { accepted_run_id: run.id },
  });
  return { workspaceId, taskId, runId: run.id };
}

describe("continueFromTaskResult", () => {
  beforeEach(async () => {
    await resetTestDb();
    chatMock.mockClear();
    chatRequests.length = 0;
    getAiClientForTaskMock.mockClear();
    acceptedContextMock.mockClear();
    handoffConversationMock.mockClear();
  });

  it("creates a linked draft that carries accepted result context", async () => {
    const source = await seedAcceptedTask();
    await db.run.update({
      where: { id: source.runId },
      data: { runtimeSessionRef: "provider-session-source" },
    });

    const result = await continueFromTaskResult(
      {
        taskId: source.taskId,
        intent: "create_task",
        instruction: "Compare the top projects and recommend one.",
      },
      deps,
    );

    expect(result).toMatchObject({
      intent: "create_task",
      status: "completed",
      createdTask: {
        title: "Compare the top projects and recommend one.",
      },
    });
    expect(handoffConversationMock).toHaveBeenCalledWith({
      sessionRef: "provider-session-source",
      instructions: expect.stringContaining("Compare the top projects and recommend one."),
    });
    const followUp = await db.task.findUniqueOrThrow({
      where: { id: result.createdTask!.id },
      include: { dependencies: true },
    });
    expect(followUp.status).toBe("Draft");
    expect(followUp.parentTaskId).toBe(source.taskId);
    expect(followUp.autoPlanGeneration).toBe(false);
    expect(followUp.autoExecute).toBe(false);
    expect(followUp.description).toContain("Accepted result summary");
    expect(followUp.description).toContain("Accepted report (file)");
    const followUpSession = await db.taskSession.findFirstOrThrow({
      where: { taskId: followUp.id },
      orderBy: { createdAt: "asc" },
    });
    expect(followUpSession.providerSessionRef).toBe("provider-session-new");
    expect(followUp.dependencies).toContainEqual(
      expect.objectContaining({
        dependsOnTaskId: source.taskId,
        dependencyType: "child_of",
      }),
    );
  });

  it("joins a follow-up to the source Goal", async () => {
    const source = await seedAcceptedTask();
    const sourceTask = await db.task.findUniqueOrThrow({ where: { id: source.taskId } });
    const goal = await db.goal.create({ data: { workspaceId: sourceTask.workspaceId, title: "Long horizon", successCriteria: [], status: "Active" } });
    await db.task.update({ where: { id: source.taskId }, data: { goalId: goal.id } });

    const result = await continueFromTaskResult({ taskId: source.taskId, intent: "create_task", instruction: "Continue bounded work", sessionStrategy: "fresh_with_result" }, deps);
    expect((await db.task.findUniqueOrThrow({ where: { id: result.createdTask!.id } })).goalId).toBe(goal.id);
  });

  it("creates a clean linked draft without invoking provider handoff", async () => {
    const source = await seedAcceptedTask();

    const result = await continueFromTaskResult(
      {
        taskId: source.taskId,
        intent: "create_task",
        instruction: "Summarize the accepted deliverables.",
        sessionStrategy: "fresh_with_result",
      },
      deps,
    );

    expect(result).toMatchObject({ intent: "create_task", status: "completed" });
    expect(handoffConversationMock).not.toHaveBeenCalled();
    const followUpSession = await db.taskSession.findFirstOrThrow({
      where: { taskId: result.createdTask!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(followUpSession.providerSessionRef).toBeNull();
  });

  it("rejects handoff without creating a child when the provider cannot hand off", async () => {
    const source = await seedAcceptedTask();
    await db.run.update({
      where: { id: source.runId },
      data: { runtimeSessionRef: "provider-session-source" },
    });
    const unsupportedDeps = {
      ...deps,
      getAiClientForTask: mock(async () => ({
        record: { type: "unsupported" },
        providerClient: {
          getConversationCapabilities: () => ({
            resume: true,
            fork: false,
            compact: false,
            handoff: "unsupported" as const,
            contextUsage: "none" as const,
          }),
        },
      })),
    } as unknown as ContinueFromTaskResultDeps;

    await expect(
      continueFromTaskResult(
        {
          taskId: source.taskId,
          intent: "create_task",
          instruction: "Start the next task",
        },
        unsupportedDeps,
      ),
    ).rejects.toThrow(/does not support compact handoff/i);
    expect(
      await db.task.count({ where: { parentTaskId: source.taskId } }),
    ).toBe(0);
  });

  it("answers from accepted result context and stores the conversation", async () => {
    const source = await seedAcceptedTask("GitHub Trending");

    const result = await continueFromTaskResult(
      {
        taskId: source.taskId,
        intent: "ask",
        instruction: "Which projects are relevant?",
      },
      deps,
    );

    expect(result).toMatchObject({
      intent: "ask",
      status: "completed",
      answer: "The accepted result supports three relevant projects.",
      answerSource: "test",
      contextSource: "accepted_result_fallback",
    });
    expect(getAiClientForTaskMock).toHaveBeenCalledWith({
      taskId: source.taskId,
      purpose: "task.plan",
    });
    const request = chatRequests[0];
    expect(request?.messages[0]?.content).toContain("Accepted result summary");
    expect(request?.messages[0]?.content).toContain("Accepted report (file)");
    expect(request?.messages.at(-1)).toEqual({
      role: "user",
      content: "Which projects are relevant?",
    });

    const messages = await db.taskResultContinuation.findMany({
      where: { taskId: source.taskId },
      orderBy: { createdAt: "asc" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      intent: "ask",
      status: "completed",
      instruction: "Which projects are relevant?",
      answer: "The accepted result supports three relevant projects.",
    });
  });

  it("rejects continuation before result acceptance", async () => {
    const { workspaceId } = await seedWorkspace("Unaccepted result");
    const { taskId } = await seedTask(workspaceId, {
      title: "Still pending review",
      status: "Completed",
    });
    await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "test",
        endedAt: new Date(),
      },
    });

    await expect(
      continueFromTaskResult(
        {
          taskId,
          intent: "create_task",
          instruction: "Start the next task",
        },
        deps,
      ),
    ).rejects.toThrow(/accept the completed task result/i);
  });
});
