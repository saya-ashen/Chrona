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
  it("maps OpenClaw SSE events including lifecycle/tool-call output into stream events", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      sseResponse([
        'event: event\ndata: {"type":"lifecycle","phase":"planning","message":"Planning graph"}\n\n',
        'event: event\ndata: {"type":"tool_use","tool":"submit_structured_result","callId":"call-1","input":{"schemaName":"task_plan_graph"}}\n\n',
        'event: event\ndata: {"type":"tool_result","tool":"submit_structured_result","callId":"call-1","text":"ok"}\n\n',
        'event: done\ndata: {"output":"{\"summary\":\"Plan ready\",\"nodes\":[],\"edges\":[]}","structured":null}\n\n',
      ]),
    );

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
    expect(events[3]).toMatchObject({ type: "tool_call", tool: "submit_structured_result" });
    expect(events[4]).toMatchObject({ type: "tool_result", tool: "submit_structured_result" });
    expect(events[5]).toMatchObject({ type: "result" });
    expect(events[6]).toMatchObject({ type: "done" });
  });
});
