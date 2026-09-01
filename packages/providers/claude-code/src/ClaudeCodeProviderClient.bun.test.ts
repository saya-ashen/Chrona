/**
 * ClaudeCodeProviderClient — replay-based unit tests.
 *
 * Drives the 8-method AgentProviderClient contract against three
 * pre-recorded NDJSON tapes (fixtures/). The real Claude Code process
 * and SDK are NEVER spawned — `createReplayRunner` re-emits the recorded
 * `ProviderRunEvent` stream, and the client wraps it.
 *
 * CI gate: `bun test packages/providers/claude-code`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpTestServer } from "./mcp-test-server";

import { terminalSnapshotFromEvents } from "@chrona/providers-foundation";

import { ClaudeCodeProviderClient } from "./ClaudeCodeProviderClient";
import { mapClaudeCodeStreamItems, createNormalizerContext } from "./normalizers";
import { createReplayRunner, probeMcpServer, type ClaudeCodeRunHandle, type ClaudeCodeRunner } from "./runner";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

function makeClient(
  fixtureName: string,
  opts: { mcpBaseUrl?: string; model?: string } = {},
): ClaudeCodeProviderClient {
  const tapePath = join(FIXTURES_DIR, `${fixtureName}.jsonl`);
  return new ClaudeCodeProviderClient({
    config: {
      mcpBaseUrl: opts.mcpBaseUrl ?? "http://localhost:0",
      model: opts.model,
    },
    runner: createReplayRunner(tapePath),
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe("ClaudeCodeProviderClient — MCP preflight", () => {
  test("probeMcpServer accepts a Streamable HTTP MCP peer with registered tools", async () => {
    const server = Bun.serve({ port: 0, fetch: createMcpTestServer() });

    try {
      const result = await probeMcpServer({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token: "",
        runId: "probe-test",
      });

      expect(result.toolNames).toEqual(["fixture_echo"]);
    } finally {
      server.stop(true);
    }
  });
});

describe("ClaudeCodeProviderClient — happy path", () => {
  test("stream emits the recorded events in order", async () => {
    const client = makeClient("happy-path");
    const events = await collect(
      client.streamRun({
        clientOperationId: "claude-code-happy-path-stream",
        sessionId: "fixture-session-happy",
        instructions: "Outline the next steps.",
        input: { type: "text", text: "Generate a short outline." },
      }),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run_started");
    expect(types.at(-1)).toBe("run_completed");
    // Includes the two text deltas.
    expect(types.filter((t) => t === "text_delta").length).toBe(2);
    // No terminal-then-more events (the generator must `return`).
    expect(types.includes("run_started") && types.includes("run_completed")).toBe(true);

    // terminalSnapshotFromEvents should agree the snapshot is "completed".
    const snap = terminalSnapshotFromEvents(events);
    expect(snap?.status).toBe("completed");
    expect(snap?.runId).toBe("happy-run");
    void client;
  });

  test("capabilities + health are static", async () => {
    const client = makeClient("happy-path");
    const caps = client.getCapabilities();
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.supportsCancellation).toBe(true);
    expect(caps.supportsToolCalls).toBe(true);
    expect(caps.supportsPreviousResponse).toBe(false);

    // When a runner is injected, health is reported ok with no reason.
    const health = await client.checkHealth();
    expect(health.ok).toBe(true);
    expect(health.reason ?? health.message).toBeUndefined();
  });

  test("startRun / getRun round-trip", async () => {
    const client = makeClient("happy-path");
    const ref = await client.startRun({
      sessionId: "fixture-session-happy",
      instructions: "Outline the next steps.",
      input: { type: "text", text: "Generate a short outline." },
      clientOperationId: "claude-code-happy-path",
    });
    expect(ref.provider).toBe("claude_code");
    expect(ref.status).toBe("running");
    expect(client.knownRunIds()).toContain(ref.runId);

    const snap = await client.getRun({ runId: ref.runId });
    expect(snap.provider).toBe("claude_code");
    expect(snap.runId).toBe(ref.runId);
    expect(["running", "completed"]).toContain(snap.status);
  });

  test("createSession: returns a fresh virtual session", async () => {
    const client = makeClient("happy-path");
    const a = await client.createSession({ sessionKey: "k1" });
    const b = await client.createSession({ sessionKey: "k2" });
    expect(a.provider).toBe("claude_code");
    expect(b.provider).toBe("claude_code");
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.sessionKey).toBe("k1");
    expect(b.sessionKey).toBe("k2");
  });
});

describe("Claude Code normalizer — streamed tool inputs", () => {
  test("content_block_start/delta/stop emits a real tool_call with parsed input", () => {
    const ctx = createNormalizerContext();
    const events = mapClaudeCodeStreamItems([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_fixture",
            name: "mcp__run_tools__fixture_echo",
          },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: "{\"value\":\"completed\"}",
          },
        },
      },
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      },
    ], ctx, { cancelRequested: false });

    const call = events.find((event) => event.type === "tool_call");
    expect(call).toBeDefined();
    expect(call).toMatchObject({
      type: "tool_call",
      tool: "mcp__run_tools__fixture_echo",
      callId: "toolu_fixture",
      input: {
        value: "completed",
      },
      status: "pending",
    });
  });

  test("removes the Claude MCP namespace from Chrona control tools", () => {
    const events = mapClaudeCodeStreamItems([
      {
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "toolu_chrona_complete",
            name: "mcp__chrona__chrona_node_complete",
            input: { summary: "Done" },
          }],
        },
      },
    ], createNormalizerContext(), { cancelRequested: false });

    expect(events.find((event) => event.type === "tool_call")).toMatchObject({
      tool: "chrona_node_complete",
      input: { summary: "Done" },
    });
  });
});

describe("ClaudeCodeProviderClient — tool round-trip", () => {
  test("tool_call then tool_result then completed", async () => {
    const client = makeClient("tool-call-roundtrip");
    const events = await collect(
      client.streamRun({
        clientOperationId: "claude-code-tool-call-stream",
        sessionId: "fixture-session-tool",
        instructions: "Call the declared synthetic tool.",
        input: { type: "text", text: "Send the fixture payload." },
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "run_started",
      "text_delta",
      "tool_call",
      "tool_result",
      "run_completed",
    ]);

    const call = events.find((e) => e.type === "tool_call");
    expect(call).toBeDefined();
    if (call?.type === "tool_call") {
      expect(call.tool).toBe("fixture_echo");
      expect(call.callId).toBe("call_abc");
      expect(call.status).toBe("pending");
    }
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toBeDefined();
    if (result?.type === "tool_result") {
      expect(result.tool).toBe("fixture_echo");
      expect(result.callId).toBe("call_abc");
    }
  });

  test("streamRun with runId branch: looks up an existing handle", async () => {
    const client = makeClient("tool-call-roundtrip");
    const ref = await client.startRun({
      sessionId: "fixture-session-tool",
      instructions: "Call the declared synthetic tool.",
      input: { type: "text", text: "Send the fixture payload." },
      clientOperationId: "claude-code-tool-call-roundtrip",
    });
    const events = await collect(client.streamRun({ runId: ref.runId }));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run_started");
    expect(types.at(-1)).toBe("run_completed");
  });
});

describe("ClaudeCodeProviderClient — cancel + error paths", () => {
  test("cancel-mid-run: streamRun synthesizes a run_cancelled from the post-snapshot", async () => {
    // The replay tape records `text_delta` then a final `snapshot` with
    // `status: "cancelled"` (no `run_cancelled` terminal event in the
    // stream). Per the spec 017 §5 contract, the provider MUST emit a
    // terminal event so callers can rely on it; we synthesize one from
    // the post-snapshot rather than silently returning.
    const client = makeClient("cancel-mid-run");
    const events = await collect(
      client.streamRun({
        clientOperationId: "claude-code-cancel-stream",
        sessionId: "fixture-session-cancel",
        instructions: "Run a long operation and then cancel it.",
        input: { type: "text", text: "Long operation." },
      }),
    );
    const types = events.map((e) => e.type);
    // The synthesized terminal lands at the end; the recorded text_delta
    // surfaces before it.
    expect(types).toEqual([
      "run_started",
      "text_delta",
      "run_cancelled",
    ]);
  });

  test("cancelRun: marks the handle cancelled and snapshot reflects it", async () => {
    const client = makeClient("cancel-mid-run");
    const ref = await client.startRun({
      sessionId: "fixture-session-cancel",
      instructions: "Run a long operation and then cancel it.",
      input: { type: "text", text: "Long operation." },
      clientOperationId: "claude-code-cancel-mid-run",
    });
    const cancelled = await client.cancelRun({ runId: ref.runId });
    expect(cancelled.runId).toBe(ref.runId);
    expect(["cancelled", "completed"]).toContain(cancelled.status);
  });

  test("streamRun does not blame user for SDK abort failures", async () => {
    async function* emptyQuery() {}
    const handle = {
      runId: "run-aborted",
      ref: {
        provider: "claude_code",
        runId: "run-aborted",
        sessionId: "session-aborted",
        status: "running",
      },
      internal: {
        kind: "sdk",
        query: Object.assign(emptyQuery(), { interrupt: async () => {} }),
        cancelRequested: false,
      },
      normalizer: createNormalizerContext(),
      runSessionId: "session-aborted",
      logger: {} as ClaudeCodeRunHandle["logger"],
    } satisfies ClaudeCodeRunHandle;
    const runner: ClaudeCodeRunner = {
      async start() {
        return { handle };
      },
      async next() {
        throw new Error("Claude Code process aborted by user");
      },
      async snapshot() {
        return {
          provider: "claude_code",
          runId: "run-aborted",
          sessionId: "session-aborted",
          status: "running",
        };
      },
      async cancel() {},
      async dispose() {},
    };
    const client = new ClaudeCodeProviderClient({
      config: { mcpBaseUrl: "http://localhost:3101" },
      runner,
    });

    const ref = await client.startRun({
      sessionId: "session-aborted",
      instructions: "Trigger an SDK abort.",
      input: { type: "text", text: "abort" },
      clientOperationId: "claude-code-aborted",
    });
    const events = await collect(client.streamRun({ runId: ref.runId }));

    expect(events.at(-1)).toMatchObject({
      error: "Claude Code process aborted before the terminal tool completed",
      raw: { stage: "before_terminal_tool_call" },
    });
  });

  test("streamRun reports SDK idle timeout distinctly", async () => {
    async function* emptyQuery() {}
    const handle = {
      runId: "run-timeout",
      ref: {
        provider: "claude_code",
        runId: "run-timeout",
        sessionId: "session-timeout",
        status: "running",
      },
      internal: {
        kind: "sdk",
        query: Object.assign(emptyQuery(), { interrupt: async () => {} }),
        cancelRequested: false,
      },
      normalizer: createNormalizerContext(),
      runSessionId: "session-timeout",
      logger: {} as ClaudeCodeRunHandle["logger"],
      diagnostics: {
        timeoutMs: 120_000,
        timeoutMode: "idle",
        timeoutTriggered: true,
        recentRawEvents: [],
      },
    } satisfies ClaudeCodeRunHandle;
    const runner: ClaudeCodeRunner = {
      async start() {
        return { handle };
      },
      async next() {
        throw new Error("Claude Code process aborted by user");
      },
      async snapshot() {
        return {
          provider: "claude_code",
          runId: "run-timeout",
          sessionId: "session-timeout",
          status: "running",
        };
      },
      async cancel() {},
      async dispose() {},
    };
    const client = new ClaudeCodeProviderClient({
      config: { mcpBaseUrl: "http://localhost:3101" },
      runner,
    });

    const ref = await client.startRun({
      sessionId: "session-timeout",
      instructions: "Trigger an SDK timeout.",
      input: { type: "text", text: "timeout" },
      clientOperationId: "claude-code-timeout",
    });
    const events = await collect(client.streamRun({ runId: ref.runId }));

    expect(events.at(-1)).toMatchObject({
      error: "Claude Code run timed out after 120s idle timeout: Claude Code process aborted before the terminal tool completed",
      raw: {
        stage: "before_terminal_tool_call",
        runner: { timeoutTriggered: true, timeoutMode: "idle", timeoutMs: 120_000 },
      },
    });
  });

  test("streamRun with unknown runId: throws ClaudeCodeProviderError", () => {
    const client = makeClient("happy-path");
    expect(
      collect(client.streamRun({ runId: "does-not-exist" })),
    ).rejects.toThrow(/unknown runId/);
  });

  test("getRun / cancelRun with unknown runId: throws", () => {
    const client = makeClient("happy-path");
    expect(client.getRun({ runId: "nope" })).rejects.toThrow(/unknown runId/);
    expect(client.cancelRun({ runId: "nope" })).rejects.toThrow(/unknown runId/);
  });
});

/**
 * Replay coverage verifies that provider tool events remain protocol-neutral.
 */
describe("ClaudeCodeProviderClient — generic tool replay", () => {
  test("declared synthetic tool call flows to run_completed", async () => {
    const client = makeClient("tool-call-roundtrip");
    const events = await collect(
      client.streamRun({
        clientOperationId: "claude-code-tool-replay",
        sessionId: "fixture-session-tool-replay",
        instructions: "Call the declared fixture tool.",
        input: { type: "text", text: "Use the fixture tool." },
        tools: [{
          name: "fixture_echo",
          description: "Echo a value.",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        }],
        terminalToolName: "fixture_echo",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "text_delta",
      "tool_call",
      "tool_result",
      "run_completed",
    ]);
    expect(events.find((event) => event.type === "tool_call")).toMatchObject({
      tool: "fixture_echo",
      status: "pending",
    });
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      tool: "fixture_echo",
      result: { ok: true },
    });
    expect(terminalSnapshotFromEvents(events)?.status).toBe("completed");
  });
});
