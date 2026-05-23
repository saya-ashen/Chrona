import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
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
  });
});
