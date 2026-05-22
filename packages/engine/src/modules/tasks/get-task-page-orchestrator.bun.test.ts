import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getTaskPage } from "@/modules/tasks/get-task-page";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { createPlanGraphFromCompiledPlan, savePlanRun } from "@/modules/plan-execution/plan-run-store";
import type { CompiledPlan, NodeResult } from "@chrona/contracts/ai";

async function resetDb() {
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.executionSession.deleteMany();
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
});
