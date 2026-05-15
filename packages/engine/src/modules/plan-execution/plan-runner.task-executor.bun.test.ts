import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CheckpointConfig, CompiledPlan, ConditionConfig, TaskConfig, WaitConfig } from "@chrona/contracts/ai";
import type { NodeExecutionResult } from "./node-executors/types";

const executeTaskNodeCapabilityMock = mock<(...args: any[]) => Promise<NodeExecutionResult>>();
const reviewCheckpointNodeCapabilityMock = mock<(...args: any[]) => Promise<NodeExecutionResult>>();
const evaluateConditionNodeCapabilityMock = mock<(...args: any[]) => Promise<NodeExecutionResult>>();

mock.module("@/modules/plan-execution/node-ai-capabilities", () => ({
  executeTaskNodeCapability: executeTaskNodeCapabilityMock,
  reviewCheckpointNodeCapability: reviewCheckpointNodeCapabilityMock,
  evaluateConditionNodeCapability: evaluateConditionNodeCapabilityMock,
}));

const { taskPlanExecution } = await import("@/modules/plan-execution");

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
      executionRuntime: "openclaw",
      executionConfig: {},
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

function makeFullExecutionPlan(editablePlanId: string): CompiledPlan {
  return {
    id: `compiled_${editablePlanId}`,
    editablePlanId,
    sourceVersion: 1,
    title: `Full execution plan ${editablePlanId}`,
    goal: "Exercise task, condition, checkpoint, and wait execution end-to-end",
    assumptions: [],
    nodes: [
      {
        id: "prepare_task",
        localId: "prepare_task",
        type: "task",
        title: "Prepare execution context",
        description: "Initial automatic task node",
        config: { expectedOutput: "Preparation complete" } satisfies TaskConfig,
        dependencies: [],
        dependents: ["route_condition"],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "route_condition",
        localId: "route_condition",
        type: "condition",
        title: "Choose execution route",
        description: "User selects the approval path",
        config: {
          condition: "Which route should the plan take?",
          evaluationBy: "user",
          branches: [
            { label: "approve", nextNodeId: "approval_checkpoint" },
            { label: "skip", nextNodeId: "skipped_task" },
          ],
        } satisfies ConditionConfig,
        dependencies: ["prepare_task"],
        dependents: ["approval_checkpoint", "skipped_task"],
      },
      {
        id: "approval_checkpoint",
        localId: "approval_checkpoint",
        type: "checkpoint",
        title: "Approve prepared work",
        description: "Human approval before continuing",
        config: {
          checkpointType: "approve",
          prompt: "Approve prepared work",
          required: true,
        } satisfies CheckpointConfig,
        dependencies: ["route_condition"],
        dependents: ["cooldown_wait"],
      },
      {
        id: "cooldown_wait",
        localId: "cooldown_wait",
        type: "wait",
        title: "Wait for external readiness",
        description: "Wait node that completes in the main execution path",
        config: {
          waitFor: "external readiness signal",
          timeout: { minutes: 0, onTimeout: "continue" },
        } satisfies WaitConfig,
        dependencies: ["approval_checkpoint"],
        dependents: ["final_task"],
      },
      {
        id: "final_task",
        localId: "final_task",
        type: "task",
        title: "Finalize execution",
        description: "Final automatic task node",
        config: { expectedOutput: "Final result" } satisfies TaskConfig,
        dependencies: ["cooldown_wait"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
      {
        id: "skipped_task",
        localId: "skipped_task",
        type: "task",
        title: "Skipped alternate branch",
        description: "This node should not execute when approval branch is selected",
        config: { expectedOutput: "Should not run" } satisfies TaskConfig,
        dependencies: ["route_condition"],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [
      { id: "edge_prepare_to_condition", from: "prepare_task", to: "route_condition" },
      { id: "edge_condition_to_approval", from: "route_condition", to: "approval_checkpoint", label: "approve" },
      { id: "edge_condition_to_skipped", from: "route_condition", to: "skipped_task", label: "skip" },
      { id: "edge_approval_to_wait", from: "approval_checkpoint", to: "cooldown_wait" },
      { id: "edge_wait_to_final", from: "cooldown_wait", to: "final_task" },
    ],
    entryNodeIds: ["prepare_task"],
    terminalNodeIds: ["final_task", "skipped_task"],
    topologicalOrder: [
      "prepare_task",
      "route_condition",
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
      "skipped_task",
    ],
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
    executeTaskNodeCapabilityMock.mockReset();
    reviewCheckpointNodeCapabilityMock.mockReset();
    evaluateConditionNodeCapabilityMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    mock.restore();
  });

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
    expect(result.waitingNodeIds).toEqual([]);
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
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
  });

  it("forwards runtime events from task node execution", async () => {
    executeTaskNodeCapabilityMock.mockImplementationOnce(async (input) => {
      await input.onRuntimeEvent?.({
        type: "text_delta",
        provider: "hermes",
        runId: "hermes-run-1",
        sequence: 0,
        text: "working",
      });
      return {
        status: "started",
        summary: "Hermes run started",
        evidence: { sessionId: input.mainSession.id },
        output: { runtimeRunRef: "hermes-run-1" },
      } satisfies NodeExecutionResult;
    });

    const { workspace, task } = await seedWorkspaceAndTask("Runner forwards runtime event");
    const compiledPlan = makeSingleTaskPlan("graph_task_runtime_event");
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const runtimeEvents: unknown[] = [];
    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
      onRuntimeEvent(event) {
        runtimeEvents.push(event);
      },
    });

    expect(runtimeEvents).toEqual([
      {
        nodeId: "task_node",
        nodeTitle: "Execute mocked task node",
        runtimeName: "openclaw",
        event: {
          type: "text_delta",
          provider: "hermes",
          runId: "hermes-run-1",
          sequence: 0,
          text: "working",
        },
      },
    ]);
  });

  it("persists detailed runtime failure context for a failed task node", async () => {
    executeTaskNodeCapabilityMock.mockResolvedValueOnce({
      status: "failed",
      error: "Runtime failed while starting main session run for node task_node: Gateway refused the run",
      evidence: {
        sessionId: "main-session",
        runId: "run_failed",
        runtimeName: "openclaw",
        runtimeRunRef: "resp_failed",
      },
      details: {
        nodeId: "task_node",
        nodeTitle: "Execute task",
        runtimeName: "openclaw",
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

    expect(result.status).toBe("blocked");
    expect(result.message).toContain("Gateway refused the run");
    expect(result.errorDetails).toMatchObject({
      runtimeName: "openclaw",
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
      errorDetails: expect.objectContaining({ runtimeName: "openclaw" }),
    });
  });

  it("resumes approval-waiting task node and replaces prior result with a completed result", async () => {
    executeTaskNodeCapabilityMock
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
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(2);

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind, item.review?.status, item.outputSummary])).toEqual([
      ["task_node", "obsolete", undefined, "accepted", undefined],
      ["task_node", "current", undefined, undefined, "Task approved and completed"],
    ]);
    expect(persisted?.attempts).toHaveLength(2);
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual([
      "cancelled",
      "succeeded",
    ]);
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

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    const rejected = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "resume_with_approval",
        decision: "reject",
        feedback: "not acceptable",
      },
    });

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
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

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

    const afterBranchSelection = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "resume_with_input", inputText: "approve" },
    });

    expect(afterBranchSelection.status).toBe("waiting_for_approval");
    expect(afterBranchSelection.currentNodeId).toBe("approval_checkpoint");
    expect(afterBranchSelection.executedNodeIds).toEqual(["route_condition"]);
    expect(executeTaskNodeCapabilityMock).toHaveBeenCalledTimes(1);

    const completed = await taskPlanExecution.dispatch({
      taskId: task.id,
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
      ["approval_checkpoint", "current", undefined, undefined, undefined, "Checkpoint approved: Approve prepared work"],
      ["cooldown_wait", "current", undefined, undefined, undefined, "Wait condition noted: external readiness signal"],
      ["final_task", "current", undefined, undefined, undefined, "Final result produced"],
    ]);
    expect(persisted?.attempts.map((attempt) => [attempt.nodeId, attempt.status])).toEqual([
      ["prepare_task", "succeeded"],
      ["route_condition", "succeeded"],
      ["route_condition", "succeeded"],
      ["approval_checkpoint", "cancelled"],
      ["approval_checkpoint", "succeeded"],
      ["cooldown_wait", "succeeded"],
      ["final_task", "succeeded"],
    ]);
    expect(persisted?.executionContextSnapshots.map((snapshot) => snapshot.nodeId)).toEqual([
      "prepare_task",
      "route_condition",
      "route_condition",
      "approval_checkpoint",
      "approval_checkpoint",
      "cooldown_wait",
      "final_task",
    ]);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "route_condition" && snapshot.refs?.userInput === "approve",
      ),
    ).toBe(true);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "approval_checkpoint" && snapshot.refs?.userInput === "approval accepted",
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
