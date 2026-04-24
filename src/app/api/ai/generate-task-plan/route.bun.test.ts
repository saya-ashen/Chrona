import { beforeEach, describe, expect, it, mock } from "bun:test";

const getLatestTaskPlanGraph = mock();
const saveTaskPlanGraph = mock();
const aiGeneratePlan = mock();
const aiGeneratePlanStream = mock();
const findUnique = mock();
const ensureDefaultTaskSession = mock();

mock.module("@/modules/tasks/task-plan-graph-store", () => ({
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
}));

mock.module("@/modules/ai/ai-service", () => ({
  aiGeneratePlan,
  aiGeneratePlanStream,
}));

mock.module("@/modules/task-execution/task-sessions", () => ({
  ensureDefaultTaskSession,
}));

mock.module("@/lib/db", () => ({
  db: {
    task: {
      findUnique,
    },
  },
}));

const { POST } = await import("@/app/api/ai/generate-task-plan/route");

describe("POST /api/ai/generate-task-plan", () => {
  beforeEach(() => {
    getLatestTaskPlanGraph.mockReset();
    saveTaskPlanGraph.mockReset();
    aiGeneratePlan.mockReset();
    aiGeneratePlanStream.mockReset();
    findUnique.mockReset();
    ensureDefaultTaskSession.mockReset();
    ensureDefaultTaskSession.mockResolvedValue({ id: "sess-1", sessionKey: "chrona:openclaw:task:task-2:default" });
  });

  it("returns saved graph when available and not force-refreshing", async () => {
    getLatestTaskPlanGraph.mockResolvedValue({
      id: "plan-1",
      status: "accepted",
      prompt: "existing guidance",
      revision: 2,
      summary: "Saved graph",
      updatedAt: "2026-04-19T20:00:00.000Z",
      plan: {
        id: "graph-1",
        nodes: [
          {
            id: "node-1",
            type: "step",
            title: "Auto step",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
          },
        ],
        edges: [],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1" }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.source).toBe("saved");
    expect(data.planGraph.id).toBe("graph-1");
    expect(data.planGraph.nodes[0].autoRunnable).toBe(true);
    expect(data.savedPlan.id).toBe("plan-1");
    // No subtasks field
    expect(data.subtasks).toBeUndefined();
    expect(aiGeneratePlan).not.toHaveBeenCalled();
  });

  it("passes resolved task session key into blocking AI generate-plan calls", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-2",
      workspaceId: "ws-1",
      title: "Prepare report",
      description: "Summarize findings",
      scheduledStartAt: null,
      scheduledEndAt: null,
      defaultSessionId: undefined,
    });
    aiGeneratePlan.mockResolvedValue({
      nodes: [],
      edges: [],
      summary: "ok",
      source: "openclaw",
    });
    saveTaskPlanGraph.mockResolvedValue({
      id: "plan-2",
      status: "draft",
      prompt: null,
      revision: 1,
      summary: "ok",
      updatedAt: "2026-04-20T10:00:00.000Z",
      plan: { id: "graph-2", nodes: [], edges: [] },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-2" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(aiGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-2",
        sessionKey: "chrona:openclaw:task:task-2:default",
      }),
    );
  });

  it("generates graph-native plan via AI when no saved plan exists", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-2",
      workspaceId: "ws-1",
      title: "Prepare report",
      description: "Summarize findings",
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    aiGeneratePlan.mockResolvedValue({
      nodes: [
        {
          id: "node-1",
          type: "step",
          title: "Collect evidence",
          objective: "Gather the raw material",
          description: null,
          status: "pending",
          phase: null,
          estimatedMinutes: 30,
          priority: "High",
          executionMode: "automatic",
          requiresHumanInput: false,
          requiresHumanApproval: false,
          autoRunnable: true,
          blockingReason: null,
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
        {
          id: "node-2",
          type: "user_input",
          title: "Confirm direction with user",
          objective: "Get user approval before proceeding",
          description: null,
          status: "pending",
          phase: null,
          estimatedMinutes: 10,
          priority: "Medium",
          executionMode: "manual",
          requiresHumanInput: true,
          requiresHumanApproval: true,
          autoRunnable: false,
          blockingReason: "needs_user_input",
          linkedTaskId: null,
          completionSummary: null,
          metadata: null,
        },
      ],
      edges: [
        { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential", metadata: null },
      ],
      summary: "2 planned steps",
      reasoning: "Separated auto/manual steps",
      source: "llm",
    });
    saveTaskPlanGraph.mockResolvedValue({
      id: "plan-2",
      status: "draft",
      prompt: null,
      revision: 1,
      summary: "2 planned steps",
      updatedAt: "2026-04-20T10:00:00.000Z",
      plan: {
        id: "graph-2",
        nodes: [
          { id: "node-1", type: "step", executionMode: "automatic", autoRunnable: true },
          { id: "node-2", type: "user_input", executionMode: "manual", autoRunnable: false },
        ],
        edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential" }],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-2" }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.source).toBe("llm");
    expect(data.planGraph.nodes).toHaveLength(2);
    expect(data.planGraph.nodes[0].autoRunnable).toBe(true);
    expect(data.planGraph.nodes[1].autoRunnable).toBe(false);
    // No subtasks field
    expect(data.subtasks).toBeUndefined();
    expect(data.feasibilityScore).toBeUndefined();
    expect(data.totalEstimatedMinutes).toBeUndefined();
  });

  it("returns 503 when AI is unavailable", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-3",
      workspaceId: "ws-1",
      title: "Some task",
      description: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    aiGeneratePlan.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-3" }),
      }),
    );

    expect(response.status).toBe(503);
  });
});
