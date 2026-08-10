import { describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import {
  executeTaskNodeCapabilityMock,
  makeFullExecutionPlan,
  seedAcceptedCompiledPlan,
  seedWorkspaceAndTask,
  setupPlanRunnerTaskExecutorTest,
  taskPlanExecution,
} from "./plan-runner.task-executor.fixtures";

describe("plan-runner task executor full execution chain", () => {
  setupPlanRunnerTaskExecutorTest();

  it("runs a full plan execution chain through task, user condition, approval, wait, and final task", async () => {
    executeTaskNodeCapabilityMock
      .mockResolvedValueOnce({
        status: "done",
        summary: "Preparation complete",
        evidence: { sessionId: "main-session", runId: "run_prepare" },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "Final result produced",
        evidence: { sessionId: "main-session", runId: "run_final" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner full execution chain");
    const compiledPlan = makeFullExecutionPlan("graph_full_execution_chain");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(initial.status).toBe("waiting_for_user");
    expect(initial.currentNodeId).toBe("route_condition");
    expect(initial.executedNodeIds).toEqual(["prepare_task"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);
    const executionSession = await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } });

    const afterBranchSelection = await taskPlanExecution.dispatch({
      taskId: task.id,
      commandContext: { sessionId: executionSession.id },
      action: { action: "resume_with_input", inputFields: { decision: "approve" } },
    });

    expect(afterBranchSelection.status).toBe("waiting_for_approval");
    expect(afterBranchSelection.currentNodeId).toBe("approval_checkpoint");
    expect(afterBranchSelection.executedNodeIds).toEqual(["route_condition"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const completed = await taskPlanExecution.dispatch({
      taskId: task.id,
      commandContext: { sessionId: executionSession.id },
      action: {
        action: "resume_with_approval",
        decision: "approve",
        feedback: "approval accepted",
      },
    });

    expect(completed.status).toBe("completed");
    expect(completed.currentNodeId).toBeNull();
    expect(completed.executedNodeIds).toEqual([
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
    ]);
    expect(completed.executedNodeIds).not.toContain("skipped_task");
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [
      item.nodeId,
      item.status,
      item.waitKind,
      item.review?.status,
      item.selectedBranch?.label,
      item.outputSummary,
    ])).toEqual([
      ["prepare_task", "current", undefined, undefined, undefined, "Preparation complete"],
      ["route_condition", "obsolete", "user_input", undefined, undefined, undefined],
      ["route_condition", "current", undefined, undefined, "approve", "Condition resolved to branch: approve"],
      ["approval_checkpoint", "obsolete", undefined, "accepted", undefined, undefined],
      ["cooldown_wait", "current", undefined, undefined, undefined, "Wait condition noted: external readiness signal"],
      ["final_task", "current", undefined, undefined, undefined, "Final result produced"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["prepare_task", "succeeded"],
      ["route_condition", "succeeded"],
      ["route_condition", "succeeded"],
      ["approval_checkpoint", "succeeded"],
      ["cooldown_wait", "succeeded"],
      ["final_task", "succeeded"],
    ]);
    expect(persisted?.executionContextSnapshots.map((snapshot) => snapshot.nodeId)).toEqual([
      "prepare_task",
      "route_condition",
      "route_condition",
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
    ]);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "route_condition" && (snapshot.refs?.inputFields as Record<string, string> | undefined)?.decision === "approve",
      ),
    ).toBe(true);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();
    expect(session.pauseReason).toBeNull();
    expect(session.completedNodeIds).toBe(JSON.stringify([
      "prepare_task",
      "route_condition",
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
    ]));

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
    expect(updatedTask.blockReason).toBeNull();
  });
});
