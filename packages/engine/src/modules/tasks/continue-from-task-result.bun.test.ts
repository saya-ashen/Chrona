import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@chrona/db";
import {
  resetTestDb,
  seedTask,
  seedWorkspace,
} from "../../../../../apps/server/src/__tests__/bun-test-helpers";
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
const getAiClientForTaskMock = mock(async () => ({
  record: { type: "hermes" },
  providerClient: {},
}));
const getCurrentExecutionMock = mock(async () => ({
  planOutput: {
    spec: {
      root: "root",
      elements: {
        root: { type: "Text", props: { text: "Accepted result summary" } },
      },
    },
  },
}));

import { continueFromTaskResult } from "./continue-from-task-result";

const deps = {
  chat: chatMock,
  getAiClientForTask: getAiClientForTaskMock,
  getCurrentExecution: getCurrentExecutionMock,
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
  return { workspaceId, taskId, runId: run.id };
}

describe("continueFromTaskResult", () => {
  beforeEach(async () => {
    await resetTestDb();
    chatMock.mockClear();
    chatRequests.length = 0;
    getAiClientForTaskMock.mockClear();
    getCurrentExecutionMock.mockClear();
  });

  it("creates a linked draft that carries accepted result context", async () => {
    const source = await seedAcceptedTask();

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
      parentTaskId: source.taskId,
      title: "Compare the top projects and recommend one.",
    });
    const followUp = await db.task.findUniqueOrThrow({
      where: { id: result.taskId },
      include: { dependencies: true },
    });
    expect(followUp.status).toBe("Draft");
    expect(followUp.parentTaskId).toBe(source.taskId);
    expect(followUp.autoPlanGeneration).toBe(false);
    expect(followUp.autoExecute).toBe(false);
    expect(followUp.description).toContain("Accepted result summary");
    expect(followUp.description).toContain("Accepted report (file)");
    expect(followUp.dependencies).toContainEqual(
      expect.objectContaining({
        dependsOnTaskId: source.taskId,
        dependencyType: "child_of",
      }),
    );
  });

  it("answers from accepted result context and stores the conversation", async () => {
    const source = await seedAcceptedTask("GitHub Trending");

    const result = await continueFromTaskResult(
      {
        taskId: source.taskId,
        intent: "ask",
        instruction: "Which projects are relevant?",
        history: [],
      },
      deps,
    );

    expect(result).toEqual({
      intent: "ask",
      answer: "The accepted result supports three relevant projects.",
      source: "test",
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

    const messages = await db.taskAssistantMessage.findMany({
      where: { taskId: source.taskId },
      orderBy: { sequence: "asc" },
    });
    expect(
      messages.map(({ role, content, sequence }) => ({
        role,
        content,
        sequence,
      })),
    ).toEqual([
      { role: "user", content: "Which projects are relevant?", sequence: 1 },
      {
        role: "assistant",
        content: "The accepted result supports three relevant projects.",
        sequence: 2,
      },
    ]);
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
