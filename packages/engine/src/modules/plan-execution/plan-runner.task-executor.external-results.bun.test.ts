import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { NodeExecutionResult } from "./node-executors/types";
import {
  executeTaskNodeCapabilityMock,
  makeSingleTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor external results", () => {
  setupPlanRunnerTaskExecutorTest();

  it("does not let a provider started result overwrite an external node result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const activeSession = await db.executionSession.findFirstOrThrow({
        where: { taskId: input.taskId },
        orderBy: { createdAt: "desc" },
      });
      expect(activeSession.currentNodeId).toBe("task_node");

      const externalResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          summary: "Hermes completed externally",
          output: { source: "hermes" },
        },
      });
      expect(externalResult.status).toBe("completed");

      return {
        status: "started",
        summary: "Hermes run started before external completion was observed",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-stale" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves external result");
    const compiledPlan = makeSingleTaskPlan("graph_task_external_result_race");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("completed");
    expect(result.currentNodeId).toBeNull();

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.planRun.status).toBe("completed");
    expect(persisted?.graph?.status).toBe("completed");
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      outputSummary: "Hermes completed externally",
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]).toMatchObject({
      nodeId: "task_node",
      status: "succeeded",
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.persistedStatus).toBe(TaskStatus.Completed);

    const staleRunningRun = await db.run.create({
      data: {
        taskId: task.id,
        taskSessionId: task.defaultSessionId,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "system",
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const convergedRun = await db.run.findUniqueOrThrow({ where: { id: staleRunningRun.id } });
    expect(convergedRun.status).toBe("Completed");

    const reprojection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(reprojection.persistedStatus).toBe(TaskStatus.Completed);
    expect(reprojection.latestRunStatus).toBe("Completed");

    const events = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
      select: { eventType: true, payload: true },
    });
    const completionIndex = events.findIndex(
      (event) => event.eventType === "plan_execution.execution_completed",
    );
    expect(completionIndex).toBeGreaterThanOrEqual(0);
    expect(
      events.slice(completionIndex + 1).find(
        (event) => event.eventType === "plan_execution.node_started",
      ),
    ).toBeUndefined();
  });

  it("does not let a provider started result overwrite an external blocked result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const externalResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "block_current_node",
          reason: "Hermes blocked externally",
          actionForm: {
            instructions: "Provide missing Hermes credentials.",
            inputFields: [{ name: "hermesToken", label: "Hermes token", type: "text", required: true }],
          },
        },
      });
      expect(externalResult.status).toBe("blocked");

      return {
        status: "started",
        summary: "Hermes run started before external block was observed",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-stale-blocked" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves external block");
    const compiledPlan = makeSingleTaskPlan("graph_task_external_block_race");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("blocked");
    expect(result.currentNodeId).toBe("task_node");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      error: "Hermes blocked externally",
      waitKind: "manual_action",
      actionForm: {
        instructions: "Provide missing Hermes credentials.",
        inputFields: [{ name: "hermesToken", label: "Hermes token", type: "text", required: true }],
      },
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]).toMatchObject({
      nodeId: "task_node",
      status: "failed",
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("task_node");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
  });

  it("persists detailed runtime failure context for a failed task node", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "failed",
      error: "Runtime failed while starting main session run for node task_node: Gateway refused the run",
      evidence: {
        sessionId: "main-session",
        runId: "run_failed",
        runtimeName: "hermes",
        runtimeRunRef: "resp_failed",
      },
      details: {
        nodeId: "task_node",
        nodeTitle: "Execute task",
        runtimeName: "hermes",
        runtimeRunRef: "resp_failed",
        runId: "run_failed",
        errorSummary: "Gateway refused the run",
      },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner preserves failure details");
    const compiledPlan = makeSingleTaskPlan("graph_task_failed_details");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("Gateway refused the run");
    expect(result.errorDetails).toMatchObject({
      runtimeName: "hermes",
      runtimeRunRef: "resp_failed",
      runId: "run_failed",
      errorSummary: "Gateway refused the run",
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts[0]?.error).toMatchObject({
      code: "NODE_FAILED",
      message: expect.stringContaining("Gateway refused the run"),
      details: expect.objectContaining({ runtimeRunRef: "resp_failed" }),
    });
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "rejected",
      error: expect.stringContaining("Gateway refused the run"),
      errorDetails: expect.objectContaining({ runtimeName: "hermes" }),
    });
  });

  it("ignores late node result reports after execution completed", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Task completed",
      evidence: { sessionId: "main-session", runId: "run_complete" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner late node result");
    const compiledPlan = makeSingleTaskPlan("graph_late_node_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const completed = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(completed.status).toBe("completed");

    const lateBlocked = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "block_current_node",
        reason: "MCP session binding fallback after verified completion",
      },
    });

    expect(lateBlocked.status).toBe("completed");
    expect(lateBlocked.message).toBe("Execution already completed; node result ignored.");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.error])).toEqual([
      ["task_node", "current", undefined],
    ]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
    expect(updatedTask.blockReason).toBeNull();
  });
});
