import { describe, expect, it } from "bun:test";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoEntryTaskPlan,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor concurrency", () => {
  setupPlanRunnerTaskExecutorTest();

  it("does not start the same ready entry twice when execution is triggered concurrently", async () => {
    let releaseProviderRun!: () => void;
    let firstInvocationObserved!: () => void;
    const providerRunCanFinish = new Promise<void>((resolve) => {
      releaseProviderRun = resolve;
    });
    const firstInvocation = new Promise<void>((resolve) => {
      firstInvocationObserved = resolve;
    });
    const invokedNodeIds: string[] = [];
    executeTaskNodeCapabilityMock.mockImplementation(async (input) => {
      invokedNodeIds.push(input.node.id);
      firstInvocationObserved();
      await providerRunCanFinish;
      return {
        status: "started",
        summary: `${input.node.id} runtime run started`,
        evidence: { sessionId: "main-session", runId: `run_${input.node.id}_${invokedNodeIds.length}` },
        output: { runtimeRunRef: `runtime-${input.node.id}-${invokedNodeIds.length}` },
      };
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner duplicate concurrent entry start");
    const compiledPlan = makeTwoEntryTaskPlan("graph_duplicate_concurrent_entry_start");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const firstStart = taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await firstInvocation;
    const secondStart = taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    releaseProviderRun();
    await Promise.all([firstStart, secondStart]);

    expect(invokedNodeIds).toEqual(["first_entry"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_entry", "running"],
    ]);
  });

  it("creates exactly one owner, node attempt, and provider run for overlapping starts", async () => {
    let releaseProviderRun!: () => void;
    let firstInvocationObserved!: () => void;
    const providerRunCanFinish = new Promise<void>((resolve) => {
      releaseProviderRun = resolve;
    });
    const firstInvocation = new Promise<void>((resolve) => {
      firstInvocationObserved = resolve;
    });
    executeTaskNodeCapabilityMock.mockImplementation(async (input) => {
      firstInvocationObserved();
      await providerRunCanFinish;
      return {
        status: "started",
        summary: `${input.node.id} runtime run started`,
        evidence: { sessionId: "main-session", runId: `run_${input.node.id}` },
        output: { runtimeRunRef: `runtime-${input.node.id}` },
      };
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner overlapping start authority");
    const compiledPlan = makeTwoEntryTaskPlan("graph_overlapping_start_authority");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const firstStart = taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await firstInvocation;
    const secondStart = taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    releaseProviderRun();
    await Promise.all([firstStart, secondStart]);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.executionEpoch).toBe(2);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_entry", "running"],
    ]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing running node attempt instead of starting a duplicate provider run", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner duplicate provider run prevention");
    const compiledPlan = makeTwoTaskPlan("graph_duplicate_provider_run_prevention");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "running"],
    ]);
  });

  it("does not start another independent provider branch while one branch is running", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Independent branch runtime run started",
      evidence: { sessionId: "main-session", runId: "run_independent_branch" },
      output: { runtimeRunRef: "runtime-independent-branch" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner serial branch overlap");
    const compiledPlan = makeTwoEntryTaskPlan("graph_serial_branch_overlap");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.filter((attempt) => attempt.status === "running")).toHaveLength(1);
  });

  it("does not leave another entry idle when one entry provider completed before runtime sync", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "Provider returned final output but terminal tool submission failed",
        evidence: { sessionId: "main-session", runId: "run_first_entry" },
        output: {
          runtimeRunRef: "runtime-first-entry",
          outputText: "Chrona 节点结果提交失败：taskId is required. 节点工作本身已完成。",
        },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second entry runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_entry" },
        output: { runtimeRunRef: "runtime-second-entry" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner multiple entry provider completion gap");
    const compiledPlan = makeTwoEntryTaskPlan("graph_two_entry_provider_completion_gap");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(started.status).toBe("running");
    expect(started.currentNodeId).toBe("second_entry");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_entry", "succeeded"],
      ["second_entry", "running"],
    ]);
    expect(persisted?.results.find((result) => result.nodeId === "first_entry")).toMatchObject({
      nodeId: "first_entry",
      status: "current",
      outputSummary: "Provider returned final output but terminal tool submission failed",
    });
    expect(persisted?.graph).not.toBeNull();
    const effective = persisted?.graph
      ? resolveEffectivePlanGraph({
          graph: persisted.graph,
          attempts: persisted.attempts,
          results: persisted.results,
        })
      : null;
    expect(effective?.nodes.find((node) => node.id === "first_entry")?.result).toBeUndefined();
  });
});
