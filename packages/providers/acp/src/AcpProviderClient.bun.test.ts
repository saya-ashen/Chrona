import { describe, expect, it } from "bun:test";
import type { ProviderRunEvent, StartRunInput } from "@chrona/providers-foundation";
import {
  AcpProviderClient,
  type AcpClientHandlers,
  type AcpTransport,
} from "./AcpProviderClient";
import type { AcpProviderConfig } from "./types";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    sessionId: "acp-session-1",
    instructions: "Finish node.",
    input: "Return success.",
    stream: true,
    ...overrides,
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
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
    };
    this.session = {
      sessionId: "native-acp-session-1",
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

  async connect<T>(_config: AcpProviderConfig, handlers: AcpClientHandlers, op: (connection: Parameters<Parameters<AcpTransport["connect"]>[2]>[0]) => Promise<T>): Promise<T> {
    this.handlers = handlers;
    const context = {
      request: async (method: string, params: unknown) => {
        this.requests.push({ method, params });
        if (method === "initialize") return this.init;
        if (method === "session/load") return { modes: null };
        throw new Error(`unexpected request ${method}`);
      },
      buildSession: (params: unknown) => {
        this.requests.push({ method: "session/new", params });
        return {
          start: async () => this.session,
        };
      },
      attachSession: (response: { sessionId: string }) => {
        this.requests.push({ method: "session/attach", params: response });
        return { ...this.session, sessionId: response.sessionId };
      },
      notify: async (method: string, params: unknown) => {
        this.requests.push({ method, params });
      },
    };
    return op({ context, close() {}, closed: Promise.resolve() } as never);
  }
}

function config(overrides: Partial<AcpProviderConfig> = {}): AcpProviderConfig {
  return {
    provider: "test_acp",
    command: "test-acp",
    ...overrides,
  };
}

