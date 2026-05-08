import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CompiledPlan, TaskConfig } from "@chrona/contracts/ai";
import type { NodeExecutionResult } from "./node-executors/types";

const executePlanNodeMock = mock<(...args: any[]) => Promise<NodeExecutionResult>>();

mock.module("@/modules/plan-execution/node-executor", () => ({
  executePlanNode: executePlanNodeMock,
}));

const { dispatchExecutionAction } = await import("@/modules/plan-execution/plan-runner");

async function resetDb() {
  await db.taskAssistantMessage.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedWorkspaceAndTask(title: string) {
  const workspace = await db.workspace.create({
    data: {
      name: `${title} Workspace`,
      status: "Active",
      defaultRuntime: "openclaw",
    },
  });

  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title,
      status: TaskStatus.Ready,
      priority: "Medium",
      ownerType: "human",
    },
  });

  return { workspace, task };
}

function makeSingleTaskPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Task plan ${editablePlanId}`,
    goal: "Exercise task executor path",
    assumptions: [],
    nodes: [
      {
        id: "task_node",
        localId: "task_node",
        type: "task",
        title: "Execute mocked task node",
        description: "Mocked runtime-backed task executor",
        config: {
          expectedOutput: "Produce runner-side result",
        } satisfies TaskConfig,
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: ["task_node"],
    terminalNodeIds: ["task_node"],
    topologicalOrder: ["task_node"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

async function seedAcceptedCompiledPlan(workspaceId: string, taskId: string, compiledPlan: CompiledPlan) {
  await saveCompiledPlan({
    workspaceId,
    taskId,
    compiledPlan,
    status: "accepted",
    prompt: compiledPlan.title,
    summary: compiledPlan.goal,
    generatedBy: "plan-runner-task-executor-test",
  });
}

describe("plan-runner task executor approval flows", () => {
  beforeEach(async () => {
    executePlanNodeMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    mock.restore();
  });

  it("persists waiting_for_approval state for a runtime-backed task node", async () => {
    executePlanNodeMock.mockResolvedValueOnce({
      status: "waiting_for_approval",
      prompt: "Please approve the generated output",
      reason: "Human approval required before proceeding",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner waits for approval");
    const compiledPlan = makeSingleTaskPlan("graph_task_waiting_for_approval");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(result.currentNodeId).toBe("task_node");
    expect(result.waitingNodeIds).toEqual([]);
    expect(executePlanNodeMock).toHaveBeenCalledTimes(1);

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
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
  });

  it("resumes approval-waiting task node and replaces prior result with a completed result", async () => {
    executePlanNodeMock
      .mockResolvedValueOnce({
        status: "waiting_for_approval",
        prompt: "Approve the task output",
        reason: "Need approval",
        evidence: { sessionId: "main-session" },
      })
      .mockResolvedValueOnce({
        status: "done",
        summary: "Task approved and completed",
        evidence: { sessionId: "main-session", runId: "run_approved" },
      });

    const { workspace, task } = await seedWorkspaceAndTask("Runner resumes approval");
    const compiledPlan = makeSingleTaskPlan("graph_task_resume_approval");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    const resumed = await dispatchExecutionAction({
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
    expect(executePlanNodeMock).toHaveBeenCalledTimes(2);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind, item.outputSummary])).toEqual([
      ["task_node", "obsolete", "approval", undefined],
      ["task_node", "current", undefined, "Task approved and completed"],
    ]);
    expect(persisted?.attempts).toHaveLength(2);
    expect(persisted?.attempts.every((attempt) => attempt.status === "succeeded")).toBe(true);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "task_node" && snapshot.refs?.userInput === "approved in test",
      ),
    ).toBe(true);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });

  it("turns replan_required into approval waiting state with request_changes review metadata", async () => {
    executePlanNodeMock.mockResolvedValueOnce({
      status: "replan_required",
      reason: "Execution context changed, please replan",
      evidence: { sessionId: "main-session" },
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner handles replan request");
    const compiledPlan = makeSingleTaskPlan("graph_task_replan_required");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(result.status).toBe("waiting_for_approval");
    expect(result.currentNodeId).toBe("task_node");
    expect(executePlanNodeMock).toHaveBeenCalledTimes(1);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "task_node",
      status: "current",
      waitKind: "approval",
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
    expect(session.pauseReason).toBe("approval");
  });
});
