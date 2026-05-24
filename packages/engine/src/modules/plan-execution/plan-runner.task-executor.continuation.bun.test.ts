import { describe, expect, it } from "bun:test";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeIndependentBranchesAfterManualPlan,
  makeInputCheckpointThenTaskPlan,
  makeManualThenTaskPlan,
  makeTwoEntryTaskPlan,
  makeTwoTaskPlan,
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

  it("continues to the downstream task run after submitting checkpoint input", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Specification task complete",
      evidence: { sessionId: "main-session", runId: "run_spec" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner checkpoint input handoff");
    const compiledPlan = makeInputCheckpointThenTaskPlan("graph_checkpoint_input_handoff");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.currentNodeId).toBe("requirements_checkpoint");
    expect(waiting.checkpoint?.kind).toBe("user_input");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(0);

    const submitted = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint?.id ?? "",
        action: "submit_input",
        payload: {
          inputFields: {
            location_scope: "北京",
            output_format: "终端文本",
          },
        },
      },
    });

    expect(submitted.execution.status).toBe("completed");
    expect(submitted.execution.currentNodeId).toBeNull();
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    expect(executeTaskNodeCapabilityMock.mock.calls[0]?.[0].node.id).toBe("spec_task");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["requirements_checkpoint", "obsolete", undefined],
      ["requirements_checkpoint", "current", "Checkpoint completed: Confirm requirements"],
      ["spec_task", "current", "Specification task complete"],
    ]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });

  it("starts the downstream provider run after syncing a completed runtime run", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "started",
        summary: "First runtime run started",
        evidence: { sessionId: "main-session", runId: "run_first" },
        output: { runtimeRunRef: "runtime-first" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second" },
        output: { runtimeRunRef: "runtime-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner runtime sync continuation");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_continuation");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(started.status).toBe("running");
    expect(started.currentNodeId).toBe("first_task");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first",
      status: "Completed",
      summary: "First task complete",
      output: { requirements: "ready" },
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);
    expect(executeTaskNodeCapabilityMock.mock.calls[1]?.[0].node.id).toBe("second_task");

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Active");
    expect(session.currentNodeId).toBe("second_task");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
  });

  it("starts another ready entry node after syncing one completed entry runtime run", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "started",
        summary: "First entry runtime run started",
        evidence: { sessionId: "main-session", runId: "run_first_entry" },
        output: { runtimeRunRef: "runtime-first-entry" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second entry runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_entry" },
        output: { runtimeRunRef: "runtime-second-entry" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner multiple entry continuation");
    const compiledPlan = makeTwoEntryTaskPlan("graph_two_entry_runtime_sync_continuation");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(started.status).toBe("running");
    expect(started.currentNodeId).toBe("first_entry");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-entry",
      status: "Completed",
      summary: "First entry complete",
      output: { architectureFacts: "ready" },
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);
    expect(executeTaskNodeCapabilityMock.mock.calls[1]?.[0].node.id).toBe("second_entry");

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Active");
    expect(session.currentNodeId).toBe("second_entry");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_entry", "succeeded"],
      ["second_entry", "running"],
    ]);
  });

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
    expect(persisted?.executionOwnerId).toBeTruthy();
    expect(persisted?.executionOwnerScope).toBe("manual");
    expect(persisted?.executionEpoch).toBe(1);
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

  it("does not create a provider run for a completed node during resume", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: { runtimeRunRef: "runtime-first-task" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_task" },
        output: { runtimeRunRef: "runtime-second-task" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner completed node resume");
    const compiledPlan = makeTwoTaskPlan("graph_completed_node_resume");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
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
  });

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
      output: { requirements: "ready" },
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
      output: { requirements: "ready" },
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
        output: { runtimeRunRef: "runtime-first-task" },
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
        output: { runtimeRunRef: "runtime-first-task" },
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

  it("records a stale callback without overwriting the effective node result", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "First task complete",
      evidence: { sessionId: "main-session", runId: "run_first_task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner stale callback audit");
    const compiledPlan = makeTwoTaskPlan("graph_stale_callback_audit");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late duplicate first task complete",
      output: { requirements: "late" },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.find((result) => result.nodeId === "first_task")).toMatchObject({
      nodeId: "first_task",
      status: "current",
      outputSummary: "First task complete",
    });

    const staleEvent = await db.event.findFirst({
      where: {
        taskId: task.id,
        eventType: "execution.runtime_sync_ignored",
      },
      orderBy: { ingestSequence: "desc" },
    });
    expect(staleEvent?.payload).toMatchObject({
      planId: compiledPlan.editablePlanId,
      runtimeRunRef: "runtime-first-task",
      reason: "stale_attempt_succeeded",
    });
  });

  it("replaces a completed node result only through explicit retry", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: { runtimeRunRef: "runtime-first-task" },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task retried successfully",
        evidence: { sessionId: "main-session", runId: "run_first_task_retry" },
        output: { runtimeRunRef: "runtime-first-task-retry" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner explicit retry replacement");
    const compiledPlan = makeTwoTaskPlan("graph_explicit_retry_replacement");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "retry_node", nodeId: "first_task", prompt: "Verify updated input" },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["first_task", "obsolete", "First task complete"],
      ["first_task", "current", "First task retried successfully"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "cancelled"],
      ["first_task", "succeeded"],
    ]);
  });

  it("starts only one independent provider branch after manual terminal continuation", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValue({
      status: "started",
      summary: "Independent branch runtime run started",
      evidence: { sessionId: "main-session", runId: "run_independent_branch" },
      output: { runtimeRunRef: "runtime-independent-branch" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner serial terminal continuation branches");
    const compiledPlan = makeIndependentBranchesAfterManualPlan("graph_serial_terminal_continuation_branches");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    await taskPlanExecution.submitNodeResult({
      taskId: task.id,
      action: {
        action: "complete_manual_node",
        summary: "Manual gate complete",
        output: { approved: true },
        selectedBranch: { label: "continue", nextNodeId: "left_task", source: "user" },
      },
    });

    for (let attempt = 0; attempt < 20 && executeTaskNodeCapabilityMock.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    expect(["left_task", "right_task"]).toContain(executeTaskNodeCapabilityMock.mock.calls[0]?.[0].node.id);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.filter((attempt) => attempt.status === "running")).toHaveLength(1);
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
