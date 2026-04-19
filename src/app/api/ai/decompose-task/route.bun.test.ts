import { beforeEach, describe, expect, it, mock } from "bun:test";

const getLatestTaskPlanGraph = mock();
const saveTaskPlanGraph = mock();
const taskPlanGraphToDecompositionResult = mock();
const aiDecompose = mock();
const decomposeTaskSmart = mock();
const findUnique = mock();

mock.module("@/modules/tasks/task-plan-graph-store", () => ({
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
  taskPlanGraphToDecompositionResult,
}));

mock.module("@/modules/ai/ai-service", () => ({
  aiDecompose,
}));

mock.module("@/modules/ai/task-decomposer", () => ({
  decomposeTaskSmart,
}));

mock.module("@/lib/db", () => ({
  db: {
    task: {
      findUnique,
    },
  },
}));

const { POST } = await import("@/app/api/ai/decompose-task/route");

describe("POST /api/ai/decompose-task", () => {
  beforeEach(() => {
    getLatestTaskPlanGraph.mockReset();
    saveTaskPlanGraph.mockReset();
    taskPlanGraphToDecompositionResult.mockReset();
    aiDecompose.mockReset();
    decomposeTaskSmart.mockReset();
    findUnique.mockReset();
  });

  it("returns saved graph-backed plans before regenerating", async () => {
    getLatestTaskPlanGraph.mockResolvedValue({
      id: "plan-1",
      status: "accepted",
      prompt: "existing guidance",
      revision: 2,
      summary: "Saved graph",
      updatedAt: "2026-04-19T20:00:00.000Z",
      plan: { id: "graph-1" },
    });
    taskPlanGraphToDecompositionResult.mockReturnValue({
      subtasks: [
        {
          title: "Saved step",
          estimatedMinutes: 25,
          priority: "High",
          order: 1,
          dependsOnPrevious: false,
        },
      ],
      totalEstimatedMinutes: 25,
      feasibilityScore: 90,
      warnings: [],
    });

    const response = await POST(
      new Request("http://localhost/api/ai/decompose-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "saved",
      savedPlan: {
        id: "plan-1",
        status: "accepted",
        prompt: "existing guidance",
        revision: 2,
        summary: "Saved graph",
      },
      planGraph: { id: "graph-1" },
      subtasks: [{ title: "Saved step" }],
    });
    expect(aiDecompose).not.toHaveBeenCalled();
    expect(decomposeTaskSmart).not.toHaveBeenCalled();
  });

  it("saves adapter-generated results as graph-native drafts", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-2",
      workspaceId: "ws-1",
      title: "Prepare report",
      description: "Summarize findings",
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    aiDecompose.mockResolvedValue({
      subtasks: [
        {
          title: "Collect evidence",
          description: "Gather the raw material",
          estimatedMinutes: 30,
          priority: "High",
          order: 1,
          dependsOnPrevious: false,
        },
        {
          title: "Confirm with user",
          description: "Wait for user approval before publishing",
          estimatedMinutes: 10,
          priority: "Medium",
          order: 2,
          dependsOnPrevious: true,
        },
      ],
      reasoning: "Adapter generated steps",
      source: "adapter",
    });
    saveTaskPlanGraph.mockResolvedValue({
      id: "plan-2",
      status: "draft",
      prompt: "be concise",
      revision: 1,
      summary: "2 planned items",
      updatedAt: "2026-04-19T20:30:00.000Z",
      plan: {
        id: "graph-2",
        nodes: [
          { id: "node-1", type: "deliverable", executionMode: "child_task" },
          { id: "node-2", type: "user_input", executionMode: "none" },
        ],
        edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential" }],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/decompose-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: "task-2",
          planningPrompt: "be concise",
        }),
      }),
    );

    expect(saveTaskPlanGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        taskId: "task-2",
        prompt: "be concise",
        status: "draft",
        source: "ai",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      subtasks: [{ title: "Collect evidence" }, { title: "Confirm with user" }],
      savedPlan: {
        id: "plan-2",
        status: "draft",
        prompt: "be concise",
        revision: 1,
        summary: "2 planned items",
      },
      planGraph: {
        id: "graph-2",
        nodes: [
          { id: "node-1", type: "deliverable", executionMode: "child_task" },
          { id: "node-2", type: "user_input", executionMode: "none" },
        ],
      },
    });
  });
});
