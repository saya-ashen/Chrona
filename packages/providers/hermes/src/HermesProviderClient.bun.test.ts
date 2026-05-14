import { afterEach, describe, expect, it } from "bun:test";
import { HermesProviderClient, HermesProviderError } from "./index";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
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
    globalThis.fetch = mockFetch(async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/health/detailed");
      return jsonResponse({ ok: true });
    });

    const client = new HermesProviderClient();
    const health = await client.checkHealth({ deep: true });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("ok");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
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
      structuredOutputSchema: {
        name: "ignored_schema",
        description: "Hermes tools decide authoritative actions through MCP.",
        schema: { type: "object" },
      },
      idempotencyKey: "idem-1",
    });

    expect(seenBody).toEqual({
      session_id: "session-1",
      instructions: "Be concise",
      input: "Hello",
    });
    expect(seenHeaders?.get("Authorization")).toBe("Bearer secret");
    expect(seenHeaders?.get("Idempotency-Key")).toBe("idem-1");
    expect(run).toMatchObject({
      provider: "hermes",
      runId: "run-1",
      providerRunId: "run-1",
      sessionId: "session-1",
      status: "running",
      stream: { supported: true, reconnectable: true },
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
    })).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    } satisfies Partial<HermesProviderError>);
  });

  it("streams Hermes SSE events and ignores keepalive comments", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/runs/run-1/events");
      return new Response([
        ": keepalive\n\n",
        'data: {"type":"message.delta","delta":"Hi "}\n\n',
        'data: {"type":"tool.started","tool":"shell","preview":"ls","input":{"cmd":"ls"}}\n\n',
        'data: {"type":"tool.completed","tool":"shell"}\n\n',
        ": stream closed\n\n",
        'data: {"type":"run.completed","output":"done","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}\n\n',
        'data: {"type":"message.delta","delta":"ignored"}\n\n',
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const client = new HermesProviderClient();
    const events = [] as Array<{ type: string; text?: string; toolName?: string; output?: { text?: string } }>;
    for await (const event of client.streamRun({ runId: "run-1" })) {
      events.push({
        type: event.type,
        text: event.type === "text_delta" ? event.text : undefined,
        toolName: event.type === "tool_started" || event.type === "tool_completed" ? event.toolName : undefined,
        output: event.type === "run_completed" ? event.output : undefined,
      });
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hi ", toolName: undefined, output: undefined },
      { type: "tool_started", text: undefined, toolName: "shell", output: undefined },
      { type: "tool_completed", text: undefined, toolName: "shell", output: undefined },
      { type: "run_completed", text: undefined, toolName: undefined, output: { text: "done" } },
    ]);
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
