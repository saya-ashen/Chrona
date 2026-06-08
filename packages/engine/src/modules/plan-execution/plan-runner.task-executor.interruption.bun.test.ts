import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeSingleTaskPlan,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

function jsonViewOutput(value: Record<string, unknown>) {
  return { root: "root", elements: { root: { type: "JsonView", props: { value } } } };
}

describe("plan-runner task executor interruption", () => {
  setupPlanRunnerTaskExecutorTest();

  it("does not resume execution from a late provider callback after pause", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner pause ignores late callback");
    const compiledPlan = makeTwoTaskPlan("graph_pause_ignores_late_callback");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "pause_session", reason: "Pause requested" },
    });

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late first task complete",
      output: jsonViewOutput({ requirements: "ready" }),
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const session = await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } });
    expect(session.status).toBe("Paused");
  });

  it("does not start downstream work from a late provider callback after stop", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner stop ignores late callback");
    const compiledPlan = makeTwoTaskPlan("graph_stop_ignores_late_callback");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "cancel_session", reason: "Stop requested" },
    });

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late first task complete",
      output: jsonViewOutput({ requirements: "ready" }),
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "cancelled"],
    ]);
  });

  it("preserves completed node results after stop", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: jsonViewOutput({ runtimeRunRef: "runtime-first-task" }),
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_task" },
        output: { runtimeRunRef: "runtime-second-task" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner stop preserves completed results");
    const compiledPlan = makeTwoTaskPlan("graph_stop_preserves_completed_results");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "cancel_session", reason: "Stop requested" },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["first_task", "current", "First task complete"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "cancelled"],
    ]);
  });

  it("keeps a completed node result stable through downstream pause and stop", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: jsonViewOutput({ runtimeRunRef: "runtime-first-task" }),
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_task" },
        output: { runtimeRunRef: "runtime-second-task" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner stable result through downstream interruption");
    const compiledPlan = makeTwoTaskPlan("graph_stable_result_downstream_interruption");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "pause_session", reason: "Review before continuing" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "cancel_session", reason: "Stop after review" },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["first_task", "current", "First task complete"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "cancelled"],
    ]);
  });

  it("replaces a completed node result only through explicit retry", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: jsonViewOutput({ runtimeRunRef: "runtime-first-task" }),
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task retried successfully",
        evidence: { sessionId: "main-session", runId: "run_first_task_retry" },
        output: jsonViewOutput({ runtimeRunRef: "runtime-first-task-retry" }),
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner explicit retry replacement");
    const compiledPlan = makeSingleTaskPlan("graph_explicit_retry_replacement");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "retry_node", nodeId: "task_node", prompt: "Verify updated input" },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.find((result) => result.nodeId === "task_node" && result.status === "obsolete") ?? null).toMatchObject({
      nodeId: "task_node",
      status: "obsolete",
      outputSummary: "First task complete",
    });
    expect(persisted?.results.find((result) => result.nodeId === "task_node" && result.status === "current") ?? null).toMatchObject({
      nodeId: "task_node",
      status: "current",
      outputSummary: "First task retried successfully",
    });
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["task_node", "cancelled"],
      ["task_node", "succeeded"],
    ]);
  });
});
