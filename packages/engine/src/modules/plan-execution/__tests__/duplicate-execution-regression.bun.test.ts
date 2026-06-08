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
});
