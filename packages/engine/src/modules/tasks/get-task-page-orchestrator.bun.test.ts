import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getTaskActivityPage, getTaskPage } from "@/modules/tasks/get-task-page";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { createPlanGraphFromCompiledPlan, savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import type { CompiledPlan, NodeResult } from "@chrona/contracts/ai";

async function resetDb() {
  await db.event.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedTask(title = "Orchestrated task") {
  const workspace = await db.workspace.create({
    data: {
      name: `${title} Workspace`,
      status: "Active",
      defaultRuntime: "hermes",
    },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title,
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run orchestrated task" },
    },
  });

  return { workspace, task };
}

function makeCompiledPlan(): CompiledPlan {
  return {
    id: "compiled_orchestrator_page",
    editablePlanId: "graph_orchestrator_page",
    sourceVersion: 4,
    title: "Orchestrator page plan",
    goal: "Expose coherent execution state",
    assumptions: [],
    nodes: [
      {
        id: "prepare",
        localId: "prepare",
        type: "task",
        title: "Prepare context",
        description: "Complete setup",
        config: { expectedOutput: "Context ready" },
        dependencies: [],
        dependents: ["answer"],
      },
      {
        id: "answer",
        localId: "answer",
        type: "checkpoint",
        title: "Provide answer",
        description: "Wait for operator input",
        config: {
          checkpointType: "input",
          prompt: "Provide the launch answer",
          required: true,
          inputFields: [{ name: "answer", label: "Answer", required: true }],
        },
        dependencies: ["prepare"],
        dependents: [],
      },
    ],
    edges: [{ id: "prepare-answer", from: "prepare", to: "answer" }],
    entryNodeIds: ["prepare"],
    terminalNodeIds: ["answer"],
    topologicalOrder: ["prepare", "answer"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function definitionLayerId(graph: ReturnType<typeof createPlanGraphFromCompiledPlan>, nodeId: string) {
  const layer = graph.nodes
    .find((node) => node.id === nodeId)
    ?.layers.find((nodeLayer) => nodeLayer.type === "definition");

  if (!layer) {
    throw new Error(`Missing definition layer for ${nodeId}`);
  }

  return layer.id;
}

describe("getTaskPage orchestrator read model", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns requested recurring occurrence schedule", async () => {
    const { workspace, task } = await seedTask("Recurring page task");
    const firstBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    const secondBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-02T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-02T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    await rebuildTaskProjection(task.id);

    const page = await getTaskPage({ taskId: task.id, workBlockId: secondBlock.id });

    expect(page.task.currentWorkBlock?.id).toBe(secondBlock.id);
    expect(page.task.scheduledStartAt).toBe("2026-06-02T09:00:00.000Z");
    expect(page.task.scheduledEndAt).toBe("2026-06-02T10:00:00.000Z");
    expect(page.task.currentWorkBlock?.id).not.toBe(firstBlock.id);
  });

  it("returns one coherent execution summary from the effective plan graph", async () => {
    const { workspace, task } = await seedTask();
    const compiledPlan = makeCompiledPlan();
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      compiledPlan,
      status: "accepted",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "orchestrator-test",
    });
    const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
    const results: NodeResult[] = [
      {
        nodeId: "prepare",
        nodeLayerId: definitionLayerId(graph, "prepare"),
        status: "current",
        outputSummary: "Prepared",
      },
      {
        nodeId: "answer",
        nodeLayerId: definitionLayerId(graph, "answer"),
        status: "current",
        waitKind: "user_input",
        outputSummary: "Need operator input",
      },
    ];
    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      compiledPlan,
      graph,
      results,
    });

    const page = await getTaskPage(task.id);

    expect(page.task.executionSummary).toMatchObject({
      taskId: task.id,
      executionState: "waiting_for_user",
      currentNodeId: "answer",
      graphVersion: 0,
      primaryAction: { type: "provide_input", enabled: true },
      progress: { completed: 1, total: 2, percent: 50 },
      waiting: { reason: "Need operator input", nodeId: "answer" },
    });
    expect(page.task.graphNodeStates).toContainEqual(expect.objectContaining({
      id: "answer",
      status: "waiting_for_user",
      current: true,
      requiresAction: true,
    }));
    expect(page.reconciliation).toMatchObject({
      taskId: task.id,
      executionState: "waiting_for_user",
      currentNodeId: "answer",
      issues: [],
    });
  });

  it("returns a target node action from paused task state when graph node state is stale", async () => {
    const { workspace, task } = await seedTask("Paused action task");
    const compiledPlan = makeCompiledPlan();
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      compiledPlan,
      status: "accepted",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "orchestrator-test",
    });
    const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      compiledPlan,
      graph,
      results: [],
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: compiledPlan.editablePlanId,
        status: "Paused",
        currentNodeId: "answer",
        pauseReason: "external_dependency",
        completedNodeIds: JSON.stringify(["prepare"]),
        pausedAt: new Date("2026-05-21T00:00:00.000Z"),
      },
    });
    await rebuildTaskProjection(task.id);

    const page = await getTaskPage(task.id);

    expect(page.task.blockReason).toMatchObject({
      blockType: "external_dependency",
      scope: "plan_node",
      actionRequired: "Resume after external dependency is resolved",
      nodeId: "answer",
    });
    expect(page.task.executionSummary).toMatchObject({
      taskId: task.id,
      executionState: "blocked",
      currentNodeId: "answer",
      primaryAction: {
        type: "resume",
        enabled: true,
        label: "Resume after external dependency is resolved",
        targetNodeId: "answer",
      },
    });
    expect(page.reconciliation).toMatchObject({
      taskId: task.id,
      executionState: "blocked",
      currentNodeId: "answer",
      primaryAction: { type: "resume", targetNodeId: "answer" },
    });
    expect(page.task.graphNodeStates).toContainEqual(expect.objectContaining({
      id: "answer",
      status: "pending",
      current: true,
    }));
  });

  it("ignores stale stored block reasons for completed tasks", async () => {
    const { workspace, task } = await seedTask("Completed stale blocker task");
    const compiledPlan = makeCompiledPlan();
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      compiledPlan,
      status: "accepted",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "orchestrator-test",
    });
    const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
    const results: NodeResult[] = graph.nodes.map((node) => ({
      nodeId: node.id,
      nodeLayerId: definitionLayerId(graph, node.id),
      status: "current",
      outputSummary: `${node.id} done`,
    }));
    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      compiledPlan,
      graph,
      results,
    });
    await db.task.update({
      where: { id: task.id },
      data: {
        status: "Completed",
        blockReason: {
          blockType: "sync_stale",
          scope: "run",
          actionRequired: "Re-sync",
        },
      },
    });
    await rebuildTaskProjection(task.id);

    const page = await getTaskPage(task.id);

    expect(page.task.status).toBe("Completed");
    expect(page.task.blockReason).toBeNull();
    expect(page.task.executionSummary).toMatchObject({
      executionState: "completed",
      primaryAction: { type: "none", enabled: false },
    });
    expect(page.reconciliation).toMatchObject({
      executionState: "completed",
    });
  });

  it("maps persisted provider events into structured activity items", async () => {
    const { workspace, task } = await seedTask("Activity task");
    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        runtimeRunRef: "native-run-1",
        status: "Running",
        triggeredBy: "agent",
        startedAt: new Date("2026-05-21T00:00:00.000Z"),
      },
    });

    await db.event.createMany({
      data: [{
        eventType: "provider.run_started",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "prepare",
        nodeTitle: "Prepare context",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", nativeRunId: "native-run-1", event: { type: "run_started" } },
        dedupeKey: "activity-run-started",
        occurredAt: new Date("2026-05-21T00:00:01.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "provider.text_delta",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "prepare",
        nodeTitle: "Prepare context",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "text_delta", text: "Hello " } },
        dedupeKey: "activity-text-1",
        occurredAt: new Date("2026-05-21T00:00:02.000Z"),
        ingestSequence: 2,
      }, {
        eventType: "provider.text_delta",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "prepare",
        nodeTitle: "Prepare context",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "text_delta", text: "world" } },
        dedupeKey: "activity-text-2",
        occurredAt: new Date("2026-05-21T00:00:03.000Z"),
        ingestSequence: 3,
      }, {
        eventType: "provider.reasoning_delta",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "answer",
        nodeTitle: "Provide answer",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "reasoning_delta", text: "Thinking" } },
        dedupeKey: "activity-reasoning",
        occurredAt: new Date("2026-05-21T00:00:04.000Z"),
        ingestSequence: 4,
      }, {
        eventType: "provider.approval_required",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "answer",
        nodeTitle: "Provide answer",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "approval_required" } },
        dedupeKey: "activity-approval",
        occurredAt: new Date("2026-05-21T00:00:05.000Z"),
        ingestSequence: 5,
      }, {
        eventType: "provider.unknown",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        nodeId: "answer",
        nodeTitle: "Provide answer",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "provider_opaque", rawEventType: "provider.opaque" } },
        dedupeKey: "activity-raw",
        occurredAt: new Date("2026-05-21T00:00:06.000Z"),
        ingestSequence: 6,
      }],
    });

    const page = await getTaskPage(task.id);

    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "provider_run",
      title: "Provider run started",
      provider: "anthropic",
      runtimeName: "hermes",
      runId: "run-1",
      nativeRunId: "native-run-1",
      sourceNodeId: "prepare",
      sourceNodeTitle: "Prepare context",
      rawEventType: "run_started",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "assistant_message",
      title: "Assistant response",
      summary: "Hello world",
      assistant: { text: "Hello world", isReasoning: false, isPartial: true },
      sourceNodeId: "prepare",
    }));
    expect(page.activityTimeline.filter((item) => item.kind === "assistant_message")).toHaveLength(1);
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "reasoning",
      title: "Reasoning",
      summary: "Thinking",
      assistant: { text: "Thinking", isReasoning: true, isPartial: true },
      sourceNodeId: "answer",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "approval",
      title: "Approval required",
      tone: "warning",
      sourceNodeId: "answer",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "raw",
      title: "Provider event",
      rawEventType: "provider.opaque",
      sourceNodeId: "answer",
    }));
  });

  it("preserves provider tool details and failure tone", async () => {
    const { workspace, task } = await seedTask("Tool activity task");

    await db.event.createMany({
      data: [{
        eventType: "provider.tool_started",
        workspaceId: workspace.id,
        taskId: task.id,
        nodeId: "prepare",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "tool_started", toolName: "chrona_plan_read", label: "Read plan", inputSummary: "taskId=task-1", preview: "Loading graph" } },
        dedupeKey: "tool-started-details",
        occurredAt: new Date("2026-05-21T00:01:00.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "provider.tool_completed",
        workspaceId: workspace.id,
        taskId: task.id,
        nodeId: "prepare",
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "tool_completed", toolName: "chrona_plan_read", durationMs: 42, error: "Provider timeout" } },
        dedupeKey: "tool-completed-details",
        occurredAt: new Date("2026-05-21T00:01:01.000Z"),
        ingestSequence: 2,
      }],
    });

    const page = await getTaskPage(task.id);

    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "tool_started",
      tool: expect.objectContaining({ label: "Read plan", inputSummary: "taskId=task-1", preview: "Loading graph", state: "started" }),
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "tool_completed",
      tone: "danger",
      tool: expect.objectContaining({ name: "chrona_plan_read", durationMs: 42, error: "Provider timeout", state: "failed" }),
    }));
  });

  it("filters paged node activity only by explicit source node", async () => {
    const { workspace, task } = await seedTask("Explicit node activity task");

    await db.event.createMany({
      data: [{
        eventType: "provider.text_delta",
        workspaceId: workspace.id,
        taskId: task.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        nodeId: "prepare",
        nodeTitle: "Prepare",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "text_delta", text: "Prepare text" } },
        dedupeKey: "explicit-node-prepare",
          occurredAt: new Date("2026-05-21T00:02:00.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "provider.text_delta",
        workspaceId: workspace.id,
        taskId: task.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "text_delta", text: "Unscoped nearby text" } },
        dedupeKey: "explicit-node-unscoped",
          occurredAt: new Date("2026-05-21T00:02:01.000Z"),
        ingestSequence: 2,
      }],
    });

    const page = await getTaskActivityPage({ taskId: task.id, scope: "node", nodeId: "prepare", limit: 10 });

    expect(page.items).toEqual([expect.objectContaining({ summary: "Prepare text", sourceNodeId: "prepare" })]);
  });
});
