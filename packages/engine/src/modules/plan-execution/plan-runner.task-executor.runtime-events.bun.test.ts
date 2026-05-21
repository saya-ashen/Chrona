import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import type { NodeExecutionResult } from "./node-executors/types";
import {
  executeTaskNodeCapabilityMock,
  makeSingleTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor runtime events", () => {
  setupPlanRunnerTaskExecutorTest();

  it("forwards runtime events from task node execution", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      expect(input.mainSession.sessionKey).toBe(
        `chrona:task:${input.taskId}:plan-${input.plan.graphId}`,
      );
      await input.onRuntimeEvent?.({
        type: "text_delta",
        provider: "hermes",
        runId: "hermes-run-1",
        sequence: 0,
        text: "working",
      });
      const activeSession = await db.executionSession.findFirstOrThrow({
        where: { taskId: input.taskId },
        orderBy: { createdAt: "desc" },
      });
      expect(activeSession.currentNodeId).toBe("task_node");
      return {
        status: "started",
        summary: "Hermes run started",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-1" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner forwards runtime event");
    const compiledPlan = makeSingleTaskPlan("graph_task_runtime_event");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const runtimeEvents: unknown[] = [];
    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
      onRuntimeEvent(event) {
        runtimeEvents.push(event);
      },
    });

    expect(result.status).toBe("running");
    expect(result.currentNodeId).toBe("task_node");
    expect(runtimeEvents).toEqual([
      {
        nodeId: "task_node",
        nodeTitle: "Execute mocked task node",
        runtimeName: "openclaw",
        event: {
          type: "text_delta",
          provider: "hermes",
          runId: "hermes-run-1",
          sequence: 0,
          text: "working",
        },
      },
    ]);
    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.currentNodeId).toBe("task_node");
  });
});
