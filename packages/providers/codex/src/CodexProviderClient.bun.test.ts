import { describe, expect, it } from "bun:test";
import type { ProviderRunEvent, StartRunInput } from "@chrona/providers-foundation";

import {
  AcpCodexRunner,
  CodexProviderClient,
  type AcpClientHandlers,
  type AcpTransport,
  type CodexRunHandle,
  type CodexRunner,
} from "./CodexProviderClient";
import { codexAcpEnv } from "./types";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    sessionId: "codex-session-1",
    instructions: "Finish node.",
    input: "Return success.",
    stream: true,
    ...overrides,
  };
}

function makeHandle(input: StartRunInput, events: ProviderRunEvent[]): CodexRunHandle {
  const runId = "codex-run-1";
  return {
    ref: {
      provider: "codex",
      runId,
      nativeRunId: runId,
      providerRunId: runId,
      sessionId: input.sessionId ?? "codex-session-1",
      status: "running",
      stream: { supported: true, reconnectable: false },
    },
    input,
    abort: new AbortController(),
    sessionId: input.sessionId ?? "codex-session-1",
    outputText: "done",
    usage: null,
    status: "running",
    sequence: 0,
    testEvents: events,
  } as CodexRunHandle & { testEvents: ProviderRunEvent[] };
}

function makeRunner(events: ProviderRunEvent[]): CodexRunner {
  return {
    async start(input) {
      return makeHandle(input, events);
    },
    async *stream(handle) {
      const typed = handle as CodexRunHandle & { testEvents: ProviderRunEvent[] };
      for (const event of typed.testEvents) yield event;
      handle.status = "completed";
    },
    async snapshot(handle) {
      return {
        provider: "codex",
        runId: handle.ref.runId,
        nativeRunId: handle.ref.nativeRunId,
        sessionId: handle.sessionId,
        status: handle.status,
        outputText: handle.outputText,
        error: handle.error ?? null,
      };
    },
    async cancel(handle) {
      handle.status = "cancelled";
    },
    async checkHealth() {
      return {
        provider: "codex",
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        status: "ok",
        reason: "fake",
      };
    },
  };
}

type RequestRecord = { method: string; params: unknown };

type FakeSession = {
  sessionId: string;
  promptBlocks?: unknown;
  updates: Array<{ kind: "session_update"; update: unknown } | { kind: "stop"; stopReason: string; response: unknown }>;
  prompt(input: unknown): Promise<unknown>;
  nextUpdate(): Promise<FakeSession["updates"][number] | undefined>;
  dispose(): void;
};

class FakeAcpTransport implements AcpTransport {
  readonly requests: RequestRecord[] = [];
  readonly session: FakeSession;
  readonly init: unknown;
  handlers?: AcpClientHandlers;

  constructor(input: { init?: unknown; updates?: FakeSession["updates"] } = {}) {
    this.init = input.init ?? {
      protocolVersion: 1,
      agentCapabilities: { mcpCapabilities: { http: true } },
    };
    this.session = {
      sessionId: "acp-session-1",
      updates: input.updates ?? [],
      async prompt(promptInput) {
        this.promptBlocks = promptInput;
        return { stopReason: "end_turn" };
      },
      async nextUpdate() {
        return this.updates.shift();
      },
      dispose() {},
    };
  }

  async connect<T>(_config: unknown, handlers: AcpClientHandlers, op: (connection: Parameters<Parameters<AcpTransport["connect"]>[2]>[0]) => Promise<T>): Promise<T> {
    this.handlers = handlers;
    const context = {
      request: async (method: string, params: unknown) => {
        this.requests.push({ method, params });
        if (method === "initialize") return this.init;
        throw new Error(`unexpected request ${method}`);
      },
      buildSession: (params: unknown) => {
        this.requests.push({ method: "session/new", params });
        return {
          start: async () => this.session,
        };
      },
      notify: async (method: string, params: unknown) => {
        this.requests.push({ method, params });
      },
    };
    return op({ context, close() {}, closed: Promise.resolve() } as never);
  }
}

