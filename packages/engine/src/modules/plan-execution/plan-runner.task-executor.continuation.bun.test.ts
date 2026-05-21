import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeManualThenTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor continuation", () => {
  setupPlanRunnerTaskExecutorTest();

  it("submits terminal node results before continuing downstream execution", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Automatic follow-up complete",
      evidence: { sessionId: "main-session", runId: "run_auto" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner nonblocking node result");
    const compiledPlan = makeManualThenTaskPlan("graph_nonblocking_node_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.currentNodeId).toBe("manual_task");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(0);

    const submitted = await taskPlanExecution.submitNodeResult({
      taskId: task.id,
      action: {
        action: "complete_manual_node",
        summary: "Manual task complete",
        output: { ok: true },
        selectedBranch: { label: "continue", nextNodeId: "auto_task", source: "user" },
      },
    });

    expect(submitted.status).toBe("running");
    expect(submitted.currentNodeId).toBeNull();
    expect(submitted.message).toBe("External result accepted. Continuation pending.");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(0);

    for (let attempt = 0; attempt < 20 && executeTaskNodeCapabilityMock.mock.calls.length === 0; attempt += 1) {
      if (executeTaskNodeCapabilityMock.mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["manual_task", "obsolete", undefined],
      ["manual_task", "current", "Manual task complete"],
      ["auto_task", "current", "Automatic follow-up complete"],
    ]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });
});
