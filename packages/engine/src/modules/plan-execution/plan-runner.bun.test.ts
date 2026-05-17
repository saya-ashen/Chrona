import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { taskPlanExecution } from "@/modules/plan-execution";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CheckpointConfig, CompiledPlan, ConditionConfig } from "@chrona/contracts/ai";

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

function makeConditionConfig(input: {
  condition: string;
  evaluationBy: "user" | "system";
  branches: Array<{ label: string; nextNodeId: string }>;
  defaultNextNodeId?: string;
}): ConditionConfig {
  return {
    condition: input.condition,
    evaluationBy: input.evaluationBy,
    branches: input.branches,
    defaultNextNodeId: input.defaultNextNodeId,
  };
}

function makeSingleUserConditionPlan(): CompiledPlan {
  return {
    id: "compiled_single_user_condition",
    editablePlanId: "graph_single_user_condition",
    sourceVersion: 1,
    title: "Single user condition",
    goal: "Wait for user branch selection",
    assumptions: [],
    nodes: [
      {
        id: "cond_user",
        localId: "cond_user",
        type: "condition",
        title: "Choose path",
        description: "User must choose a branch",
        config: makeConditionConfig({
          condition: "Choose the next step",
          evaluationBy: "user",
          branches: [{ label: "yes", nextNodeId: "cond_user" }],
          defaultNextNodeId: "cond_user",
        }),
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["cond_user"],
    terminalNodeIds: ["cond_user"],
    topologicalOrder: ["cond_user"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeUserThenSystemConditionPlan(): CompiledPlan {
  return {
    id: "compiled_user_then_system_condition",
    editablePlanId: "graph_user_then_system_condition",
    sourceVersion: 1,
    title: "User then system condition",
    goal: "Resume waiting node, then hit deterministic blocked node",
    assumptions: [],
    nodes: [
      {
        id: "cond_user",
        localId: "cond_user",
        type: "condition",
        title: "Choose branch",
        description: "Explicit user selection",
        config: makeConditionConfig({
          condition: "Pick a route",
          evaluationBy: "user",
          branches: [{ label: "yes", nextNodeId: "cond_system" }],
        }),
        dependencies: [],
        dependents: ["cond_system"],
      },
      {
        id: "cond_system",
        localId: "cond_system",
        type: "condition",
        title: "System gate",
        description: "Deterministic block for runner test",
        config: makeConditionConfig({
          condition: "System-evaluated gate",
          evaluationBy: "system",
          branches: [{ label: "continue", nextNodeId: "cond_system" }],
        }),
        dependencies: ["cond_user"],
        dependents: [],
      },
    ],
    edges: [
      {
        id: "edge_yes_to_system",
        from: "cond_user",
        to: "cond_system",
        label: "yes",
      },
    ],
    entryNodeIds: ["cond_user"],
    terminalNodeIds: ["cond_system"],
    topologicalOrder: ["cond_user", "cond_system"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeSingleBlockedConditionPlan(): CompiledPlan {
  return {
    id: "compiled_single_blocked_condition",
    editablePlanId: "graph_single_blocked_condition",
    sourceVersion: 1,
    title: "Single blocked condition",
    goal: "Deterministically block execution",
    assumptions: [],
    nodes: [
      {
        id: "cond_blocked",
        localId: "cond_blocked",
        type: "condition",
        title: "Blocked gate",
        description: "System condition blocks until unimplemented evaluator exists",
        config: makeConditionConfig({
          condition: "Blocked gate",
          evaluationBy: "system",
          branches: [{ label: "continue", nextNodeId: "cond_blocked" }],
        }),
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["cond_blocked"],
    terminalNodeIds: ["cond_blocked"],
    topologicalOrder: ["cond_blocked"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeInputCheckpointPlan(): CompiledPlan {
  const config: CheckpointConfig = {
    checkpointType: "input",
    prompt: "Provide poem constraints",
    required: true,
    inputFields: [
      { name: "theme", label: "主题", required: true },
      { name: "genre", label: "体裁与风格", required: true },
    ],
  };

  return {
    id: "compiled_input_checkpoint",
    editablePlanId: "graph_input_checkpoint",
    sourceVersion: 1,
    title: "Input checkpoint",
    goal: "Collect user input before continuing",
    assumptions: [],
    nodes: [
      {
        id: "checkpoint_input",
        localId: "checkpoint_input",
        type: "checkpoint",
        title: "Collect writing constraints",
        description: "User provides structured poem constraints",
        config,
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["checkpoint_input"],
    terminalNodeIds: ["checkpoint_input"],
    topologicalOrder: ["checkpoint_input"],
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
    generatedBy: "plan-runner-test",
  });
}

describe("plan-runner native execution actions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it("pauses for user input on start_manual and persists waiting state", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner waits for input");
    const compiledPlan = makeSingleUserConditionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const result = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual", prompt: "start" },
    });

    expect(result.status).toBe("waiting_for_user");
    expect(result.planId).toBe(compiledPlan.editablePlanId);
    expect(result.currentNodeId).toBe("cond_user");
    expect(result.waitingNodeIds).toContain("cond_user");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.graph?.id).toBe(compiledPlan.editablePlanId);
    expect(persisted?.results).toHaveLength(1);
    expect(persisted?.results[0]?.nodeId).toBe("cond_user");
    expect(persisted?.results[0]?.status).toBe("current");
    expect(persisted?.results[0]?.waitKind).toBe("user_input");
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.attempts[0]?.status).toBe("succeeded");
    expect(persisted?.executionContextSnapshots).toHaveLength(1);
    expect(persisted?.executionContextSnapshots[0]?.nodeId).toBe("cond_user");
    expect(persisted?.executionContextSnapshots[0]?.refs).toBeUndefined();

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("cond_user");
    expect(session.pauseReason).toBe("user_input");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
    expect(updatedTask.blockReason).toMatchObject({
      blockType: "execution_paused",
      scope: "execution_session",
    });
  });

  it("resumes waiting node with input, obsoletes prior waiting result, and continues into blocked downstream node", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner resumes waiting node");
    const compiledPlan = makeUserThenSystemConditionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("waiting_for_user");

    const resumed = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "resume_with_input", inputFields: { decision: "yes" } },
    });

    expect(resumed.status).toBe("blocked");
    expect(resumed.currentNodeId).toBe("cond_system");
    expect(resumed.executedNodeIds).toContain("cond_user");
    expect(resumed.blockedNodeIds).toContain("cond_system");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["cond_user", "obsolete", "user_input"],
      ["cond_user", "current", undefined],
      ["cond_system", "current", "manual_action"],
    ]);
    expect(persisted?.results[1]?.selectedBranch).toMatchObject({
      label: "yes",
      nextNodeId: "cond_system",
      source: "user",
    });
    expect(persisted?.attempts).toHaveLength(3);
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual([
      "succeeded",
      "succeeded",
      "failed",
    ]);
    expect(persisted?.executionContextSnapshots).toHaveLength(3);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "cond_user" && (snapshot.refs?.inputFields as Record<string, string> | undefined)?.decision === "yes",
      ),
    ).toBe(true);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Paused");
    expect(session.currentNodeId).toBe("cond_system");
    expect(session.pauseReason).toBe("manual_action");
    expect(session.completedNodeIds).toBe(JSON.stringify(["cond_user"]));

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
    expect(updatedTask.blockReason).toMatchObject({
      blockType: "execution_paused",
      scope: "execution_session",
      actionRequired: "Check execution status",
    });
  });

  it("completes input checkpoints with submitted input", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner input checkpoint");
    const compiledPlan = makeInputCheckpointPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("waiting_for_user");
    expect(initial.currentNodeId).toBe("checkpoint_input");

    const resumed = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "resume_with_input",
        nodeId: "checkpoint_input",
        inputFields: {
          theme: "夏天",
          style: "现代诗",
          notes: "无",
        },
      },
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.currentNodeId).toBeNull();
    expect(resumed.executedNodeIds).toContain("checkpoint_input");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["checkpoint_input", "obsolete", "user_input"],
      ["checkpoint_input", "current", undefined],
    ]);
    expect(persisted?.results[1]?.outputs).toContainEqual({
      kind: "json",
      value: { inputFields: { theme: "夏天", style: "现代诗", notes: "无" } },
    });
    expect(persisted?.results[1]?.inputFields).toEqual({ theme: "夏天", style: "现代诗", notes: "无" });
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual(["succeeded", "succeeded"]);

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(session.status).toBe("Completed");
    expect(session.currentNodeId).toBeNull();
    expect(session.completedNodeIds).toBe(JSON.stringify(["checkpoint_input"]));

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Completed);
  });

  it("cancels paused execution session and marks task cancelled", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner cancels session");
    const compiledPlan = makeSingleUserConditionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const existingSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const cancelled = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "cancel_session",
        sessionId: existingSession.id,
        reason: "user cancelled from test",
      },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.currentNodeId).toBeNull();
    expect(cancelled.mainSessionId).toBe(existingSession.id);
    expect(cancelled.message).toBe("user cancelled from test");

    const session = await db.executionSession.findUniqueOrThrow({
      where: { id: existingSession.id },
    });
    expect(session.status).toBe("Abandoned");
    expect(session.currentNodeId).toBeNull();
    expect(session.pauseReason).toBe("user cancelled from test");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Cancelled);
    expect(updatedTask.blockReason).toBeNull();
  });

  it("retries a blocked node by obsoleting prior result and creating a fresh blocked attempt", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner retries blocked node");
    const compiledPlan = makeSingleBlockedConditionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("blocked");
    expect(initial.currentNodeId).toBe("cond_blocked");

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const retried = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: {
        action: "retry_node",
        sessionId: session.id,
        nodeId: "cond_blocked",
        prompt: "retry blocked node",
      },
    });

    expect(retried.status).toBe("blocked");
    expect(retried.currentNodeId).toBe("cond_blocked");
    expect(retried.blockedNodeIds).toContain("cond_blocked");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["cond_blocked", "obsolete", "manual_action"],
      ["cond_blocked", "current", "manual_action"],
    ]);
    expect(persisted?.attempts).toHaveLength(2);
    expect(persisted?.attempts.every((attempt) => attempt.status === "failed")).toBe(true);
    expect(persisted?.executionContextSnapshots).toHaveLength(2);
    expect(
      persisted?.executionContextSnapshots.some(
        (snapshot) => snapshot.nodeId === "cond_blocked" && snapshot.refs?.userInput === "retry blocked node",
      ),
    ).toBe(true);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
  });

  it("records deterministic execution outcome states across task flow actions", async () => {
    const inputFlow = await seedWorkspaceAndTask("Runner outcome matrix input");
    const inputPlan = makeInputCheckpointPlan();
    await seedAcceptedCompiledPlan(inputFlow.workspace.id, inputFlow.task.id, inputPlan);

    const pendingTask = await db.task.findUniqueOrThrow({ where: { id: inputFlow.task.id } });
    expect(pendingTask.status).toBe(TaskStatus.Ready);

    const waiting = await taskPlanExecution.dispatch({
      taskId: inputFlow.task.id,
      action: { action: "start_manual" },
    });
    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.waitingNodeIds).toContain("checkpoint_input");

    const completed = await taskPlanExecution.dispatch({
      taskId: inputFlow.task.id,
      action: { action: "resume_with_input", nodeId: "checkpoint_input", inputFields: { theme: "matrix" } },
    });
    expect(completed.status).toBe("completed");
    expect(completed.executedNodeIds).toContain("checkpoint_input");

    const completedTask = await db.task.findUniqueOrThrow({ where: { id: inputFlow.task.id } });
    expect(completedTask.status).toBe(TaskStatus.Completed);

    const completedRun = await getPlanRun(inputFlow.task.id, inputPlan.editablePlanId);
    expect(completedRun?.attempts.map((attempt) => attempt.status)).toEqual(["succeeded", "succeeded"]);

    const blockedFlow = await seedWorkspaceAndTask("Runner outcome matrix blocked");
    const blockedPlan = makeSingleBlockedConditionPlan();
    await seedAcceptedCompiledPlan(blockedFlow.workspace.id, blockedFlow.task.id, blockedPlan);

    const blocked = await taskPlanExecution.dispatch({
      taskId: blockedFlow.task.id,
      action: { action: "start_manual" },
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedNodeIds).toContain("cond_blocked");

    const blockedTask = await db.task.findUniqueOrThrow({ where: { id: blockedFlow.task.id } });
    expect(blockedTask.status).toBe(TaskStatus.Blocked);

    const blockedRun = await getPlanRun(blockedFlow.task.id, blockedPlan.editablePlanId);
    expect(blockedRun?.attempts.map((attempt) => attempt.status)).toEqual(["failed"]);

    const cancelFlow = await seedWorkspaceAndTask("Runner outcome matrix cancelled");
    const cancelPlan = makeSingleUserConditionPlan();
    await seedAcceptedCompiledPlan(cancelFlow.workspace.id, cancelFlow.task.id, cancelPlan);
    await taskPlanExecution.dispatch({ taskId: cancelFlow.task.id, action: { action: "start_manual" } });

    const cancelSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: cancelFlow.task.id },
      orderBy: { createdAt: "desc" },
    });
    const cancelled = await taskPlanExecution.dispatch({
      taskId: cancelFlow.task.id,
      action: { action: "cancel_session", sessionId: cancelSession.id, reason: "matrix cancel" },
    });
    expect(cancelled.status).toBe("cancelled");

    const cancelledTask = await db.task.findUniqueOrThrow({ where: { id: cancelFlow.task.id } });
    expect(cancelledTask.status).toBe(TaskStatus.Cancelled);
  });
});