describe("codexAcpEnv", () => {
  it("passes API key auth as default ACP auth request", () => {
    const env = codexAcpEnv({ apiKey: " sk-openai " });
    expect(env.CODEX_API_KEY).toBe("sk-openai");
    expect(env.OPENAI_API_KEY).toBe("sk-openai");
    expect(JSON.parse(env.DEFAULT_AUTH_REQUEST ?? "{}")).toEqual({
      methodId: "api-key",
      _meta: { "api-key": { apiKey: "sk-openai" } },
    });
  });

  it("passes gateway auth request when base URL is configured", () => {
    const env = codexAcpEnv({
      apiKey: "sk-gateway",
      baseUrl: " https://gateway.example/v1 ",
      model: "gpt-5-codex",
    });

    expect(JSON.parse(env.CODEX_CONFIG ?? "{}")).toMatchObject({
      baseUrl: " https://gateway.example/v1 ",
      model: "gpt-5-codex",
    });
    expect(JSON.parse(env.DEFAULT_AUTH_REQUEST ?? "{}")).toEqual({
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl: "https://gateway.example/v1",
          providerName: "Chrona Codex Gateway",
          headers: { Authorization: "Bearer sk-gateway" },
        },
      },
    });
  });
});

describe("CodexProviderClient", () => {
  it("exposes ACP execution provider capabilities", async () => {
    const client = new CodexProviderClient({ runner: makeRunner([]) });

    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "codex",
      ok: true,
    });
    expect(client.getCapabilities()).toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      approval: { supported: false },
    });
  });

  it("streams existing Codex runs and preserves real tool completion events", async () => {
    const terminalTool = "chrona_node_complete";
    const events: ProviderRunEvent[] = [
      {
        type: "run_started",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        run: { provider: "codex", runId: "codex-run-1", sessionId: "codex-session-1", status: "running" },
      },
      {
        type: "tool_call",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        tool: terminalTool,
        callId: "call-1",
        input: { ok: true },
        status: "completed",
      },
      {
        type: "tool_completed",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        toolName: terminalTool,
      },
      {
        type: "run_completed",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        run: { provider: "codex", runId: "codex-run-1", sessionId: "codex-session-1", status: "completed" },
        outputText: "done",
      },
    ];
    const client = new CodexProviderClient({ runner: makeRunner(events) });
    const run = await client.startRun(baseInput({ terminalToolName: terminalTool }));
    const streamed = [];

    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "tool_completed",
      "run_completed",
    ]);
    expect(streamed.some((event) => event.type === "tool_completed" && event.toolName === terminalTool)).toBe(true);
  });

  it("sends Chrona HTTP MCP server through ACP session setup", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }] });
    const client = new CodexProviderClient({
      runner: new AcpCodexRunner({ mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" }, transport),
    });

    const run = await client.startRun(baseInput({
      sessionId: "chrona-session",
      sessionKey: "chrona:task:task-1:plan-generation",
      terminalToolName: "chrona_node_complete",
    }));
    const streamed = [];
    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    const sessionNew = transport.requests.find((request) => request.method === "session/new");
    expect(sessionNew?.params).toMatchObject({
      cwd: process.cwd(),
      mcpServers: [
        {
          type: "http",
          name: "chrona",
          url: "http://chrona.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aplan-generation",
          headers: [{ name: "Authorization", value: "Bearer run-token" }],
        },
      ],
    });
    expect(streamed.at(-1)).toMatchObject({ type: "run_completed" });
  });

  it("cancels known runs through the runner", async () => {
    const client = new CodexProviderClient({ runner: makeRunner([]) });
    const run = await client.startRun(baseInput());

    await expect(client.cancelRun({ runId: run.runId })).resolves.toMatchObject({
      provider: "codex",
      status: "cancelled",
    });
  });
});