describe("AcpProviderClient", () => {
  it("exposes generic ACP execution provider capabilities", async () => {
    const transport = new FakeAcpTransport();
    const client = new AcpProviderClient({ config: config({ displayName: "Test ACP" }), transport });

    expect(client.getCapabilities()).toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      approval: { supported: true, choices: ["approve_once", "approve_always", "deny"], scopes: ["once", "always"], resolveAll: false },
      reason: "Test ACP ACP provider",
    });
    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "test_acp",
      ok: true,
      reason: "Test ACP ACP agent initialized",
    });
    expect(transport.requests.some((request) => request.method === "session/new")).toBe(false);
  });

  it("opens a provider session when session health is requested", async () => {
    const transport = new FakeAcpTransport();
    const client = new AcpProviderClient({
      config: config({ healthCheck: "session", mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" }),
      transport,
    });

    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "test_acp",
      ok: true,
      reason: "test_acp ACP agent connected",
    });
    expect(transport.requests.find((request) => request.method === "session/new")?.params).toMatchObject({
      mcpServers: [
        {
          url: "http://chrona.test/api/mcp?session_id=chrona%3Aprovider-health%3Atest_acp",
          headers: [{ name: "Authorization", value: "Bearer run-token" }],
        },
      ],
    });
  });
  it("sends Chrona HTTP MCP server through ACP session setup", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }] });
    const client = new AcpProviderClient({
      config: config({ mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" }),
      transport,
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
    expect(streamed.at(-1)).toMatchObject({ type: "run_completed", provider: "test_acp" });
  });

  it("loads the prior ACP session when resumeSessionRef is present", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }] });
    const client = new AcpProviderClient({
      config: config({ mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" }),
      transport,
    });

    const run = await client.startRun(baseInput({
      sessionId: "chrona-session",
      sessionKey: "chrona:task:task-1:execute:plan-1",
      resumeSessionRef: "native-acp-session-prior",
    }));
    const streamed = [];
    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(transport.requests.some((request) => request.method === "session/new")).toBe(false);
    expect(transport.requests.find((request) => request.method === "session/load")?.params).toMatchObject({
      sessionId: "native-acp-session-prior",
      cwd: process.cwd(),
      mcpServers: [
        {
          type: "http",
          name: "chrona",
          url: "http://chrona.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aexecute%3Aplan-1",
          headers: [{ name: "Authorization", value: "Bearer run-token" }],
        },
      ],
    });
    expect(run.sessionId).toBe("native-acp-session-prior");
    expect(streamed.at(-1)).toMatchObject({ type: "run_completed", sessionId: "native-acp-session-prior" });
  });

  it("rejects resumed runs when the ACP agent cannot load sessions", async () => {
    const transport = new FakeAcpTransport({
      init: { protocolVersion: 1, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } } },
    });
    const client = new AcpProviderClient({ config: config(), transport });

    await expect(client.startRun(baseInput({ resumeSessionRef: "native-acp-session-prior" }))).rejects.toThrow(
      "agent does not advertise loadSession",
    );
    expect(transport.requests.some((request) => request.method === "session/new")).toBe(false);
    expect(transport.requests.some((request) => request.method === "session/load")).toBe(false);
  });

  it("ignores blank control base URL and falls back to configured MCP base URL", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }] });
    const client = new AcpProviderClient({
      config: config({ mcpBaseUrl: "http://chrona.test", mcpRunToken: "configured-token" }),
      transport,
    });

    const run = await client.startRun({
      ...baseInput({ sessionKey: "chrona:session" }),
      control: { baseUrl: " ", runToken: "control-token" },
    } as StartRunInput);
    for await (const _event of client.streamRun({ runId: run.runId })) {
      // drain stream
    }

    const sessionNew = transport.requests.find((request) => request.method === "session/new");
    expect(sessionNew?.params).toMatchObject({
      mcpServers: [
        {
          url: "http://chrona.test/api/mcp?session_id=chrona%3Asession",
          headers: [{ name: "Authorization", value: "Bearer control-token" }],
        },
      ],
    });
  });

  it("streams ACP tool completion events", async () => {
    const terminalTool = "chrona_node_complete";
    const transport = new FakeAcpTransport({
      updates: [
        {
          kind: "session_update",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            title: terminalTool,
            rawInput: { ok: true },
            status: "completed",
          },
        },
        { kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } },
      ],
    });
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput({ terminalToolName: terminalTool }));
    const streamed: ProviderRunEvent[] = [];

    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.map((event) => event.type)).toEqual(["run_started", "tool_call", "tool_completed", "run_completed"]);
    expect(streamed.some((event) => event.type === "tool_completed" && event.toolName === terminalTool)).toBe(true);
  });

  it("cancels known runs through ACP session cancel", async () => {
    const transport = new FakeAcpTransport();
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput());

    await expect(client.cancelRun({ runId: run.runId })).resolves.toMatchObject({
      provider: "test_acp",
      status: "cancelled",
    });
    expect(transport.requests.some((request) => request.method === "session/cancel")).toBe(true);
  });

  it("sends runtime prompt text, terminal instruction, and structured schema", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }] });
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput({
      terminalToolName: "chrona_node_complete",
      structuredOutputSchema: { name: "result", description: "Result payload", schema: { type: "object", properties: { ok: { type: "boolean" } } } },
    }));

    for await (const _event of client.streamRun({ runId: run.runId })) {
      // drain stream
    }

    expect(transport.session.promptBlocks).toEqual([
      {
        type: "text",
        text: expect.stringContaining("When finished, call the MCP tool `chrona_node_complete`"),
      },
    ]);
    const promptText = (transport.session.promptBlocks as Array<{ text: string }>)[0]?.text ?? "";
    expect(promptText).toContain("Finish node.");
    expect(promptText).toContain("Return success.");
    expect(promptText).toContain("Structured output schema:");
    expect(promptText).toContain('"ok"');
  });

  it("streams text, reasoning, usage, tool start, and tool failure events", async () => {
    const transport = new FakeAcpTransport({
      updates: [
        { kind: "session_update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } },
        { kind: "session_update", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } },
        { kind: "session_update", update: { sessionUpdate: "usage_update", used: 7, size: 11 } },
        {
          kind: "session_update",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            title: "exec_command",
            rawInput: { cmd: "date" },
            status: "in_progress",
          },
        },
        {
          kind: "session_update",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            title: "exec_command",
            rawInput: { cmd: "date" },
            rawOutput: { stderr: "denied" },
            status: "failed",
          },
        },
        { kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } },
      ],
    });
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput());
    const streamed: ProviderRunEvent[] = [];

    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.map((event) => event.type)).toEqual([
      "run_started",
      "text_delta",
      "reasoning_delta",
      "raw_event",
      "tool_call",
      "tool_started",
      "tool_call",
      "tool_completed",
      "run_completed",
    ]);
    expect(streamed.find((event) => event.type === "text_delta")).toMatchObject({ text: "hello" });
    expect(streamed.find((event) => event.type === "reasoning_delta")).toMatchObject({ text: "thinking" });
    expect(streamed.find((event) => event.type === "tool_started")).toMatchObject({ toolName: "exec_command", input: { cmd: "date" } });
    expect(streamed.find((event) => event.type === "tool_completed")).toMatchObject({
      toolName: "exec_command",
      error: { message: "ACP tool call failed", raw: { stderr: "denied" } },
    });
    expect(streamed.at(-1)).toMatchObject({
      type: "run_completed",
      outputText: "hello",
      usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7 },
    });
  });

  it("bridges ACP permission requests into approval events", async () => {
    const transport = new FakeAcpTransport();
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput());
    const iterator = client.streamRun({ runId: run.runId })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "run_started" } });
    const permission = transport.handlers?.requestPermission({
      sessionId: "native-acp-session-1",
      toolCall: { toolCallId: "call-approval", title: "exec_command", rawInput: { cmd: "date" } },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "deny-once", name: "Deny", kind: "reject_once" },
      ],
    });

    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        type: "approval_required",
        approval: {
          id: "native-acp-session-1:call-approval",
          provider: "test_acp",
          runId: run.runId,
          choices: ["approve_once", "deny"],
          subject: { type: "tool", label: "exec_command" },
        },
      },
    });
    await expect(client.resolveApproval({
      runId: run.runId,
      approvalId: "native-acp-session-1:call-approval",
      choice: "approve_once",
    })).resolves.toMatchObject({ status: "resolved", resolved: 1 });
    await expect(permission).resolves.toEqual({ outcome: { outcome: "selected", optionId: "allow-once" } });
    await iterator.return?.();
  });

  it("reports failed health when ACP agent lacks HTTP MCP capability", async () => {
    const client = new AcpProviderClient({
      config: config(),
      transport: new FakeAcpTransport({ init: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: false } } } }),
    });

    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "test_acp",
      ok: false,
      status: "error",
      reason: expect.stringContaining("HTTP MCP"),
    });
  });

  it("maps ACP cancelled stop to run_cancelled", async () => {
    const transport = new FakeAcpTransport({ updates: [{ kind: "stop", stopReason: "cancelled", response: { stopReason: "cancelled" } }] });
    const client = new AcpProviderClient({ config: config(), transport });
    const run = await client.startRun(baseInput());
    const streamed: ProviderRunEvent[] = [];

    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.map((event) => event.type)).toEqual(["run_started", "run_cancelled"]);
    expect(streamed.at(-1)).toMatchObject({ type: "run_cancelled", provider: "test_acp" });
  });
});
