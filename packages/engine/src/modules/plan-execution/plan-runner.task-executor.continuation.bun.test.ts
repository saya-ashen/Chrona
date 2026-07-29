import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createPlanGraphFromCompiledPlan, getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import { derivePlanRunFromRuntime } from "@/modules/plan-execution/persistence/plan-runtime-store";
import {
  executeTaskNodeCapabilityMock,
  makeInputCheckpointThenTaskPlan,
  makeSingleTaskPlan,
  makeTwoEntryTaskPlan,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor continuation", () => {
  setupPlanRunnerTaskExecutorTest();

  it("continues to the downstream task run after submitting checkpoint input", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
        status: "done",
        summary: "Specification task complete",
        evidence: { sessionId: "main-session", runId: "run_spec" },
        output: { root: "root", elements: { root: { type: "RichMarkdown", props: { content: "Specification task complete" } } } },
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
            channels: ["official", "euraxess"],
            confirmed: true,
          },
        },
      },
    });

    expect(submitted.execution.status).toBe("completed");
    expect(submitted.execution.currentNodeId).toBeNull();
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    expect(executeTaskNodeCapabilityMock.mock.calls[0]?.[0].node.id).toBe("spec_task");
    expect(executeTaskNodeCapabilityMock.mock.calls[0]?.[0]).toMatchObject({
      userInput: undefined,
      inputFields: undefined,
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["requirements_checkpoint", "obsolete", undefined],
      ["requirements_checkpoint", "current", "Checkpoint completed: Confirm requirements"],
      ["spec_task", "current", "Specification task complete"],
    ]);
    expect(persisted?.planRun.checkpointResponses).toEqual([
      expect.objectContaining({
        planRunId: persisted?.planRun.id,
        nodeId: "requirements_checkpoint",
        response: {
          location_scope: "北京",
          output_format: "终端文本",
          channels: ["official", "euraxess"],
          confirmed: true,
        },
      }),
    ]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });
  it("resumes the same dynamic task node with typed input and persists one response", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "waiting_for_user",
        prompt: "Provide submission inputs",
        reason: "The task needs the selected channels and confirmation",
        evidence: { sessionId: "main-session", runId: "run_waiting" },
        actionForm: {
          instructions: "Provide required values",
          submitLabel: "Continue",
          inputFields: [
            { kind: "text", name: "statement", label: "Statement", required: true },
            { kind: "choice", name: "channels", label: "Channels", selection: "multiple", required: true, options: [
              { label: "Official", value: "official" },
              { label: "Euraxess", value: "euraxess" },
            ] },
            { kind: "boolean", name: "confirmed", label: "Confirmed" },
          ],
        },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "Dynamic task complete",
        evidence: { sessionId: "main-session", runId: "run_complete" },
        output: { root: "root", elements: { root: { type: "RichMarkdown", props: { content: "Done" } } } },
        inputFields: {
          statement: "Approved statement",
          channels: ["official", "euraxess"],
          confirmed: true,
        },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner dynamic task input handoff");
    const compiledPlan = makeSingleTaskPlan("graph_dynamic_task_input_handoff");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.currentNodeId).toBe("task_node");

    const fields = {
      statement: "Approved statement",
      channels: ["official", "euraxess"],
      confirmed: true,
    };
    const submitted = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint?.id ?? "",
        action: "submit_input",
        payload: { inputFields: fields },
      },
    });

    expect(submitted.execution.status).toBe("completed");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);
    expect(executeTaskNodeCapabilityMock.mock.calls[1]?.[0]).toMatchObject({
      userInput: "statement: Approved statement\nchannels: official, euraxess\nconfirmed: true",
      inputFields: fields,
    });
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.find((result) => result.nodeId === "task_node" && result.status === "current")?.inputFields).toEqual(fields);
    expect(persisted?.planRun.checkpointResponses).toHaveLength(1);
    expect(persisted?.planRun.checkpointResponses[0]).toMatchObject({
      planRunId: persisted?.planRun.id,
      nodeId: "task_node",
      response: fields,
    });
  });

  it("persists the resumed running attempt before Plan Output and completes without overwriting it", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "waiting_for_user",
        prompt: "Provide the approved statement",
        reason: "The task needs user input",
        evidence: { sessionId: "main-session", runId: "run_waiting" },
        actionForm: {
          instructions: "Provide required values",
          submitLabel: "Continue",
          inputFields: [
            { kind: "text", name: "statement", label: "Statement", required: true },
            { kind: "boolean", name: "confirmed", label: "Confirmed" },
          ],
        },
      })
      .mockImplementationOnce(async (input) => {
        const active = await getPlanRun(input.taskId, input.attempt.graphId);
        expect(active?.attempts.at(-1)).toMatchObject({
          id: input.attempt.id,
          nodeId: input.node.id,
          status: "running",
        });


        return {
          status: "done",
          summary: "Dynamic task complete",
          evidence: { sessionId: "main-session", runId: "run_complete" },
          inputFields: input.inputFields,
        };
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner resumed Plan Output");
    const compiledPlan = makeSingleTaskPlan("graph_resumed_plan_output");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const fields = { statement: "Approved statement", confirmed: true };
    const submitted = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint?.id ?? "",
        action: "submit_input",
        payload: { inputFields: fields },
      },
    });

    expect(submitted.execution.status).toBe("completed");
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.planOutput).toMatchObject({
      revision: 2,
      manifest: {
        outcome: { title: "Dynamic task complete" },
        sourceRevision: 2,
      },
      finalization: {
        status: "Failed",
        errorCode: "RESULT_FINALIZATION_FAILED",
      },
    });
    expect(persisted?.attempts.at(-1)).toMatchObject({ nodeId: "task_node", status: "succeeded" });
    expect(persisted?.results.find((result) => result.nodeId === "task_node" && result.status === "current")?.inputFields).toEqual(fields);
  });


  it("ignores non-canonical typed input in runtime snapshots", () => {
    const compiledPlan = makeSingleTaskPlan("graph_invalid_snapshot_input");
    const graph = createPlanGraphFromCompiledPlan({ taskId: "task-invalid-input", compiledPlan });
    const derived = derivePlanRunFromRuntime({
      compiledPlan,
      graph,
      attempts: [],
      results: [],
      executionContextSnapshots: [{
        id: "snapshot-invalid-input",
        graphId: graph.id,
        nodeId: "task_node",
        nodeLayerId: graph.nodes.find((node) => node.id === "task_node")!.layers[0]!.id,
        graphSignature: "signature",
        refs: { inputFields: { valid: "text", invalid: 42 } },
        createdAt: "2026-07-21T00:00:00.000Z",
      }],
    });
    expect(derived.checkpointResponses).toEqual([]);
  });

  it("completes a scheduled occurrence task without keeping a shared series task ready", async () => {

    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "done",
      summary: "Recurring occurrence complete",
      evidence: { sessionId: "main-session", runId: "run_recurring" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner recurring occurrence");
    const firstBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
        trigger: "scheduled",
      },
    });

    const compiledPlan = makeSingleTaskPlan("graph_recurring_occurrence");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.start({
      taskId: task.id,
      trigger: "scheduler",
      workBlockId: firstBlock.id,
    });

    expect(result.status).toBe("completed");
    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const blocks = await db.workBlock.findMany({ where: { taskId: task.id }, orderBy: { scheduledStartAt: "asc" } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
    expect(updatedTask.completedAt).toBeInstanceOf(Date);
    expect(blocks.map((block) => [block.id, block.status])).toEqual([
      [firstBlock.id, "Completed"],
    ]);
  });

  it("fails a completed runtime run that has no accepted terminal result", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run_first" },
      output: { runtimeRunRef: "runtime-first-missing-terminal" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner missing terminal result");
    const compiledPlan = makeTwoTaskPlan("graph_runtime_sync_missing_terminal");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(started.status).toBe("running");
    expect(started.currentNodeId).toBe("first_task");

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-missing-terminal",
      status: "Completed",
      summary: "Provider finished without calling Chrona terminal tools",
    });

    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("first_task");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "failed"],
    ]);
    expect(persisted?.planRun.status).toBe("failed");
    expect(persisted?.attempts[0]?.error).toMatchObject({
      message: expect.stringContaining("Runtime run completed without a Chrona terminal result action"),
    });

    const reloadedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloadedTask.status).toBe(TaskStatus.Blocked);
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
      output: { root: "root", elements: { root: { type: "JsonView", props: { value: { requirements: "ready" } } } } },
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
      output: { root: "root", elements: { root: { type: "JsonView", props: { value: { architectureFacts: "ready" } } } } },
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

  it("does not create a provider run for a completed node during resume", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "First task complete",
        evidence: { sessionId: "main-session", runId: "run_first_task" },
        output: { root: "root", elements: { root: { type: "JsonView", props: { value: { runtimeRunRef: "runtime-first-task" } } } } },
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

  it("does not duplicate downstream provider runs when start is retried after runtime sync advances the graph", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "started",
        summary: "First runtime run started",
        evidence: { sessionId: "main-session", runId: "run_first_restart" },
        output: { runtimeRunRef: "runtime-first-restart" },
      })
      .mockResolvedValueOnce({
        status: "started",
        summary: "Second runtime run started",
        evidence: { sessionId: "main-session", runId: "run_second_restart" },
        output: { runtimeRunRef: "runtime-second-restart" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner restart after graph advancement");
    const compiledPlan = makeTwoTaskPlan("graph_restart_after_runtime_sync");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const started = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(started.status).toBe("running");
    expect(started.currentNodeId).toBe("first_task");

    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-restart",
      status: "Completed",
      summary: "First task complete before restart",
      output: { root: "root", elements: { root: { type: "JsonView", props: { value: { restart: "safe" } } } } },
    });

    const restarted = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(restarted.status).toBe("running");
    expect(restarted.message).toBe("Current execution state.");
    expect(executeTaskNodeCapabilityMock.mock.calls.map((call) => call[0].node.id)).toEqual([
      "first_task",
      "second_task",
    ]);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "succeeded"],
      ["second_task", "running"],
    ]);
    const runningSecondAttempts = await db.taskPlanNodeAttempt.count({
      where: { taskId: task.id, nodeId: "second_task", status: "running" },
    });
    expect(runningSecondAttempts).toBe(1);
    expect(persisted?.results.map((result) => [result.nodeId, result.status, result.outputSummary])).toEqual([
      ["first_task", "current", "First task complete before restart"],
    ]);

    const sessions = await db.executionSession.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
      select: { status: true, currentNodeId: true, currentNodeAttemptId: true },
    });
    expect(sessions).toEqual([
      { status: "Active", currentNodeId: "second_task", currentNodeAttemptId: null },
    ]);
  });

});
