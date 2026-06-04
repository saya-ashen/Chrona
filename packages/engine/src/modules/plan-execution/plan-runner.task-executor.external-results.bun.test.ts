import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CompiledPlan, ConditionConfig, TaskConfig } from "@chrona/contracts/ai";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { NodeExecutionResult } from "./node-executors/types";
import { buildSemanticRefHistory } from "./node-runtime-refs";
import {
  executeTaskNodeCapabilityMock,
  evaluateConditionNodeCapabilityMock,
  makeManualThenTaskPlan,
  makeSingleTaskPlan,
  makeTwoTaskPlan,
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

      const submittedResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          summary: "Hermes completed externally",
          output: { source: "hermes" },
        },
      });
      expect(submittedResult.status).toBe("completed");

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

    const eventsBeforeReplay = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
      select: { eventType: true, payload: true },
    });
    const completionIndex = eventsBeforeReplay.findIndex(
      (event) => event.eventType === "plan_execution.execution_completed",
    );
    expect(completionIndex).toBeGreaterThanOrEqual(0);
    const attemptCountBeforeReplay = await db.taskPlanNodeAttempt.count({
      where: { taskId: task.id, nodeId: "task_node" },
    });
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const attemptCountAfterReplay = await db.taskPlanNodeAttempt.count({
      where: { taskId: task.id, nodeId: "task_node" },
    });
    expect(attemptCountAfterReplay).toBe(attemptCountBeforeReplay);
  });

  it("accumulates chrona_node_output outputs into the completed node result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const firstAppend = await taskPlanExecution.submitNodeResult({
        taskId: input.taskId,
        action: {
          action: "submit_node_output",
          sessionId: input.mainSession.id,
          mode: "append",
          outputs: [{ kind: "markdown", content: "Partial output one", title: "Step 1" }],
        },
      });
      expect(firstAppend.status).toBe("running");

      await taskPlanExecution.submitNodeResult({
        taskId: input.taskId,
        action: {
          action: "submit_node_output",
          sessionId: input.mainSession.id,
          mode: "append",
          outputs: [{ kind: "json", value: { score: 42 }, title: "Step 2" }],
        },
      });

      // Completion carries no inline output — outputs were submitted separately
      // via chrona_node_output and must survive into the completed result.
      const submittedResult = await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          summary: "Task wrapped up",
        },
      });
      expect(submittedResult.status).toBe("completed");

      return {
        status: "started",
        summary: "Provider stream observed external completion after outputs",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "stale-after-outputs" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner accumulates node outputs");
    const compiledPlan = makeSingleTaskPlan("graph_task_output_accumulation");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(result.status).toBe("completed");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const completed = persisted?.results.find(
      (entry) => entry.nodeId === "task_node" && entry.status === "current",
    );
    expect(completed).toMatchObject({
      status: "current",
      outputSummary: "Task wrapped up",
    });
    expect(completed?.outputs).toEqual([
      { kind: "markdown", content: "Partial output one", title: "Step 1" },
      { kind: "json", value: { score: 42 }, title: "Step 2" },
    ]);
  });

  it("continues to downstream work when a running task submits its own terminal result", async () => {
    executeTaskNodeCapabilityMock
      .mockImplementationOnce(async (input) => {
        const submittedResult = await taskPlanExecution.submitNodeResult({
          taskId: input.taskId,
          action: {
            action: "complete_manual_node",
            sessionId: "provider-runtime-session",
            summary: "Runtime tool completed first task",
            output: { source: "chrona_node_output" },
          },
        });
        expect(submittedResult.status).toBe("running");

        const activeSession = await db.executionSession.findFirstOrThrow({
          where: { taskId: input.taskId, status: "Active" },
          orderBy: { updatedAt: "desc" },
        });
        expect(activeSession.id).not.toBe("provider-runtime-session");
        expect(activeSession.currentNodeId).toBeNull();

        return {
          status: "started",
          summary: "Provider stream observed external task completion",
          evidence: { sessionId: input.mainSession.id },
          output: { runtimeRunRef: "runtime-first-stale-after-tool" },
        } satisfies NodeExecutionResult;
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { runId: "second-run" },
        output: { runtimeRunRef: "runtime-second" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner external terminal continuation");
    const compiledPlan = makeTwoTaskPlan("graph_external_terminal_continuation");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    await waitForTaskNodeCalls(["first_task", "second_task"]);

    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id, status: "Active" },
      orderBy: { updatedAt: "desc" },
    });
    expect(session.currentNodeId).toBe("second_task");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
    expect(persisted?.results.find((result) => result.nodeId === "first_task")).toMatchObject({
      status: "current",
      outputSummary: "Runtime tool completed first task",
    });

    const normalizedFirstAttempt = await db.taskPlanNodeAttempt.findFirstOrThrow({
      where: { taskId: task.id, nodeId: "first_task" },
    });
    expect(normalizedFirstAttempt.status).toBe("succeeded");
    expect(normalizedFirstAttempt.finishedAt).toBeInstanceOf(Date);

    const runningProviderRows = await db.taskPlanProviderRun.count({
      where: { taskId: task.id, nodeAttemptId: normalizedFirstAttempt.id, status: "running" },
    });
    expect(runningProviderRows).toBe(0);
  });

  it("submits condition branch selections through the unified graph command", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Follow-up task completed",
      evidence: { runId: "follow-up-run" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner condition node result");
    const compiledPlan = makeManualThenTaskPlan("graph_condition_node_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(started.status).toBe("waiting_for_user");
    expect(started.currentNodeId).toBe("manual_task");

    const initial = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const initialEffective = resolveEffectivePlanGraph({
      graph: initial!.graph!,
      attempts: initial!.attempts,
      results: initial!.results,
    });
    const branchRef = buildSemanticRefHistory(initialEffective).branchRefs.find(
      (binding) => binding.nodeId === "manual_task",
    )!.ref;

    const branchSelected = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "complete_manual_node",
        terminalKind: "condition",
        branchRef,
        summary: "Condition selected continue branch",
        continueExecution: false,
      },
    });

    expect(branchSelected.status).toBe("running");
    expect(branchSelected.currentNodeId).toBeNull();

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["manual_task", "succeeded"],
    ]);
    const manualResult = [...(persisted?.results ?? [])].reverse().find(
      (result) => result.nodeId === "manual_task" && result.status === "current",
    );
    expect(manualResult).toMatchObject({
      nodeId: "manual_task",
      status: "current",
      selectedBranch: {
        ref: branchRef,
        label: "continue",
        nextNodeId: "auto_task",
        source: "ai",
      },
    });
    const effectiveAfterSelection = resolveEffectivePlanGraph({
      graph: persisted!.graph!,
      attempts: persisted!.attempts,
      results: persisted!.results,
    });
    expect(effectiveAfterSelection.nodes.find((node) => node.id === "auto_task")).toMatchObject({
      ready: true,
      status: "ready",
    });

    const events = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
      select: { actorType: true, eventType: true, nodeId: true, payload: true, rawEventId: true },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "user",
          eventType: "plan_execution.node_result_submitted",
          nodeId: "manual_task",
          payload: expect.objectContaining({
            command: "complete_manual_node",
            actor: expect.objectContaining({ type: "user" }),
            origin: expect.objectContaining({ channel: "api" }),
            correlation: expect.objectContaining({ taskId: task.id, planId: compiledPlan.editablePlanId }),
          }),
        }),
      ]),
    );
    const resultEvents = events.filter(
      (event) => event.eventType === "plan_execution.node_result_submitted",
    );
    expect(new Set(resultEvents.map((event) => event.rawEventId)).size).toBe(resultEvents.length);
  });

  it("converges when an AI condition submits a branch through the graph command", async () => {
    evaluateConditionNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const planRun = await getPlanRun(input.taskId, "graph_ai_condition_command_result");
      const effective = resolveEffectivePlanGraph({
        graph: planRun!.graph!,
        attempts: planRun!.attempts,
        results: planRun!.results,
      });
      const branchRef = buildSemanticRefHistory(effective).branchRefs.find(
        (binding) => binding.nodeId === "ai_condition",
      )!.ref;

      await taskPlanExecution.dispatch({
        taskId: input.taskId,
        action: {
          action: "complete_manual_node",
          terminalKind: "condition",
          branchRef,
          summary: "AI selected command branch",
          continueExecution: false,
        },
      });

      return {
        status: "done",
        summary: "Provider completion has no branch and must not drive graph state",
        evidence: { sessionId: input.mainSession.id, runId: "provider-without-branch" },
      } satisfies NodeExecutionResult;
    });
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "Auto task runtime run started",
      evidence: { runId: "auto-run" },
      output: { runtimeRunRef: "auto-run" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner AI condition command result");
    const compiledPlan = makeAiConditionThenTaskPlan("graph_ai_condition_command_result");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("running");
    expect(result.message).toBe("Auto task runtime run started");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    const conditionResult = [...(persisted?.results ?? [])].reverse().find(
      (nodeResult) => nodeResult.nodeId === "ai_condition" && nodeResult.status === "current",
    );
    expect(conditionResult).toMatchObject({
      nodeId: "ai_condition",
      outputSummary: "AI selected command branch",
      selectedBranch: {
        label: "continue",
        nextNodeId: "auto_task",
        source: "ai",
      },
    });
    const effectiveAfterSelection = resolveEffectivePlanGraph({
      graph: persisted!.graph!,
      attempts: persisted!.attempts,
      results: persisted!.results,
    });
    expect(effectiveAfterSelection.nodes.find((node) => node.id === "auto_task")).toMatchObject({
      ready: false,
      status: "running",
    });
    const blockedEvent = await db.event.findFirst({
      where: { taskId: task.id, eventType: "plan_execution.node_blocked" },
    });
    expect(blockedEvent).toBeNull();
  });

  it("does not let a provider started result overwrite an external blocked result", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      const submittedResult = await taskPlanExecution.dispatch({
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
      expect(submittedResult.status).toBe("blocked");

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

async function waitForTaskNodeCalls(expectedNodeIds: string[]) {
  const expected = JSON.stringify(expectedNodeIds);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const actual = JSON.stringify(
      executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id),
    );
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeAiConditionThenTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `AI condition handoff ${editablePlanId}`,
    goal: "AI condition submits branch through graph command",
    assumptions: [],
    nodes: [
      {
        id: "ai_condition",
        localId: "ai_condition",
        type: "condition",
        title: "AI condition",
        description: "AI condition terminal tool selects branch",
        config: {
          condition: "Choose whether to continue",
          evaluationBy: "ai",
          branches: [{ label: "continue", nextNodeId: "auto_task" }],
        } satisfies ConditionConfig,
        dependencies: [],
        dependents: ["auto_task"],
        executor: "ai",
      },
      {
        id: "auto_task",
        localId: "auto_task",
        type: "task",
        title: "Automatic follow-up",
        description: "Should be ready after condition command result",
        config: { expectedOutput: "Automatic output" } satisfies TaskConfig,
        dependencies: ["ai_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [{ id: "edge_ai_condition_to_auto", from: "ai_condition", to: "auto_task" }],
    entryNodeIds: ["ai_condition"],
    terminalNodeIds: ["auto_task"],
    topologicalOrder: ["ai_condition", "auto_task"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}
