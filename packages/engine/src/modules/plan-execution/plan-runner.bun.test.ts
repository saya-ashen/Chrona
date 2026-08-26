import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { RunStatus, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { taskPlanExecution } from "@/modules/plan-execution/facade/task-plan-execution.facade";
import { getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import { aiClientRegistry } from "@/modules/ai";
import type { CheckpointConfig, CompiledPlan, ConditionConfig } from "@chrona/contracts/ai";

async function resetDb() {
  await db.aiFeatureRun.deleteMany();
  await db.aiFeatureBinding.deleteMany();
  await db.taskAssistantMessage.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
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
  await db.aiClient.deleteMany();
  await db.workspace.deleteMany();
  await aiClientRegistry.refresh();
}

async function seedWorkspaceAndTask(title: string) {
  const workspace = await db.workspace.create({
    data: {
      name: `${title} Workspace`,
      status: "Active",
    },
  });

  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title,
      status: TaskStatus.Ready,
      priority: "Medium",
      executionConfig: {},
    },
  });

  return { workspace, task };
}

function makeConditionConfig(input: {
  condition: string;
  evaluationBy: "user" | "ai";
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

function makeUserThenBlockedTaskPlan(): CompiledPlan {
  return {
    id: "compiled_user_then_blocked_task",
    editablePlanId: "graph_user_then_blocked_task",
    sourceVersion: 1,
    title: "User then blocked task",
    goal: "Resume waiting node, then hit manual downstream task",
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
        type: "task",
        title: "Manual gate",
        description: "Manual task blocks runner test",
        executor: "ai",
        mode: "manual",
        config: {
          expectedOutput: "Manual completion",
          completionCriteria: "Manual task is completed",
        },
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

function makeSingleBlockedTaskPlan(): CompiledPlan {
  return {
    id: "compiled_single_blocked_task",
    editablePlanId: "graph_single_blocked_task",
    sourceVersion: 1,
    title: "Single blocked task",
    goal: "Manual task blocks execution",
    assumptions: [],
    nodes: [
      {
        id: "cond_blocked",
        localId: "cond_blocked",
        type: "task",
        title: "Manual gate",
        description: "Manual task blocks until user handles it",
        executor: "ai",
        mode: "manual",
        config: {
          expectedOutput: "Manual completion",
          completionCriteria: "Manual task is completed",
        },
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

function makeSingleManualCompletionPlan(): CompiledPlan {
  return {
    id: "compiled_single_manual_completion",
    editablePlanId: "graph_single_manual_completion",
    sourceVersion: 1,
    title: "Single manual completion task",
    goal: "Collect a validated manual result",
    assumptions: [],
    nodes: [{
      id: "manual_step",
      localId: "manual_step",
      type: "task",
      title: "Inspect plants",
      description: "Inspect soil and leaves",
      executor: "user",
      mode: "manual",
      config: {
        expectedOutput: "Per-plant inspection result",
        completionCriteria: "Every plant has been checked",
        completionForm: {
          instructions: "Record the inspection result.",
          submitLabel: "Complete and continue",
          inputFields: [{ kind: "text", name: "inspection", label: "Inspection result", multiline: true, required: true }],
        },
      },
      dependencies: [],
      dependents: [],
    }],
    edges: [],
    entryNodeIds: ["manual_step"],
    terminalNodeIds: ["manual_step"],
    topologicalOrder: ["manual_step"],
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
      { name: "genre", label: "体裁与风格", type: "choice", required: true, options: ["现代诗", "散文诗"] },
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

function makeChooseCheckpointPlan(): CompiledPlan {
  const config: CheckpointConfig = {
    checkpointType: "choose",
    prompt: "Choose implementation language",
    required: true,
    options: ["Python", "JavaScript", "Shell"],
  };

  return {
    id: "compiled_choose_checkpoint",
    editablePlanId: "graph_choose_checkpoint",
    sourceVersion: 1,
    title: "Choose checkpoint",
    goal: "Collect a structured user choice before continuing",
    assumptions: [],
    nodes: [
      {
        id: "checkpoint_choose",
        localId: "checkpoint_choose",
        type: "checkpoint",
        title: "Choose language",
        description: "User chooses the implementation language",
        config,
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["checkpoint_choose"],
    terminalNodeIds: ["checkpoint_choose"],
    topologicalOrder: ["checkpoint_choose"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function makeEditCheckpointPlan(): CompiledPlan {
  const config: CheckpointConfig = {
    checkpointType: "edit",
    prompt: "Review and edit the candidate channels",
    required: true,
    inputFields: [
      { name: "selectedChannels", label: "Channels to keep", type: "textarea", required: true },
      { name: "channelChanges", label: "Channel changes", type: "textarea" },
    ],
  };

  return {
    id: "compiled_edit_checkpoint",
    editablePlanId: "graph_edit_checkpoint",
    sourceVersion: 1,
    title: "Edit checkpoint",
    goal: "Let the user edit generated content before continuing",
    assumptions: [],
    nodes: [{
      id: "checkpoint_edit",
      localId: "checkpoint_edit",
      type: "checkpoint",
      title: "Confirm search channels",
      description: "User edits the generated channel list",
      config,
      dependencies: [],
      dependents: [],
    }],
    edges: [],
    entryNodeIds: ["checkpoint_edit"],
    terminalNodeIds: ["checkpoint_edit"],
    topologicalOrder: ["checkpoint_edit"],
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
    expect(updatedTask.status).toBe(TaskStatus.WaitingForInput);
    expect(updatedTask.blockReason).toMatchObject({
      blockType: "human_input_required",
      scope: "plan_node",
    });
  });

  it("resumes waiting node with input and fails when the downstream manual form provider is unavailable", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner resumes waiting node");
    const compiledPlan = makeUserThenBlockedTaskPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("waiting_for_user");
    const executionSession = await db.executionSession.findFirstOrThrow({ where: { taskId: task.id } });

    const resumed = await taskPlanExecution.dispatch({
      taskId: task.id,
      commandContext: { sessionId: executionSession.id },
      action: { action: "resume_with_input", inputFields: { decision: "yes" } },
    });

    expect(resumed.status).toBe("failed");
    expect(resumed.currentNodeId).toBe("cond_system");
    expect(resumed.executedNodeIds).toContain("cond_user");
    expect(resumed.checkpoint).toMatchObject({
      kind: "failed",
      nodeId: "cond_system",
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["cond_user", "obsolete", "user_input"],
      ["cond_user", "current", undefined],
      ["cond_system", "rejected", undefined],
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
    expect(session.pauseReason).toBeNull();
    expect(session.completedNodeIds).toBe(JSON.stringify(["cond_user"]));

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Blocked);
    expect(updatedTask.blockReason).toMatchObject({
      blockType: "node_blocked",
      scope: "plan_node",
      actionRequired: "Check execution status",
    });
  });

  it("reviews a manual form, waits normally, and persists structured completion input", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner manual completion");
    const client = await db.aiClient.create({
      data: {
        name: "Only configured provider",
        type: "debug",
        config: { profile: "deterministic" },
        enabled: true,
        isDefault: true,
      },
    });
    await db.aiFeatureBinding.create({ data: { feature: "task.execution", clientId: client.id } });
    await aiClientRegistry.refresh();
    const compiledPlan = makeSingleManualCompletionPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const waiting = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(waiting.status).toBe("waiting_for_user");
    expect(waiting.checkpoint).toMatchObject({
      kind: "manual_completion",
      nodeId: "manual_step",
      form: { source: "plan", validated: true },
    });
    expect(waiting.checkpoint?.availableActions.map(({ id }) => id)).toEqual([
      "mark_node_completed",
      "request_replan",
      "cancel_session",
    ]);

    await expect(taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint!.id,
        action: "mark_node_completed",
        payload: {
          formRevision: "sha256:stale",
          inputFields: { inspection: "Basil dry; mint healthy" },
        },
      },
    })).rejects.toThrow("form changed");
    expect((await taskPlanExecution.current({ taskId: task.id })).status).toBe("waiting_for_user");

    const completed = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: waiting.checkpoint!.id,
        action: "mark_node_completed",
        payload: {
          formRevision: waiting.checkpoint!.form!.revision,
          inputFields: { inspection: "Basil dry; mint healthy" },
        },
      },
    });

    expect(completed.execution.status).toBe("completed");
    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.at(-1)).toMatchObject({
      nodeId: "manual_step",
      inputFields: { inspection: "Basil dry; mint healthy" },
      outputSummary: "Inspection result: Basil dry; mint healthy",
    });
    const featureRun = await db.aiFeatureRun.findFirstOrThrow({
      where: { featureId: "task.manual-completion-form.review", subjectId: persisted!.attempts[0]!.id },
    });
    expect(featureRun).toMatchObject({
      providerClientId: client.id,
      providerName: "debug",
      status: "Completed",
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
    expect(initial.checkpoint).toMatchObject({
      kind: "user_input",
      nodeId: "checkpoint_input",
      form: {
        instructions: "Provide poem constraints",
        submitLabel: "Submit input",
        inputFields: [
          { name: "theme", label: "主题", type: "text", required: true },
          { name: "genre", label: "体裁与风格", type: "select", required: true, options: ["现代诗", "散文诗"] },
        ],
      },
    });
    expect(initial.checkpoint?.availableActions.map((action) => action.id)).toContain("submit_input");

    const waitingRun = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(waitingRun?.results[0]?.actionForm).toEqual(initial.checkpoint?.form);

    const submitted = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: initial.checkpoint!.id,
        action: "submit_input",
        payload: { inputFields: { theme: "夏天", style: "现代诗", notes: "无" } },
      },
    });
    expect(submitted.transition.type).toBe("resume_current_node");
    const resumed = submitted.execution;

    expect(resumed.status).toBe("completed");
    expect(resumed.currentNodeId).toBeNull();
    expect(resumed.executedNodeIds).toContain("checkpoint_input");

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["checkpoint_input", "obsolete", "user_input"],
      ["checkpoint_input", "current", undefined],
    ]);
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

  it("exposes choose checkpoints as select action forms", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner choose checkpoint");
    const compiledPlan = makeChooseCheckpointPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(initial.status).toBe("waiting_for_user");
    expect(initial.checkpoint).toMatchObject({
      kind: "user_input",
      nodeId: "checkpoint_choose",
      form: {
        instructions: "Choose implementation language",
        submitLabel: "Submit choice",
        inputFields: [{
          name: "choice",
          label: "Choose language",
          type: "select",
          required: true,
          options: ["Python", "JavaScript", "Shell"],
        }],
      },
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results[0]?.actionForm).toEqual(initial.checkpoint?.form);
  });

  it("pauses edit checkpoints for user input instead of failing the run", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner edit checkpoint");
    const compiledPlan = makeEditCheckpointPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });

    expect(initial.status).toBe("waiting_for_user");
    expect(initial.checkpoint).toMatchObject({
      kind: "user_input",
      nodeId: "checkpoint_edit",
      form: {
        instructions: "Review and edit the candidate channels",
        submitLabel: "Submit edits",
        inputFields: [
          { name: "selectedChannels", label: "Channels to keep", type: "textarea", required: true },
          { name: "channelChanges", label: "Channel changes", type: "textarea" },
        ],
      },
    });

    const providerRun = await db.run.findFirst({ where: { taskId: task.id } });
    expect(providerRun).toBeNull();

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results[0]).toMatchObject({
      nodeId: "checkpoint_edit",
      status: "current",
      waitKind: "user_input",
    });
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual(["succeeded"]);

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.WaitingForInput);
    expect(updatedTask.blockReason).toMatchObject({
      blockType: "human_input_required",
      scope: "plan_node",
    });
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
    const taskSession = await db.taskSession.findFirstOrThrow({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
    });

    const liveRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        taskSessionId: taskSession.id,
        status: RunStatus.Running,
        triggeredBy: "test",
        runtimeRunRef: "provider-run-cancel-session",
      },
    });
    await db.task.update({ where: { id: task.id }, data: { latestRunId: liveRun.id } });

    const cancelled = await taskPlanExecution.dispatch({
      taskId: task.id,
      commandContext: { sessionId: existingSession.id },
      action: {
        action: "cancel_session",
        reason: "user cancelled from test",
      },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.currentNodeId).toBeNull();
    expect(cancelled.mainSessionId).toBe(existingSession.id);
    expect(cancelled.message).toBe("Plan execution cancelled.");

    const session = await db.executionSession.findUniqueOrThrow({
      where: { id: existingSession.id },
    });
    expect(session.status).toBe("Abandoned");
    expect(session.currentNodeId).toBeNull();
    expect(session.pauseReason).toBeNull();

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe(TaskStatus.Cancelled);
    expect(updatedTask.blockReason).toBeNull();

    const cancelledRun = await db.run.findUniqueOrThrow({ where: { id: liveRun.id } });
    expect(cancelledRun.status).toBe(RunStatus.Cancelled);
    expect(cancelledRun.endedAt).toBeInstanceOf(Date);
    expect(cancelledRun.errorSummary).toBe("user cancelled from test");

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.persistedStatus).toBe(TaskStatus.Cancelled);
    expect(projection.latestRunStatus).toBe(RunStatus.Cancelled);
  });

  it("retries manual form generation by obsoleting the failed result and creating a fresh attempt", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Runner retries blocked node");
    const compiledPlan = makeSingleBlockedTaskPlan();
    await seedAcceptedCompiledPlan(workspace.id, task.id, compiledPlan);

    const initial = await taskPlanExecution.dispatch({
      taskId: task.id,
      action: { action: "start_manual" },
    });
    expect(initial.status).toBe("failed");
    expect(initial.currentNodeId).toBe("cond_blocked");
    expect(initial.checkpoint).toMatchObject({
      kind: "failed",
      nodeId: "cond_blocked",
    });
    expect(initial.checkpoint?.availableActions.map((action) => action.id)).toContain("retry_node");

    const retryResult = await taskPlanExecution.submitCheckpointAction({
      taskId: task.id,
      action: {
        checkpointId: initial.checkpoint!.id,
        action: "retry_node",
        payload: { prompt: "retry blocked node" },
      },
    });
    expect(retryResult.transition.type).toBe("rerun_current_node");
    const retried = retryResult.execution;

    expect(retried.status).toBe("failed");
    expect(retried.currentNodeId).toBe("cond_blocked");
    expect(retried.checkpoint).toMatchObject({
      kind: "failed",
      nodeId: "cond_blocked",
    });

    const persisted = await getPlanRun(task.id, compiledPlan.editablePlanId);
    expect(persisted?.results.map((item) => [item.nodeId, item.status, item.waitKind])).toEqual([
      ["cond_blocked", "obsolete", undefined],
      ["cond_blocked", "rejected", undefined],
    ]);
    expect(persisted?.attempts).toHaveLength(2);
    expect(persisted?.attempts.map((attempt) => attempt.status)).toEqual(["failed", "failed"]);
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
    const inputExecutionSession = await db.executionSession.findFirstOrThrow({ where: { taskId: inputFlow.task.id } });

    const completed = await taskPlanExecution.dispatch({
      taskId: inputFlow.task.id,
      commandContext: { sessionId: inputExecutionSession.id },
      action: { action: "resume_with_input", nodeId: "checkpoint_input", inputFields: { theme: "matrix" } },
    });
    expect(completed.status).toBe("completed");
    expect(completed.executedNodeIds).toContain("checkpoint_input");

    const completedTask = await db.task.findUniqueOrThrow({ where: { id: inputFlow.task.id } });
    expect(completedTask.status).toBe(TaskStatus.Completed);

    const completedRun = await getPlanRun(inputFlow.task.id, inputPlan.editablePlanId);
    expect(completedRun?.attempts.map((attempt) => attempt.status)).toEqual(["succeeded", "succeeded"]);

    const blockedFlow = await seedWorkspaceAndTask("Runner outcome matrix blocked");
    const blockedPlan = makeSingleBlockedTaskPlan();
    await seedAcceptedCompiledPlan(blockedFlow.workspace.id, blockedFlow.task.id, blockedPlan);

    const blocked = await taskPlanExecution.dispatch({
      taskId: blockedFlow.task.id,
      action: { action: "start_manual" },
    });
    expect(blocked.status).toBe("failed");
    expect(blocked.currentNodeId).toBe("cond_blocked");
    expect(blocked.checkpoint).toMatchObject({
      kind: "failed",
      nodeId: "cond_blocked",
    });

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
      commandContext: { sessionId: cancelSession.id },
      action: { action: "cancel_session", reason: "matrix cancel" },
    });
    expect(cancelled.status).toBe("cancelled");

    const cancelledTask = await db.task.findUniqueOrThrow({ where: { id: cancelFlow.task.id } });
    expect(cancelledTask.status).toBe(TaskStatus.Cancelled);
  });
});
