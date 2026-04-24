import { beforeEach, describe, expect, it, mock } from "bun:test";

const aiGeneratePlanStream = mock();
const getLatestTaskPlanGraph = mock();
const saveTaskPlanGraph = mock();
const findUnique = mock();
const ensureDefaultTaskSession = mock();

mock.module("@/modules/ai/ai-service", () => ({
  aiGeneratePlan: mock(async () => null),
  aiGeneratePlanStream,
}));
mock.module("@/modules/tasks/task-plan-graph-store", () => ({
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
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

describe("POST /api/ai/generate-task-plan stream", () => {
  beforeEach(() => {
    aiGeneratePlanStream.mockReset();
    getLatestTaskPlanGraph.mockReset();
    saveTaskPlanGraph.mockReset();
    findUnique.mockReset();
    ensureDefaultTaskSession.mockReset();
    ensureDefaultTaskSession.mockResolvedValue({ id: "sess-1", sessionKey: "chrona:openclaw:task:task-1:default" });
  });

  it("streams saved plans without crashing when a saved graph already exists", async () => {
    findUnique.mockResolvedValue({
      id: "task-1",
      workspaceId: "ws-1",
      title: "Plan task",
      description: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      defaultSessionId: undefined,
    });
    getLatestTaskPlanGraph.mockResolvedValue({
      id: "plan-saved-1",
      status: "accepted",
      prompt: "existing guidance",
      revision: 2,
      summary: "Saved graph",
      updatedAt: "2026-04-20T10:00:00.000Z",
      plan: {
        id: "graph-saved-1",
        taskId: "task-1",
        status: "accepted",
        revision: 2,
        source: "ai",
        generatedBy: "openclaw",
        prompt: null,
        summary: "Saved graph",
        changeSummary: null,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        nodes: [],
        edges: [],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ taskId: "task-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: result");
    expect(text).toContain("Saved graph");
    expect(text).toContain("event: done");
    expect(aiGeneratePlanStream).not.toHaveBeenCalled();
  });

  it("returns SSE and includes process/tool events before final result", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-1",
      workspaceId: "ws-1",
      title: "Plan task",
      description: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    aiGeneratePlanStream.mockImplementation(async function* () {
      yield { type: "status", message: "Planning graph" };
      yield { type: "tool_call", tool: "generate_task_plan_graph", input: { title: "Plan task" } };
      yield { type: "tool_result", tool: "generate_task_plan_graph", result: "graph with 0 nodes" };
      yield {
        type: "result",
        plan: {
          nodes: [],
          edges: [],
          summary: "Plan ready",
          reasoning: "done",
          source: "openclaw",
        },
      };
      yield { type: "done" };
    });
    saveTaskPlanGraph.mockResolvedValue({
      id: "plan-1",
      status: "draft",
      prompt: null,
      revision: 1,
      summary: "Plan ready",
      updatedAt: "2026-04-20T10:00:00.000Z",
      plan: {
        id: "graph-1",
        taskId: "task-1",
        status: "draft",
        revision: 1,
        source: "ai",
        generatedBy: "openclaw",
        prompt: null,
        summary: "Plan ready",
        changeSummary: null,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        nodes: [],
        edges: [],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ taskId: "task-1" }),
      }),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: status");
    expect(text).toContain("Planning graph");
    expect(text).toContain("event: tool_call");
    expect(text).toContain("generate_task_plan_graph");
    expect(text).not.toContain('"tool":"unexpected_legacy_tool"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("graph with 0 nodes");
    expect(text).toContain("event: result");
    expect(text).toContain("Plan ready");
    expect(text).toContain('"taskSessionKey":"chrona:openclaw:task:task-1:default"');
    expect(ensureDefaultTaskSession).toHaveBeenCalledWith({
      taskId: "task-1",
      taskTitle: "Plan task",
      runtimeName: "openclaw",
      defaultSessionId: undefined,
    });
    expect(aiGeneratePlanStream).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        sessionKey: "chrona:openclaw:task:task-1:default",
      }),
    );
  });

  it("does not crash when stream closes before late events complete", async () => {
    getLatestTaskPlanGraph.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "task-1",
      workspaceId: "ws-1",
      title: "Plan task",
      description: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    aiGeneratePlanStream.mockImplementation(async function* () {
      yield { type: "status", message: "Planning graph" };
      yield { type: "done" };
      yield { type: "error", message: "late error after done" };
    });

    const response = await POST(
      new Request("http://localhost/api/ai/generate-task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ taskId: "task-1" }),
      }),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: done");
    expect(text).not.toContain("late error after done");
  });
});
