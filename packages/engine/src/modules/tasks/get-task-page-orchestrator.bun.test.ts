import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getTaskPage } from "@/modules/tasks/get-task-page";
import { getTaskBootstrap } from "@/modules/tasks/get-task-bootstrap";
import { getTaskActivityPage } from "@/modules/tasks/task-activity";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { createPlanGraphFromCompiledPlan, savePlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
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

  it("returns projected block detail for task page and bootstrap", async () => {
    const { workspace, task } = await seedTask("Failed run page task");
    await db.task.update({ where: { id: task.id }, data: { status: "Blocked" } });
    await db.taskProjection.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        persistedStatus: "Blocked",
        displayState: "Attention Needed",
        blockType: "run_failed",
        actionRequired: "Retry Run",
        blockScope: "run",
        blockDetail: "ACP connection closed",
        currentNodeId: "failed-node",
        lastActivityAt: new Date("2026-05-21T00:00:00.000Z"),
        updatedAt: new Date("2026-05-21T00:00:00.000Z"),
      },
    });

    const page = await getTaskPage(task.id);
    const bootstrap = await getTaskBootstrap({ taskId: task.id });

    expect(page.task.blockReason).toMatchObject({
      blockType: "run_failed",
      actionRequired: "Retry Run",
      detail: "ACP connection closed",
      scope: "run",
      nodeId: "failed-node",
    });
    expect(bootstrap.task.blockReason).toMatchObject({ detail: "ACP connection closed" });
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
    expect(page.task.recurrenceOccurrences).toEqual([
      expect.objectContaining({ taskId: task.id, workBlockId: firstBlock.id, isCurrent: false }),
      expect.objectContaining({ taskId: task.id, workBlockId: secondBlock.id, isCurrent: true }),
    ]);
  });

  it("does not reuse a task-level plan for a selected unstarted recurring occurrence", async () => {
    const { workspace, task } = await seedTask("Recurring plan isolation task");
    const completedBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
        scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    const futureBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-08T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T10:00:00.000Z"),
        trigger: "manual",
      },
    });
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
    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      compiledPlan,
      graph: createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan }),
      results: [],
    });

    const page = await getTaskPage({ taskId: task.id, workBlockId: futureBlock.id });

    expect(page.task.currentWorkBlock?.id).toBe(futureBlock.id);
    expect(page.task.status).toBe("Scheduled");
    expect(page.task.savedPlan?.id).toBe(compiledPlan.editablePlanId);
    expect(page.task.aiPlanGenerationStatus).toBe("accepted");
    expect(page.task.executionSummary).toMatchObject({ executionState: "queued", currentNodeId: "prepare" });
    expect(page.task.recurrenceOccurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ workBlockId: completedBlock.id, status: "Completed", isCurrent: false }),
      expect.objectContaining({ workBlockId: futureBlock.id, status: "Scheduled", isCurrent: true }),
    ]));
  });

  it("returns the plan scoped to the selected recurring occurrence", async () => {
    const { workspace, task } = await seedTask("Recurring scoped plan task");
    const firstBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
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
        scheduledStartAt: new Date("2026-06-08T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    const firstPlan = { ...makeCompiledPlan(), editablePlanId: "first-occurrence-plan", title: "First occurrence plan" };
    const secondPlan = { ...makeCompiledPlan(), editablePlanId: "second-occurrence-plan", title: "Second occurrence plan" };
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: firstBlock.id,
      compiledPlan: firstPlan,
      status: "accepted",
      prompt: firstPlan.title,
      summary: firstPlan.goal,
      generatedBy: "orchestrator-test",
    });
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: secondBlock.id,
      compiledPlan: secondPlan,
      status: "accepted",
      prompt: secondPlan.title,
      summary: secondPlan.goal,
      generatedBy: "orchestrator-test",
    });

    const firstPage = await getTaskPage({ taskId: task.id, workBlockId: firstBlock.id });
    const secondPage = await getTaskPage({ taskId: task.id, workBlockId: secondBlock.id });

    expect(firstPage.task.savedPlan?.id).toBe("first-occurrence-plan");
    expect(secondPage.task.savedPlan?.id).toBe("second-occurrence-plan");
    expect(firstPage.task.savedPlan?.id).not.toBe(secondPage.task.savedPlan?.id);
  });

  it("keeps bootstrap current work block and saved plan on the same in-window occurrence", async () => {
    const { workspace, task } = await seedTask("Recurring bootstrap scoped plan task");
    const now = new Date();
    const currentBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date(now.getTime() - 5 * 60_000),
        scheduledEndAt: new Date(now.getTime() + 55 * 60_000),
        trigger: "manual",
      },
    });
    const futureBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date(now.getTime() + 24 * 60 * 60_000),
        scheduledEndAt: new Date(now.getTime() + 25 * 60 * 60_000),
        trigger: "manual",
      },
    });
    const scopedPlan = { ...makeCompiledPlan(), editablePlanId: "current-occurrence-draft", title: "Current occurrence draft" };

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: currentBlock.id,
      compiledPlan: scopedPlan,
      status: "draft",
      prompt: scopedPlan.title,
      summary: scopedPlan.goal,
      generatedBy: "orchestrator-test",
    });

    const page = await getTaskBootstrap({ taskId: task.id });

    expect(page.task.currentWorkBlock?.id).toBe(currentBlock.id);
    expect(page.task.currentWorkBlock?.id).not.toBe(futureBlock.id);
    expect(page.task.savedPlan?.id).toBe(scopedPlan.editablePlanId);
    expect(page.task.aiPlanGenerationStatus).toBe("waiting_acceptance");
  });

  it("returns recurrence series occurrences for workspace switching", async () => {
    const { workspace, task } = await seedTask("Recurring series task");
    await db.task.update({ where: { id: task.id }, data: { recurrenceRule: "FREQ=DAILY", seriesExternalUid: task.id } });
    const nextTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: task.title,
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run recurring task" },
        recurrenceRule: "FREQ=DAILY",
        seriesExternalUid: task.id,
      },
    });
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
    const nextBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: nextTask.id,
        title: nextTask.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-02T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-02T10:00:00.000Z"),
        trigger: "manual",
      },
    });

    const page = await getTaskPage(task.id);

    expect(page.task.recurrenceOccurrences.map((occurrence) => occurrence.workBlockId)).toEqual(expect.arrayContaining([firstBlock.id, nextBlock.id]));
    expect(page.task.recurrenceOccurrences.find((occurrence) => occurrence.workBlockId === firstBlock.id)?.isCurrent).toBe(true);
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

  it("keeps an accepted Done task authoritative over its completed work block", async () => {
    const { task } = await seedTask("Accepted scheduled task");
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: task.workspaceId,
        taskId: task.id,
        title: "Accepted occurrence",
        scheduledStartAt: new Date("2026-07-15T01:00:00.000Z"),
        scheduledEndAt: new Date("2026-07-15T02:00:00.000Z"),
        status: "Completed",
        trigger: "manual",
      },
    });
    await db.task.update({
      where: { id: task.id },
      data: { status: "Done", completedAt: new Date("2026-07-15T03:00:00.000Z") },
    });

    const page = await getTaskBootstrap({ taskId: task.id, workBlockId: workBlock.id });

    expect(page.task.status).toBe("Done");
    expect(page.task.currentWorkBlock?.status).toBe("Completed");
    expect(page.task.scheduleStatus).toBe("Completed");
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

  it("does not fabricate a block reason from a projection with no block fields", async () => {
    const { workspace, task } = await seedTask("Completed occurrence without blocker");
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
    // Projection is rebuilt with a currentNodeId but no block fields; the task is
    // not Completed, so the stale-completed guard does not apply.
    await rebuildTaskProjection(task.id);

    const page = await getTaskPage(task.id);

    expect(page.task.status).not.toBe("Completed");
    expect(page.task.blockReason).toBeNull();
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
    expect(page.activityTimeline).not.toContainEqual(expect.objectContaining({
      kind: "raw",
      title: "Provider event",
      rawEventType: "provider.opaque",
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
        payload: { runtimeName: "omp", provider: "omp", runId: "run-1", event: { type: "tool_started", toolName: "read", callId: "call-1", label: "Read source", input: { path: "src/app.ts", apiKey: "secret-value" }, preview: "Inspect application source" } },
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
        payload: { runtimeName: "omp", provider: "omp", runId: "run-1", event: { type: "tool_completed", toolName: "read", callId: "call-1", durationMs: 42, result: { content: [{ type: "text", text: "export const ready = true;" }] } } },
        dedupeKey: "tool-completed-details",
        occurredAt: new Date("2026-05-21T00:01:01.000Z"),
        ingestSequence: 2,
      }],
    });

    const page = await getTaskPage(task.id);

    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "tool_started",
      tool: expect.objectContaining({ label: "Read source", callId: "call-1", inputSummary: expect.stringContaining("src/app.ts"), preview: "Inspect application source", state: "started" }),
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "tool_completed",
      tone: "success",
      tool: expect.objectContaining({ name: "read", callId: "call-1", durationMs: 42, resultPreview: expect.stringContaining("export const ready = true;"), state: "completed" }),
    }));
    expect(JSON.stringify(page.activityTimeline)).not.toContain("secret-value");
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
