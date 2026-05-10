import { afterEach, describe, expect, it } from "bun:test";
import { OpenClawClient } from "./OpenClawClient";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const realFetch = globalThis.fetch;
const realOpenClawDump = process.env.CHRONA_OPENCLAW_DUMP;
const realOpenClawDumpDir = process.env.CHRONA_OPENCLAW_DUMP_DIR;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realOpenClawDump === undefined) {
    delete process.env.CHRONA_OPENCLAW_DUMP;
  } else {
    process.env.CHRONA_OPENCLAW_DUMP = realOpenClawDump;
  }
  if (realOpenClawDumpDir === undefined) {
    delete process.env.CHRONA_OPENCLAW_DUMP_DIR;
  } else {
    process.env.CHRONA_OPENCLAW_DUMP_DIR = realOpenClawDumpDir;
  }
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
    for await (const event of client.stream({
      request: {
        sessionId: "sess-1",
        sessionKey: "sess-1",
        feature: "generate_plan",
        body: {
          model: "openclaw",
          user: "sess-1",
          instructions: "plan this task",
          input: [{ type: "message", role: "user", content: "Write docs" }],
          stream: true,
        },
        timeoutSeconds: 5,
      },
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

  it("extracts function calls from response.completed when output_item events are missing", async () => {
    globalThis.fetch = (async () => {
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Planning ","type":"response.output_text.delta"}\n\n',
        'event: response.completed\n',
        'data: {"response":{"id":"resp-1","status":"completed","output":[{"type":"function_call","name":"generate_task_plan_graph","call_id":"call-2","arguments":"{\\"title\\":\\"Plan ready\\",\\"goal\\":\\"Produce the requested plan\\",\\"summary\\":\\"Plan ready\\",\\"nodes\\":[],\\"edges\\":[]}"}]}}\n\n',
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
    for await (const event of client.stream({
      request: {
        sessionId: "sess-2",
        sessionKey: "sess-2",
        feature: "generate_plan",
        body: {
          model: "openclaw",
          user: "sess-2",
          instructions: "plan this task",
          input: [{ type: "message", role: "user", content: "Write docs" }],
          stream: true,
        },
        timeoutSeconds: 5,
      },
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
          call_id: "call-2",
          arguments:
            '{"title":"Plan ready","goal":"Produce the requested plan","summary":"Plan ready","nodes":[],"edges":[]}',
        }),
        toolCall: { tool: "generate_task_plan_graph", callId: "call-2" },
      },
    ]);
  });

  it("dumps raw gateway stream events when enabled", async () => {
    const dumpDir = await mkdtemp(join(tmpdir(), "chrona-openclaw-dump-"));
    process.env.CHRONA_OPENCLAW_DUMP = "1";
    process.env.CHRONA_OPENCLAW_DUMP_DIR = dumpDir;

    globalThis.fetch = (async () => {
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Planning","type":"response.output_text.delta"}\n\n',
        'data: [DONE]\n\n',
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

    for await (const _event of client.stream({
      request: {
        sessionId: "sess-dump",
        sessionKey: "sess-dump",
        feature: "generate_plan",
        body: {
          model: "openclaw",
          user: "sess-dump",
          instructions: "plan this task",
          input: [{ type: "message", role: "user", content: "Write docs" }],
          stream: true,
        },
        timeoutSeconds: 5,
      },
    })) {
      // Consume stream to completion so the dump file is closed.
    }

    const files = await readdir(dumpDir);
    expect(files.length).toBe(1);

    const content = await readFile(join(dumpDir, files[0]!), "utf8");
    expect(content).toContain('"type":"meta"');
    expect(content).toContain('"type":"response"');
    expect(content).toContain('"type":"chunk"');
    expect(content).toContain('"type":"event"');
    expect(content).toContain('"type":"done_marker"');

    await rm(dumpDir, { recursive: true, force: true });
  });
});
