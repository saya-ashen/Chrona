import { describe, expect, it } from "bun:test";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoEntryTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "../plan-runner.task-executor.fixtures";

describe("serial branch result regressions", () => {
  setupPlanRunnerTaskExecutorTest();

  it("persists the first entry result before serially starting the next ready branch", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First branch finished before runtime sync",
        evidence: { sessionId: "main-session", runId: "run-first-entry" },
        output: {
          root: "root",
          elements: {
            root: { type: "Markdown", props: { content: "first branch output" } },
          },
        },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second branch started",
        evidence: { sessionId: "main-session", runId: "run-second-entry" },
        output: { runtimeRunRef: "runtime-second-entry" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Serial branch result regression");
    const compiledPlan = makeTwoEntryTaskPlan("graph_serial_branch_result_regression");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    expect(result.currentNodeId).toBe("second_entry");
    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_entry",
      "second_entry",
    ]);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_entry", "succeeded"],
      ["second_entry", "running"],
    ]);
    expect(persisted?.results.map((branchResult) => [branchResult.nodeId, branchResult.status, branchResult.outputSummary])).toEqual([
      ["first_entry", "current", "First branch finished before runtime sync"],
    ]);
  });
});
