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
        'data: {"item":{"type":"function_call","name":"chrona_plan_generate","call_id":"call-1","arguments":"{\\"title\\":\\"Plan ready\\",\\"goal\\":\\"Produce the requested plan\\",\\"summary\\":\\"Plan ready\\",\\"nodes\\":[],\\"edges\\":[]}"}}\n\n',
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

    const events = [] as Array<{ type: string; text?: string; toolCall?: { tool: string; callId: string } }>;
    for await (const event of client.streamRun({
      sessionId: "sess-1",
      sessionKey: "sess-1",
      instructions: "plan this task",
      input: { prompt: "Write docs" },
      structuredOutputSchema: {
        name: "chrona_plan_generate",
        description: "Return a generated plan graph.",
        schema: { type: "object" },
      },
      timeoutMs: 5_000,
      stream: true,
    })) {
      events.push({
        type: event.type,
        text: event.type === "text_delta" ? event.text : undefined,
        toolCall: event.type === "tool_call"
          ? { tool: event.tool, callId: event.callId }
          : undefined,
      });
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Planning ", toolCall: undefined },
      {
        type: "tool_call",
        toolCall: { tool: "chrona_plan_generate", callId: "call-1" },
        text: undefined,
      },
      { type: "text_delta", text: "done", toolCall: undefined },
      { type: "run_completed", text: undefined, toolCall: undefined },
    ]);
  });

  it("extracts function calls from response.completed when output_item events are missing", async () => {
    globalThis.fetch = (async () => {
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Planning ","type":"response.output_text.delta"}\n\n',
        'event: response.completed\n',
        'data: {"response":{"id":"resp-1","status":"completed","output":[{"type":"function_call","name":"chrona_plan_generate","call_id":"call-2","arguments":"{\\"title\\":\\"Plan ready\\",\\"goal\\":\\"Produce the requested plan\\",\\"summary\\":\\"Plan ready\\",\\"nodes\\":[],\\"edges\\":[]}"}]}}\n\n',
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

    const events = [] as Array<{ type: string; text?: string; toolCall?: { tool: string; callId: string } }>;
    for await (const event of client.streamRun({
      sessionId: "sess-2",
      sessionKey: "sess-2",
      instructions: "plan this task",
      input: { prompt: "Write docs" },
      structuredOutputSchema: {
        name: "chrona_plan_generate",
        description: "Return a generated plan graph.",
        schema: { type: "object" },
      },
      timeoutMs: 5_000,
      stream: true,
    })) {
      events.push({
        type: event.type,
        text: event.type === "text_delta" ? event.text : undefined,
        toolCall: event.type === "tool_call"
          ? { tool: event.tool, callId: event.callId }
          : undefined,
      });
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Planning ", toolCall: undefined },
      {
        type: "tool_call",
        toolCall: { tool: "chrona_plan_generate", callId: "call-2" },
        text: undefined,
      },
      { type: "run_completed", text: undefined, toolCall: undefined },
    ]);
  });

  it("stops execute-task-node streams after terminal task completion tool call", async () => {
    globalThis.fetch = (async () => {
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Working ","type":"response.output_text.delta"}\n\n',
        'event: response.output_item.done\n',
        'data: {"item":{"type":"function_call","name":"chrona_task_complete","call_id":"call-task-complete","arguments":"{\\"summary\\":\\"Done\\"}"}}\n\n',
        'event: response.output_text.delta\n',
        'data: {"delta":"should-not-stream","type":"response.output_text.delta"}\n\n',
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

    const events = [] as Array<{
      type: string;
      text?: string;
      toolCall?: { tool: string; callId: string };
      structuredToolName?: string | null;
    }>;
    for await (const event of client.streamRun({
      sessionId: "sess-node",
      sessionKey: "sess-node",
      instructions: "execute current node",
      input: { node: { title: "Do work" } },
      terminalToolName: "chrona_task_complete",
      timeoutMs: 5_000,
      stream: true,
    })) {
      events.push({
        type: event.type,
        text: event.type === "text_delta" ? event.text : undefined,
        toolCall: event.type === "tool_call"
          ? { tool: event.tool, callId: event.callId }
          : undefined,
        structuredToolName: event.type === "run_completed" && event.structuredPayload && typeof event.structuredPayload === "object"
          ? (event.structuredPayload as { toolName?: string | null }).toolName ?? null
          : undefined,
      });
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Working ", toolCall: undefined, structuredToolName: undefined },
      {
        type: "tool_call",
        toolCall: { tool: "chrona_task_complete", callId: "call-task-complete" },
        text: undefined,
        structuredToolName: undefined,
      },
      {
        type: "run_completed",
        text: undefined,
        toolCall: undefined,
        structuredToolName: "chrona_task_complete",
      },
    ]);
  });

  it("aggregates streamed responses in startRun using the same SSE path", async () => {
    let seenStream: unknown;
    let seenModel: unknown;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body)) as {
          stream?: unknown;
          model?: unknown;
        };
        seenStream = body.stream;
        seenModel = body.model;
      }
      const sse = [
        'event: response.output_text.delta\n',
        'data: {"delta":"Hello ","type":"response.output_text.delta"}\n\n',
        'event: response.completed\n',
        'data: {"response":{"id":"resp-create","status":"completed","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5},"output":[{"type":"message","content":[{"type":"output_text","text":"Hello world"}]}]}}\n\n',
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

    const result = await client.startRun({
      sessionId: "sess-create",
      sessionKey: "sess-create",
      instructions: "say hello",
      input: "Hello",
      timeoutMs: 5_000,
    });

    expect(seenStream).toBe(true);
    expect(seenModel).toBe("openclaw/default");
    expect(result.runId).toBe("resp-create");
    expect(result.responseId).toBe("resp-create");
    expect(result.status).toBe("completed");
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

    for await (const _event of client.streamRun({
      sessionId: "sess-dump",
      sessionKey: "sess-dump",
      instructions: "plan this task",
      input: { prompt: "Write docs" },
      structuredOutputSchema: {
        name: "chrona_plan_generate",
        description: "Return a generated plan graph.",
        schema: { type: "object" },
      },
      timeoutMs: 5_000,
      stream: true,
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
