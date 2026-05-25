import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import { syncPlanRunRuntimeResult } from "./sync-plan-run-runtime-result";
import {
  executeTaskNodeCapabilityMock,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "../../plan-runner.task-executor.fixtures";

describe("syncPlanRunRuntimeResult", () => {
  setupPlanRunnerTaskExecutorTest();

  it("ignores unknown runtime run refs without mutating active attempts", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Runtime sync unknown ref");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_unknown_ref");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });

    await syncPlanRunRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-missing",
      status: "Completed",
      summary: "Missing run complete",
      output: { ignored: true },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "running"],
    ]);
    expect(persisted?.results).toHaveLength(0);
    expect(await db.event.count({ where: { taskId: task.id, eventType: "execution.runtime_sync_ignored" } })).toBe(0);
  });

  it("records stale completed attempt callbacks without overwriting current results", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "started",
        summary: "First runtime run started",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: { runtimeRunRef: "runtime-first-task" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_task" },
        output: { runtimeRunRef: "runtime-second-task" },
      });
    const { workspace, task } = await seedWorkspaceAndTask("Runtime sync stale completed");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_stale_completed");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });

    await syncPlanRunRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "First task complete",
      output: { requirements: "ready" },
    });

    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);

    await syncPlanRunRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late duplicate first task complete",
      output: { ignored: true },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["first_task", "current", "First task complete"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
    const event = await db.event.findFirstOrThrow({
      where: { taskId: task.id, eventType: "execution.runtime_sync_ignored" },
    });
    expect(event.payload).toMatchObject({
      planId: compiledPlan.editablePlanId,
      runtimeRunRef: "runtime-first-task",
      reason: "stale_attempt_succeeded",
    });
  });

  it("ignores a valid running attempt when no active execution session remains", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });
    const { workspace, task } = await seedWorkspaceAndTask("Runtime sync no active session");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_no_active_session");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
    await db.executionSession.updateMany({
      where: { taskId: task.id, status: "Active" },
      data: { status: "Abandoned", completedAt: new Date("2026-05-24T00:00:00.000Z") },
    });

    await syncPlanRunRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "First task complete after session closed",
      output: { ignored: true },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "running"],
    ]);
    const event = await db.event.findFirstOrThrow({
      where: { taskId: task.id, eventType: "execution.runtime_sync_ignored" },
    });
    expect(event.payload).toMatchObject({ reason: "no_active_execution_session" });
  });

  it("applies a completed runtime run and advances downstream work through the latest active session", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "started",
        summary: "First runtime run started",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: { runtimeRunRef: "runtime-first-task" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_task" },
        output: { runtimeRunRef: "runtime-second-task" },
      });
    const { workspace, task } = await seedWorkspaceAndTask("Runtime sync active session");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_active_session");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: compiledPlan.editablePlanId,
        status: "Active",
        currentNodeId: "manual-active-session",
      },
    });

    await syncPlanRunRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "First task complete",
      output: { requirements: "ready" },
    });

    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
    expect(persisted?.results.find((result) => result.nodeId === "first_task")).toMatchObject({
      status: "current",
      outputSummary: "First task complete",
    });
    const activeSessions = await db.executionSession.findMany({
      where: { taskId: task.id, status: "Active" },
      orderBy: { createdAt: "asc" },
    });
    expect(activeSessions.at(-1)?.currentNodeId).toBe("second_task");
  });
});
