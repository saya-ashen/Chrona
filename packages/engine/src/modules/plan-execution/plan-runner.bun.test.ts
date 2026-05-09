import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { dispatchExecutionAction } from "@/modules/plan-execution/plan-runner";
import { getPlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CompiledPlan, ConditionConfig } from "@chrona/contracts/ai";

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

    const result = await dispatchExecutionAction({
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

    const initial = await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("waiting_for_user");

    const resumed = await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "resume_with_input", inputText: "yes" },
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
        (snapshot) => snapshot.nodeId === "cond_user" && snapshot.refs?.userInput === "yes",
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

  it("cancels paused execution session and marks task cancelled", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner cancels session");
    const compiledPlan = makeSingleUserConditionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    const existingSession = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const cancelled = await dispatchExecutionAction({
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

    const initial = await dispatchExecutionAction({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("blocked");
    expect(initial.currentNodeId).toBe("cond_blocked");

    const session = await db.executionSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const retried = await dispatchExecutionAction({
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
});
