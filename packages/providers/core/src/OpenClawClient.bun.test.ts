import { afterEach, describe, expect, it } from "bun:test";
import { OpenClawClient } from "./OpenClawClient";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("OpenClawClient", () => {
  it("parses OpenResponses SSE deltas and function calls for feature streaming", async () => {
    globalThis.fetch = (async () => {
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Planning ","type":"response.output_text.delta"}\n\n',
        'event: response.output_item.done\n',
        'data: {"item":{"type":"function_call","name":"generate_task_plan_graph","call_id":"call-1","arguments":"{\\"title\\":\\"Plan ready\\",\\"goal\\":\\"Produce the requested plan\\",\\"summary\\":\\"Plan ready\\",\\"nodes\\":[],\\"edges\\":[]}"}}\n\n',
        'event: response.output_text.delta\n',
        'data: {"delta":"done","type":"response.output_text.delta"}\n\n',
      ].join("");

      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const client = new OpenClawClient({
      gatewayUrl: "http://gateway.local",
      gatewayToken: "secret",
    });

    const events = [] as Array<{ type: string; data: string; toolCall?: { tool: string; callId: string } }>;
    for await (const event of client.executeFeatureStream("generate_plan", {
      sessionKey: "sess-1",
      instructions: "plan this task",
      task: { title: "Write docs" },
      timeout: 5,
    })) {
      events.push({
        type: event.type,
        data: event.data,
        toolCall: event.toolCall
          ? { tool: event.toolCall.tool, callId: event.toolCall.callId }
          : undefined,
      });
    }

    expect(events).toEqual([
      { type: "text", data: "Planning ", toolCall: undefined },
      {
        type: "tool_call",
        data: JSON.stringify({
          type: "function_call",
          name: "generate_task_plan_graph",
          call_id: "call-1",
          arguments: '{"title":"Plan ready","goal":"Produce the requested plan","summary":"Plan ready","nodes":[],"edges":[]}',
        }),
        toolCall: { tool: "generate_task_plan_graph", callId: "call-1" },
      },
      { type: "text", data: "done", toolCall: undefined },
    ]);
  });
});
