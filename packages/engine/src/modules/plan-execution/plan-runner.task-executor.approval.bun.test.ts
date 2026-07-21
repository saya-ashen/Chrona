import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeSingleTaskPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor approval state", () => {
  setupPlanRunnerTaskExecutorTest();

  it("persists waiting_for_approval state for a runtime-backed task node", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "waiting_for_approval",
      prompt: "Please approve the generated output",
      reason: "Human approval required before proceeding",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner waits for approval");
    const compiledPlan = makeSingleTaskPlan("graph_task_waiting_for_approval");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(result.currentNodeId).toBe("task_node");
    expect(result.waitingNodeIds).toEqual(["task_node"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      waitKind: "approval",
      review: {
        required: true,
        status: "pending",
      },
      error: "Human approval required before proceeding",
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]?.status).toBe("succeeded");

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("task_node");
    expect(session.pauseReason).toBe("approval");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.WaitingForApproval);
  });

  it("completes an approved terminal task without re-executing accepted output", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "waiting_for_approval",
      prompt: "Approve the task output",
      reason: "Need approval",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner resumes approval");
    const compiledPlan = makeSingleTaskPlan("graph_task_resume_approval");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    const resumed = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "resume_with_approval",
        decision: "approve",
        feedback: "approved in test",
      },
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.currentNodeId).toBeNull();
    expect(resumed.executedNodeIds).toContain("task_node");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind, item.review?.status, item.outputSummary])).toEqual([
      ["task_node", "obsolete", undefined, "accepted", undefined],
    ]);
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual([
      "succeeded",
    ]);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "task_node" && snapshot.refs?.userInput === "approved in test",
      ),
    ).toBe(false);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });

  it("rejects approval-waiting task node without re-executing it", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "waiting_for_approval",
      prompt: "Approve the task output",
      reason: "Need approval",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner rejects approval");
    const compiledPlan = makeSingleTaskPlan("graph_task_reject_approval");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(waiting.checkpoint).toMatchObject({
      kind: "approval",
      nodeId: "task_node",
    });

    const rejectedAction = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint!.id,
        action: "reject_result",
        payload: { feedback: "not acceptable" },
      },
    });
    expect(rejectedAction.transition.type).toBe("stay_paused");
    const rejected = rejectedAction.execution;

    expect(rejected.status).toBe("waiting_for_approval");
    expect(rejected.currentNodeId).toBe("task_node");
    expect(rejected.message).toBe("not acceptable");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(2);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "rejected",
      review: {
        required: true,
        status: "rejected",
        feedback: "not acceptable",
      },
    });
    expect(persisted?.results[1]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      waitKind: "review",
      error: "not acceptable",
      review: {
        required: true,
        status: "rejected",
        feedback: "not acceptable",
      },
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("task_node");
    expect(session.pauseReason).toBe("review");
  });

  it("turns replan_required into approval waiting state with request_changes review metadata", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "replan_required",
      reason: "Execution context changed, please replan",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner handles replan request");
    const compiledPlan = makeSingleTaskPlan("graph_task_replan_required");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(result.currentNodeId).toBe("task_node");
    expect(result.checkpoint).toMatchObject({
      kind: "replan_required",
      nodeId: "task_node",
    });
    expect(result.checkpoint?.availableActions.map((action) => action.id)).toContain("request_replan");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      waitKind: "replan_required",
      error: "Execution context changed, please replan",
      review: {
        required: true,
        status: "request_changes",
        feedback: "Execution context changed, please replan",
      },
    });

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.pauseReason).toBe("replan_required");
  });
});
