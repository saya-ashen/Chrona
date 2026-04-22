import { describe, expect, it, mock } from "bun:test";
import type { AiClientRecord, GenerateTaskPlanRequest } from "@/modules/ai/client/types";

const fetchMock = mock();
(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

const { generatePlanStream } = await import("@/modules/ai/client/streaming");

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/event-stream" : null) },
    body: streamBody,
    text: async () => "",
    json: async () => {
      throw new Error("stream-only response");
    },
  };
}

describe("generatePlanStream", () => {
  it("maps OpenClaw SSE events and derives final plan from generate_task_plan_graph tool input", async () => {
    fetchMock.mockReset();
    const sessionIds: string[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string };
      sessionIds.push(String(body.sessionId ?? ""));
      return Promise.resolve(
        sseResponse([
          'event: event\ndata: {"type":"lifecycle","phase":"planning","message":"Planning graph"}\n\n',
          'event: event\ndata: {"type":"tool_use","tool":"generate_task_plan_graph","callId":"call-1","input":{"taskId":"task-1","title":"Plan task","summary":"Plan ready","reasoning":"because","nodes":[{"id":"node-1","type":"step","title":"Draft plan","objective":"Draft plan","estimatedMinutes":30,"priority":"High","executionMode":"automatic","requiresHumanInput":false,"requiresHumanApproval":false,"autoRunnable":true}],"edges":[]}}\n\n',
          'event: event\ndata: {"type":"tool_result","tool":"generate_task_plan_graph","callId":"call-1","text":"ok"}\n\n',
          'event: done\ndata: {"output":"done","structured":null}\n\n',
        ]),
      );
    });

    const client: AiClientRecord = {
      id: "c1",
      name: "openclaw",
      type: "openclaw",
      config: { bridgeUrl: "http://bridge.test", timeoutSeconds: 30 },
      isDefault: true,
      enabled: true,
    };
    const request: GenerateTaskPlanRequest = { taskId: "task-1", title: "Plan task" };

    const events = [] as Array<{ type: string; [key: string]: unknown }>;
    for await (const event of generatePlanStream(client, request)) {
      events.push(event as never);
    }

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "status",
      "status",
      "tool_call",
      "tool_result",
      "result",
      "done",
    ]);
    expect(events[0]?.message).toBe("正在连接 AI 服务...");
    expect(events[1]?.message).toBe("AI 正在思考...");
    expect(events[2]?.message).toBe("Planning graph");
    expect(events[3]).toMatchObject({ type: "tool_call", tool: "generate_task_plan_graph" });
    expect(events[4]).toMatchObject({ type: "tool_result", tool: "generate_task_plan_graph" });
    expect(events[5]).toMatchObject({
      type: "result",
      plan: {
        summary: "Plan ready",
        nodes: [expect.objectContaining({ title: "Draft plan" })],
      },
    });
    expect(events[6]).toMatchObject({ type: "done" });
    expect(sessionIds[0]).toContain("task-1-plan-task");
  });

  it("uses different generate_plan sessions for repeated requests on the same task", async () => {
    fetchMock.mockReset();
    const sessionIds: string[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string };
      sessionIds.push(String(body.sessionId ?? ""));
      return Promise.resolve(
        sseResponse([
          'event: done\ndata: {"output":"{\"summary\":\"Plan ready\",\"nodes\":[],\"edges\":[]}","structured":null}\n\n',
        ]),
      );
    });

    const client: AiClientRecord = {
      id: "c1",
      name: "openclaw",
      type: "openclaw",
      config: { bridgeUrl: "http://bridge.test", timeoutSeconds: 30 },
      isDefault: true,
      enabled: true,
    };
    const request: GenerateTaskPlanRequest = { taskId: "task-1", title: "Plan task" };

    for await (const _event of generatePlanStream(client, request)) {}
    for await (const _event of generatePlanStream(client, request)) {}

    expect(sessionIds).toHaveLength(2);
    expect(sessionIds[0]).not.toBe(sessionIds[1]);
    expect(sessionIds[0]).toContain("task-1-plan-task");
    expect(sessionIds[1]).toContain("task-1-plan-task");
  });
});
