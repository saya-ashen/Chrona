import { describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeTwoTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "../plan-runner.task-executor.fixtures";

describe("stop and pause regressions", () => {
  setupPlanRunnerTaskExecutorTest();

  it("keeps a paused session paused when a late runtime result arrives", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Pause regression");
    const compiledPlan = makeTwoTaskPlan("graph_pause_regression");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "pause_session", reason: "User pause" } });
    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late completion",
    });

    const session = await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } });
    expect(session.status).toBe("Paused");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("keeps downstream work cancelled after stop even if the active provider run later completes", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "First runtime run started",
      evidence: { sessionId: "main-session", runId: "run-first-task" },
      output: { runtimeRunRef: "runtime-first-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Stop regression");
    const compiledPlan = makeTwoTaskPlan("graph_stop_regression");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "cancel_session", reason: "User stop" } });
    await taskPlanExecution.syncRuntimeResult({
      taskId: task.id,
      runtimeRunRef: "runtime-first-task",
      status: "Completed",
      summary: "Late completion",
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["first_task", "cancelled"],
    ]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("preserves scheduled work block when execution is stopped", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "started",
      summary: "Runtime run started",
      evidence: { sessionId: "main-session", runId: "run-scheduled-task" },
      output: { runtimeRunRef: "runtime-scheduled-task" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Stop keeps schedule");
    const compiledPlan = makeTwoTaskPlan("graph_stop_keeps_schedule");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);
    const scheduledStartAt = new Date("2026-05-30T11:00:00.000Z");
    const scheduledEndAt = new Date("2026-05-30T12:00:00.000Z");
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        scheduledStartAt,
        scheduledEndAt,
        trigger: "manual",
      },
    });

    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "start_manual" } });
    await taskPlanExecution.dispatch({ taskId: task.id, action: { action: "cancel_session", reason: "User stop" } });

    const preservedBlock = await db.workBlock.findUniqueOrThrow({ where: { id: workBlock.id } });
    expect(preservedBlock.status).toBe("Scheduled");
    expect(preservedBlock.startedAt).toBeNull();
    expect(preservedBlock.scheduledStartAt).toEqual(scheduledStartAt);
    expect(preservedBlock.scheduledEndAt).toEqual(scheduledEndAt);

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.scheduledStartAt).toEqual(scheduledStartAt);
    expect(projection.scheduledEndAt).toEqual(scheduledEndAt);
  });
});
