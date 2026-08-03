import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
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
        `chrona:task:${input.taskId}:execute:${input.plan.graphId}`,
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
        executionScope: expect.any(String),
        nodeId: "task_node",
        nodeTitle: "Execute mocked task node",
        runtimeName: "hermes",
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

  it("propagates accepted plan work block scope into execution records", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async () => ({
      status: "started",
      summary: "Hermes run started",
      evidence: { runtimeRunRef: "hermes-run-scoped" },
      output: { runtimeRunRef: "hermes-run-scoped" },
    } satisfies NodeExecutionResult));

    const { workspace, task } = await seedWorkspaceAndTask("Runner scoped work block events");
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: "Scoped execution occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-08T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    const compiledPlan = makeSingleTaskPlan("graph_task_scoped_runtime_event");
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: workBlock.id,
      compiledPlan,
      status: "accepted",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "plan-runner-task-executor-test",
    });

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    const session = await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } });
    expect(session.workBlockId).toBe(workBlock.id);
    const event = await db.event.findFirstOrThrow({ where: { taskId: task.id } });
    expect(event.workBlockId).toBe(workBlock.id);
    const timelineItem = await db.taskTimelineItem.findFirstOrThrow({ where: { taskId: task.id } });
    expect(timelineItem.workBlockId).toBe(workBlock.id);
  });
});
