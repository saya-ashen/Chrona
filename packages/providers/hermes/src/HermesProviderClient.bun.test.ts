import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HermesProviderClient, HermesProviderError } from "./index";
import type { ProviderRunEvent } from "@chrona/providers-foundation";

const realFetch = globalThis.fetch;
const realStrictUnknownEvents = process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS;
const realHermesRecordDir = process.env.CHRONA_HERMES_RECORD_DIR;

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (realStrictUnknownEvents === undefined) {
    delete process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS;
  } else {
    process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS = realStrictUnknownEvents;
  }
  if (realHermesRecordDir === undefined) {
    delete process.env.CHRONA_HERMES_RECORD_DIR;
  } else {
    process.env.CHRONA_HERMES_RECORD_DIR = realHermesRecordDir;
  }
});

describe("HermesProviderClient", () => {
  it("maps capabilities from /v1/capabilities", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/capabilities");
      return jsonResponse({
        features: {
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true,
          responses_api: true,
          chat_completions: true,
        },
      });
    });

    const client = new HermesProviderClient();
    const capabilities = await client.getCapabilities();

    expect(capabilities).toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      details: {
        runs: {
          start: true,
          status: true,
          stream: true,
          cancel: true,
        },
      },
    });
  });

  it("returns health ok with latency", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mockFetch(async (url) => {
      seenUrls.push(String(url));
      if (String(url).endsWith("/v1/capabilities")) {
        return jsonResponse({ features: { run_submission: true } });
      }
      return jsonResponse({ ok: true });
    });

    const client = new HermesProviderClient();
    const health = await client.checkHealth({ deep: true });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("ok");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
    expect(seenUrls).toEqual([
      "http://127.0.0.1:8642/health/detailed",
      "http://127.0.0.1:8642/v1/capabilities",
    ]);
  });

  it("checks capabilities auth during deep health checks", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mockFetch(async (url) => {
      seenUrls.push(String(url));
      if (String(url).endsWith("/v1/capabilities")) {
        return jsonResponse({ error: "invalid token" }, { status: 401 });
      }
      return jsonResponse({ ok: true });
    });

    const client = new HermesProviderClient({ apiKey: "bad" });
    const health = await client.checkHealth({ deep: true });

    expect(health.ok).toBe(false);
    expect(health.status).toBe("misconfigured");
    expect(health.reason).toContain("401");
    expect(health.reason).toContain("token");
    expect(seenUrls).toEqual([
      "http://127.0.0.1:8642/health/detailed",
      "http://127.0.0.1:8642/v1/capabilities",
    ]);
  });

  it("maps health 401 to misconfigured", async () => {
    globalThis.fetch = mockFetch(async () => jsonResponse({ error: "missing key" }, { status: 401 }));

    const client = new HermesProviderClient({ apiKey: "bad" });
    const health = await client.checkHealth();

    expect(health.ok).toBe(false);
    expect(health.status).toBe("misconfigured");
    expect(health.reason).toContain("401");
  });

  it("maps health network errors to unavailable", async () => {
    globalThis.fetch = mockFetch(async () => {
      throw new Error("connection refused");
    });

    const client = new HermesProviderClient();
    const health = await client.checkHealth({ deep: true });

    expect(health.ok).toBe(false);
    expect(health.status).toBe("unavailable");
    expect(health.reason).toContain("connection refused");
  });

  it("creates virtual sessions without a network call", async () => {
    let calls = 0;
    globalThis.fetch = mockFetch(async () => {
      calls += 1;
      return jsonResponse({});
    });

    const client = new HermesProviderClient();
    const session = await client.createSession({ sessionKey: "task:example" });

    expect(calls).toBe(0);
    expect(session).toMatchObject({
      provider: "hermes",
      sessionId: "task:example",
      providerSessionId: "task:example",
      state: "virtual",
    });
  });

  it("starts runs with expected Hermes body and maps run_id", async () => {
    let seenBody: unknown;
    let seenHeaders: Headers | undefined;
    globalThis.fetch = mockFetch(async (url, init) => {
      expect(String(url)).toBe("http://hermes.local/v1/runs");
      seenBody = JSON.parse(String(init?.body));
      seenHeaders = new Headers(init?.headers);
      return jsonResponse({ run_id: "run-1", status: "started" });
    });

    const client = new HermesProviderClient({
      baseUrl: "http://hermes.local/",
      apiKey: "secret",
    });
    const run = await client.startRun({
      sessionId: "session-1",
      instructions: "Be concise",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-start-body",
      structuredOutputSchema: {
        name: "ignored_schema",
        description: "Hermes tools decide authoritative actions through MCP.",
        schema: { type: "object" },
      },
    });

    expect(seenBody).toEqual({
      session_id: "session-1",
      instructions: "Be concise",
      input: "Hello",
    });
    expect(seenHeaders?.get("Authorization")).toBe("Bearer secret");
    expect(seenHeaders?.get("Idempotency-Key")).toBe("hermes-start-body");
    expect(run).toMatchObject({
      provider: "hermes",
      runId: "run-1",
      providerRunId: "run-1",
      sessionId: "session-1",
      status: "running",
      stream: { supported: true, reconnectable: true },
      providerResumeRef: "run-1",
    });
    expect(Date.parse(run.startedAt ?? "")).not.toBeNaN();
  });

  it("starts runs with string input, conversation history, and previous response", async () => {
    let seenBody: unknown;
    globalThis.fetch = mockFetch(async (_url, init) => {
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse({ run_id: "run-1", status: "started" });
    });

    const client = new HermesProviderClient();
    await client.startRun({
      sessionId: "session-1",
      instructions: "Be concise",
      previousResponseId: "resp-1",
      clientOperationId: "hermes-history-previous-response",
      input: {
        type: "messages",
        messages: [
          { role: "system", content: "Use short replies" },
          { role: "user", content: [{ type: "text", text: "Build plan" }] },
        ],
      },
    });

    expect(seenBody).toEqual({
      session_id: "session-1",
      instructions: "Be concise",
      previous_response_id: "resp-1",
      input: "Build plan",
      conversation_history: [
        { role: "system", content: "Use short replies" },
      ],
    });
  });

  it("maps start run 429 to retryable rate_limited error", async () => {
    globalThis.fetch = mockFetch(async () => jsonResponse({ error: "slow down" }, { status: 429 }));

    const client = new HermesProviderClient();

    await expect(client.startRun({
      sessionId: "session-1",
      instructions: "go",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-rate-limited",
    })).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    } satisfies Partial<HermesProviderError>);
  });

  it("marks Hermes timeout aborts as retryable", async () => {
    globalThis.fetch = mockFetch(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      init?.signal?.throwIfAborted();
      return jsonResponse({ run_id: "run-1" });
    });

    const client = new HermesProviderClient({ timeoutMs: 1 });

    await expect(client.startRun({
      sessionId: "session-1",
      instructions: "go",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-timeout",
    })).rejects.toMatchObject({
      code: "aborted",
      retryable: true,
    } satisfies Partial<HermesProviderError>);
  });

  it("keeps caller-aborted Hermes requests non-retryable", async () => {
    const controller = new AbortController();
    globalThis.fetch = mockFetch(async (_url, init) => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 0));
      init?.signal?.throwIfAborted();
      return jsonResponse({ run_id: "run-1" });
    });

    const client = new HermesProviderClient({ timeoutMs: 10_000 });

    await expect(client.startRun({
      sessionId: "session-1",
      instructions: "go",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-caller-aborted",
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: "aborted",
      retryable: false,
    } satisfies Partial<HermesProviderError>);
  });

  it("maps start run 401 to token misconfiguration", async () => {
    globalThis.fetch = mockFetch(async () => jsonResponse({ error: "invalid token" }, { status: 401 }));

    const client = new HermesProviderClient({ apiKey: "bad" });

    await expect(client.startRun({
      sessionId: "session-1",
      instructions: "go",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-unauthorized",
    })).rejects.toMatchObject({
      code: "misconfigured",
      status: 401,
      retryable: false,
      message: expect.stringContaining("token"),
    } satisfies Partial<HermesProviderError>);
  });

  it("streams Hermes SSE events and ignores keepalive comments", async () => {
    let seenHeaders: Headers | undefined;
    globalThis.fetch = mockFetch(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/runs/run-1/events");
      seenHeaders = new Headers(init?.headers);
      return new Response([
        ": keepalive\n\n",
        'data: {"type":"message.delta","delta":"Hi "}\n\n',
        'data: {"type":"tool.started","tool":"shell","preview":"ls","input":{"cmd":"ls"}}\n\n',
        'data: {"type":"tool.completed","tool":"shell","error":false}\n\n',
        ": stream closed\n\n",
        'data: {"type":"run.completed","session_id":"event-session","output":"done","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}\n\n',
        'data: {"type":"message.delta","delta":"ignored"}\n\n',
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = new HermesProviderClient();
    const events = [] as Array<{ type: string; text?: string; toolName?: string; output?: { text?: string }; sessionId?: string }>;
    for await (const event of client.streamRun({ runId: "run-1", sessionId: "input-session" })) {
      events.push({
        type: event.type,
        text: event.type === "text_delta" ? event.text : undefined,
        toolName: event.type === "tool_started" || event.type === "tool_completed" ? event.toolName : undefined,
        output: event.type === "run_completed" ? event.output : undefined,
        sessionId: event.sessionId,
      });
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hi ", toolName: undefined, output: undefined, sessionId: "input-session" },
      { type: "tool_started", text: undefined, toolName: "shell", output: undefined, sessionId: "input-session" },
      { type: "tool_completed", text: undefined, toolName: "shell", output: undefined, sessionId: "input-session" },
      { type: "run_completed", text: undefined, toolName: undefined, output: { text: "done" }, sessionId: "input-session" },
    ]);
    expect(seenHeaders?.get("Accept")).toBe("text/event-stream");
  });

  it("raises a retryable error when the SSE body is interrupted before a terminal event", async () => {
    globalThis.fetch = mockFetch(async () => {
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"message.delta","delta":"partial"}\n\n',
              ),
            );
            return;
          }
          controller.error(new Error("socket hang up"));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = new HermesProviderClient();
    const seen: string[] = [];
    let captured: unknown;
    try {
      for await (const event of client.streamRun({ runId: "run-1" })) {
        seen.push(event.type);
      }
    } catch (error) {
      captured = error;
    }

    expect(seen).toEqual(["text_delta"]);
    expect(captured).toMatchObject({
      name: "HermesProviderError",
      code: "network_error",
      retryable: true,
    } satisfies Partial<HermesProviderError>);
  });

  it("normalizes Hermes approval requests", async () => {
    globalThis.fetch = mockFetch(async () => new Response(
      `data: ${JSON.stringify({
        type: "approval.request",
        run_id: "run-1",
        pattern_key: "execute_code",
        command: "execute_code <<'PY'\nprint('hi')\nPY",
        description: "Code can mutate files.",
        choices: ["once", "session", "always", "deny"],
      })}\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const client = new HermesProviderClient();
    const events = [];
    for await (const event of client.streamRun({ runId: "run-1", sessionId: "session-1" })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "approval_required",
      approval: {
        provider: "hermes",
        runId: "run-1",
        nativeRunId: "run-1",
        sessionId: "session-1",
        kind: "tool_execution",
        providerKind: "execute_code",
        title: "Approve code execution",
        riskLevel: "high",
        choices: ["approve_once", "approve_session", "approve_always", "deny"],
        subject: {
          type: "command",
          label: "execute_code",
          language: "python",
        },
      },
    });
  });

  it("resolves Hermes approvals through provider contract", async () => {
    let seenBody: unknown;
    globalThis.fetch = mockFetch(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/runs/run-native/approval");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("approval-idem-1");
      seenBody = JSON.parse(String(init?.body));
      return jsonResponse({ object: "hermes.run.approval_response", run_id: "run-native", choice: "session", resolved: 1 });
    });

    const client = new HermesProviderClient();
    const result = await client.resolveApproval({
      runId: "run-record",
      nativeRunId: "run-native",
      choice: "approve_session",
      resolveAll: true,
      idempotencyKey: "approval-idem-1",
    });

    expect(seenBody).toEqual({ choice: "session", resolve_all: true });
    expect(result).toMatchObject({
      provider: "hermes",
      runId: "run-record",
      nativeRunId: "run-native",
      choice: "approve_session",
      resolved: 1,
      status: "resolved",
    });
  });

  it("uses stream input session when completed stream events omit session_id", async () => {
    globalThis.fetch = mockFetch(async () => new Response(
      'data: {"type":"run.completed","output":"done"}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const client = new HermesProviderClient();

    const events = [];
    for await (const event of client.streamRun({ runId: "run-1", sessionId: "input-session" })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run_completed",
      sessionId: "input-session",
      run: { sessionId: "input-session" },
    });
  });

  it("records Hermes start and stream events for debug replay", async () => {
    const replayDir = await mkdtemp(join(tmpdir(), "chrona-hermes-replay-"));
    process.env.CHRONA_HERMES_RECORD_DIR = replayDir;
    globalThis.fetch = mockFetch(async (url) => {
      if (String(url).endsWith("/v1/runs")) {
        return jsonResponse({ run_id: "run-1", status: "started" });
      }
      return new Response([
        'data: {"type":"message.delta","delta":"Hi"}\n\n',
        'data: {"type":"run.completed","output":"done"}\n\n',
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = new HermesProviderClient();
    await client.startRun({
      sessionId: "session-1",
      instructions: "go",
      input: { type: "text", text: "Hello" },
      clientOperationId: "hermes-debug-replay",
    });
    for await (const _event of client.streamRun({ runId: "run-1", sessionId: "session-1" })) {
      // consume stream to flush replay records
    }

    const content = await readFile(join(replayDir, "run-1.jsonl"), "utf8");
    const records = content.trim().split("\n").map((line) => JSON.parse(line));
    expect(records.map((record) => record.kind)).toEqual(["start", "event", "event"]);
    expect(records[0].input.signal).toBeUndefined();
    expect(records[2].event.type).toBe("run_completed");
    await rm(replayDir, { recursive: true, force: true });
  });

  it("maps failed and cancelled terminal stream events", async () => {
    const client = new HermesProviderClient();
    const terminalEvents = [] as string[];

    for (const terminal of ["run.failed", "run.cancelled"]) {
      globalThis.fetch = mockFetch(async () => new Response(
        `data: {"type":"${terminal}","error":"boom"}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ));
      const events = [] as string[];
      for await (const event of client.streamRun({ runId: "run-1" })) {
        events.push(event.type);
      }
      terminalEvents.push(...events);
    }

    expect(terminalEvents).toEqual(["run_failed", "run_cancelled"]);
  });

  it("throws on unknown stream events during development", async () => {
    delete process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS;
    globalThis.fetch = mockFetch(async () => new Response(
      'data: {"type":"run.mystery","value":1}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const client = new HermesProviderClient();

    await expect(async () => {
      for await (const _event of client.streamRun({ runId: "run-1" })) {
        // Unknown events should abort before yielding.
      }
    }).toThrow(/Unknown Hermes stream event type: run\.mystery/);
  });

  it("allows unknown stream events when strict handling is disabled", async () => {
    process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS = "0";
    globalThis.fetch = mockFetch(async () => new Response(
      'data: {"type":"run.mystery","value":1}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const client = new HermesProviderClient();
    const events = [] as string[];
    for await (const event of client.streamRun({ runId: "run-1", include: { rawEvents: true } })) {
      events.push(event.type);
    }

    expect(events).toEqual(["raw_event"]);
  });

  it("captures unknown stream events as raw_event even when strict handling is enabled", async () => {
    delete process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS;
    globalThis.fetch = mockFetch(async () => new Response(
      'data: {"type":"run.mystery","value":1}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const client = new HermesProviderClient();
    const events = [] as ProviderRunEvent[];
    for await (const event of client.streamRun({ runId: "run-1", include: { rawEvents: true } })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.type).toBe("raw_event");
    expect(event.type === "raw_event" ? event.raw : undefined).toEqual({ type: "run.mystery", value: 1 });
    expect(event.rawEventType).toBe("run.mystery");
  });

  it("maps completed run output and usage", async () => {
    globalThis.fetch = mockFetch(async () => jsonResponse({
      run_id: "run-1",
      session_id: "session-1",
      status: "completed",
      output: "Hello",
      usage: {
        input_tokens: 4,
        output_tokens: 5,
        total_tokens: 9,
      },
    }));

    const client = new HermesProviderClient();
    const snapshot = await client.getRun({ runId: "run-1" });

    expect(snapshot).toMatchObject({
      provider: "hermes",
      runId: "run-1",
      providerRunId: "run-1",
      sessionId: "session-1",
      status: "completed",
      output: { text: "Hello" },
      usage: {
        inputTokens: 4,
        outputTokens: 5,
        totalTokens: 9,
      },
    });
  });

  it("maps cancel run stopping response", async () => {
    globalThis.fetch = mockFetch(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/runs/run-1/stop");
      expect(init?.method).toBe("POST");
      return jsonResponse({ run_id: "run-1", status: "stopping" });
    });

    const client = new HermesProviderClient();
    const snapshot = await client.cancelRun({ runId: "run-1", reason: "user requested stop" });

    expect(snapshot).toMatchObject({
      provider: "hermes",
      runId: "run-1",
      providerRunId: "run-1",
      status: "stopping",
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function mockFetch(
  handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>,
): typeof fetch {
  return handler as unknown as typeof fetch;
}
