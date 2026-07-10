import { describe, expect, it } from "bun:test";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "../plan-runner.task-executor.fixtures";

describe("duplicate execution regressions", () => {
  setupPlanRunnerTaskExecutorTest();

  it("does not create a second provider attempt when start is retried while the first node is already running", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Duplicate execution regression");
    const compiledPlan = makeTwoTaskPlan("graph_duplicate_execution_regression");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const first = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const second = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "running"],
    ]);
  });

  it("claims one provider attempt when manual starts overlap", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-overlap" },
      output: { runtimeRunRef: "runtime-overlap" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Overlapping start regression");
    const compiledPlan = makeTwoTaskPlan("graph_overlapping_start_regression");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const results = await Promise.all([
      taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } }),
      taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["running", "running"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.filter((attempt) => attempt.nodeId === "first_task")).toHaveLength(1);
  });

  it("claims one provider attempt when manual and scheduler starts race", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-trigger-race" },
      output: { runtimeRunRef: "runtime-trigger-race" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Manual scheduler race regression");
    const compiledPlan = makeTwoTaskPlan("graph_manual_scheduler_race");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const results = await Promise.all([
      taskPlanExecution.start({ taskId: task.id, trigger: "manual" }),
      taskPlanExecution.start({ taskId: task.id, trigger: "scheduler" }),
    ]);

    expect(results).toHaveLength(2);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.filter((attempt) => attempt.nodeId === "first_task")).toHaveLength(1);
  });
});
