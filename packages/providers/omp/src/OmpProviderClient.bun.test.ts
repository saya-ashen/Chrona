import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProviderClient,
  ProviderRunRef,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import type { ProviderConversationTurnInput } from "@chrona/providers-foundation";
import { OmpProviderClient } from "./OmpProviderClient";
import { OmpSdkProviderClient, __ompSdkProviderTestHooks } from "./OmpSdkProviderClient";

class RecordingProvider implements AgentProviderClient {
  readonly provider = "omp";
  calls: string[] = [];

  getConversationCapabilities?: AgentProviderClient["getConversationCapabilities"];
  inspectConversation?: AgentProviderClient["inspectConversation"];
  handoffConversation?: AgentProviderClient["handoffConversation"];
  runConversationTurn?: AgentProviderClient["runConversationTurn"];
  constructor(private readonly runId: string) {}

  getCapabilities() {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      actionInvocation: "unsupported" as const,
      startIdempotency: "unsupported" as const,
      lookupByClientOperationId: false,
    };
  }

  async checkHealth() {
    this.calls.push("checkHealth");
    return { provider: "omp", ok: true, checkedAt: new Date(0).toISOString() };
  }

  async createSession() {
    this.calls.push("createSession");
    return { provider: "omp", sessionId: `${this.runId}-session` };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    this.calls.push(`startRun:${input.terminalToolName ?? "none"}`);
    return {
      provider: "omp",
      runId: this.runId,
      sessionId: input.sessionId ?? `${this.runId}-session`,
      status: "running",
    };
  }

  streamRun(_input: StreamRunInput) {
    this.calls.push("streamRun");
    return (async function* emptyStream(calls: string[]) { if (calls.length < 0) yield undefined as never; })(this.calls);
  }

  async getRun() {
    this.calls.push("getRun");
    return { provider: "omp", runId: this.runId, status: "running" as const };
  }

  async cancelRun() {
    this.calls.push("cancelRun");
    return { provider: "omp", runId: this.runId, status: "cancelled" as const };
  }
}

function startInput(terminalToolName?: string): StartRunInput {
  return {
    sessionId: "session-1",
    instructions: "instructions",
    input: { type: "text", text: "input" },
    clientOperationId: "omp-test-operation",
    terminalToolName,
  };
}


describe("OmpSdkProviderClient recovery capabilities", () => {
  it("advertises durable session history without claiming cross-process run lookup", () => {
    const client = new OmpSdkProviderClient();

    expect(client.getCapabilities().recovery).toEqual({
      sessionResume: true,
      historyReplay: true,
      activeRunLookup: false,
      crossProcessDurable: false,
      streamReconnect: false,
      providerResumeRef: true,
      runEventReplay: false,
      mode: "session_history",
    });
    expect(client.getCapabilities()).toMatchObject({
      startIdempotency: "unsupported",
      readOnlySingleAttempt: true,
    });
  });
});

describe("OmpSdkProviderClient direct config", () => {
  it("keeps a slash-containing model ID opaque when provider is explicit", async () => {
    expect(__ompSdkProviderTestHooks.resolveSdkModelSelection({
      provider: "nrouter",
      model: "cx/gpt-5.6-sol",
    })).toEqual({
      provider: "nrouter",
      modelId: "cx/gpt-5.6-sol",
      modelPattern: "nrouter/cx/gpt-5.6-sol",
    });
    expect(__ompSdkProviderTestHooks.resolveSdkModelSelection({
      model: "nrouter/cx/gpt-5.6-sol",
    })).toEqual({
      provider: "nrouter",
      modelId: "cx/gpt-5.6-sol",
      modelPattern: "nrouter/cx/gpt-5.6-sol",
    });
  });

  it("does not prepend the provider twice for an execution-pinned model", () => {
    const runConfig = __ompSdkProviderTestHooks.withSdkRuntimeModel(
      { provider: "9router", model: "cx/gpt-5.6-sol" },
      "9router/cx/gpt-5.6-sol",
    );

    expect(runConfig).toMatchObject({
      provider: "9router",
      model: "cx/gpt-5.6-sol",
    });
    expect(__ompSdkProviderTestHooks.resolveSdkModelSelection(runConfig)).toEqual({
      provider: "9router",
      modelId: "cx/gpt-5.6-sol",
      modelPattern: "9router/cx/gpt-5.6-sol",
    });
  });

  it("registers a complete custom provider model configuration", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "chrona-omp-direct-model-"));
    const suffix = crypto.randomUUID().replaceAll("-", "_").toUpperCase();
    const apiKeyEnvName = `CHRONA_OMP_TEST_KEY_${suffix}`;
    const baseUrlEnvName = `CHRONA_OMP_TEST_URL_${suffix}`;
    process.env[apiKeyEnvName] = "sk-direct-omp";
    process.env[baseUrlEnvName] = "https://llm.example.test/v1";
    try {
      const setup = await __ompSdkProviderTestHooks.createSdkModelSetup(
        {
          provider: "nrouter",
          model: "cx/gpt-5.6-sol",
          api: "openai-responses",
          apiKey: "sk-direct-omp",
          baseUrl: "https://llm.example.test/v1",
        },
        { agentDir, apiKeyEnvName, baseUrlEnvName },
      );

      expect(setup.modelPattern).toBe("nrouter/cx/gpt-5.6-sol");
      expect(setup.modelRegistry?.find("nrouter", "cx/gpt-5.6-sol")).toMatchObject({
        provider: "nrouter",
        id: "cx/gpt-5.6-sol",
        api: "openai-responses",
        baseUrl: "https://llm.example.test/v1",
        supportsTools: true,
      });
      await expect(setup.authStorage?.getApiKey("nrouter")).resolves.toBe("sk-direct-omp");

      const diagnostics = await new OmpSdkProviderClient({
        config: {
          provider: "nrouter",
          model: "cx/gpt-5.6-sol",
          api: "openai-responses",
          apiKey: "sk-direct-omp",
          baseUrl: "https://llm.example.test/v1",
          codingAgentDirectory: agentDir,
        },
      }).getRuntimeDiagnostics();
      expect(diagnostics.model).toBe("nrouter/cx/gpt-5.6-sol");
    } finally {
      delete process.env[apiKeyEnvName];
      delete process.env[baseUrlEnvName];
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("copies configured API key and base URL into SDK environment variables", async () => {
    const client = new OmpSdkProviderClient({
      config: {
        apiKey: "sk-direct-omp",
        baseUrl: "https://llm.example.test/v1",
      },
    });

    const health = await client.checkHealth();

    expect(health.ok).toBe(false);
    expect(health.reason).toBeTruthy();
    expect(process.env.CHRONA_OMP_API_KEY_HEALTH).toBe("sk-direct-omp");
    expect(process.env.CHRONA_OMP_BASE_URL_HEALTH).toBe("https://llm.example.test/v1");
  });

  it("does not report a selector as healthy when the SDK cannot resolve a runtime model", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "chrona-omp-health-no-model-"));
    try {
      const health = await new OmpSdkProviderClient({
        config: {
          codingAgentDirectory: agentDir,
          provider: "openai-codex",
          model: "gpt-5.6-sol",
        },
      }).checkHealth();

      expect(health.ok).toBe(false);
      expect(health.reason).toMatch(/runtime model|model/i);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

describe("OmpSdkProviderClient declared runtime tools", () => {
  const runtimeTools: NonNullable<StartRunInput["tools"]> = [
    {
      name: "runtime_complete",
      description: "Record a completed runtime result.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
    {
      name: "runtime_lookup",
      description: "Look up runtime information.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  ];

  it("exposes only request-declared tools", () => {
    const options = __ompSdkProviderTestHooks.sdkToolOptions(runtimeTools, "runtime_complete");
    expect(options.customTools.map((tool) => tool.name)).toEqual(["runtime_complete", "runtime_lookup"]);
    expect("toolNames" in options).toBe(false);
  });

  it("adapts declared JSON Schema to SDK tool parameters", () => {
    const schema = __ompSdkProviderTestHooks.jsonSchemaToZod(runtimeTools[0].inputSchema);
    expect(schema.safeParse({ summary: "Done" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("identifies only the declared terminal tool", () => {
    expect(__ompSdkProviderTestHooks.isDeclaredTerminalTool("runtime_complete", runtimeTools, "runtime_complete")).toBe(true);
    expect(__ompSdkProviderTestHooks.isDeclaredTerminalTool("runtime_complete", runtimeTools, "runtime_lookup")).toBe(false);
    expect(__ompSdkProviderTestHooks.isDeclaredTerminalTool("runtime_complete", undefined, "runtime_complete")).toBe(false);
  });

  it("disables built-in tools, MCP, and LSP for read-only and terminal-only runs", () => {
    const isolatedToolOptions = {
      toolNames: [],
      enableMCP: false,
      enableLsp: false,
    };
    expect(__ompSdkProviderTestHooks.sdkReadOnlyToolOptions("read_only")).toEqual(
      isolatedToolOptions,
    );
    expect(__ompSdkProviderTestHooks.sdkReadOnlyToolOptions("terminal_only")).toEqual(
      isolatedToolOptions,
    );
    expect(__ompSdkProviderTestHooks.sdkReadOnlyToolOptions("full")).toEqual({});
  });

  it("connects the run-scoped Chrona MCP server and exposes its tools", async () => {
    let seenServers: Record<string, unknown> | undefined;
    let seenSources: Record<string, unknown> | undefined;
    let disconnects = 0;
    let waits = 0;
    let refreshes = 0;
    const manager = {
      connectServers: async (servers: Record<string, unknown>, sources: Record<string, unknown>) => {
        seenServers = servers;
        seenSources = sources;
        return {
          tools: [],
          errors: new Map<string, string>(),
          connectedServers: [],
          exaApiKeys: [],
        };
      },
      waitForConnection: async () => { waits += 1; return {} as never; },
      refreshServerTools: async () => { refreshes += 1; },
      getConnectedServers: () => ["chrona"],
      getTools: () => [{ name: "mcp__chrona_node_complete", execute: async () => ({ content: [], details: {} }) }],
      disconnectAll: async () => { disconnects += 1; },
    };

    const control = await __ompSdkProviderTestHooks.connectChronaMcpControl(
      {
        control: { baseUrl: "http://chrona.test/api/", runToken: "run-token" },
        sessionId: "chrona:task:task-1:execute:plan-1",
        cwd: "/tmp/workspace",
      },
      () => manager as never,
    );

    expect(seenServers).toEqual({
      chrona: {
        type: "http",
        url: "http://chrona.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aexecute%3Aplan-1",
        headers: { Authorization: "Bearer run-token" },
      },
    });
    expect(seenSources).toMatchObject({
      chrona: { provider: "chrona-control-plane", providerName: "Chrona control plane", level: "native" },
    });
    expect(__ompSdkProviderTestHooks.sdkRunToolOptions(runtimeTools, "runtime_complete", undefined, control)
      .customTools.map((tool) => tool.name)).toEqual([
      "runtime_complete",
      "runtime_lookup",
      "chrona_node_complete",
    ]);
    await control?.manager.disconnectAll();
    expect(disconnects).toBe(1);
    expect(waits).toBe(1);
    expect(refreshes).toBe(1);
  });

  it("posts terminal MCP tool payloads through the run-token control endpoint", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedInit = init;
      return new Response(JSON.stringify({ ok: true, kind: "complete", recorded: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await __ompSdkProviderTestHooks.invokeChronaTerminalControl({
      connection: { baseUrl: "http://chrona.test/api/", runToken: "run-token" },
      kind: "complete",
      payload: { i: "submit result", summary: "Done" },
    }, fetcher);

    expect(requestedUrl).toBe("http://chrona.test/api/agent/control");
    expect(requestedInit?.headers).toEqual({
      Authorization: "Bearer run-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      body: {
        kind: "complete",
        payload: { i: "submit result", summary: "Done" },
      },
    });
    expect(result.details).toEqual({ ok: true, kind: "complete", recorded: true });
  });

  it("rejects a 2xx response without a durable terminal acknowledgement", async () => {
    const fetcher = (async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      ok: false,
      kind: "complete",
      recorded: false,
    }), { status: 200 })) as typeof fetch;

    await expect(__ompSdkProviderTestHooks.invokeChronaTerminalControl({
      connection: { baseUrl: "http://chrona.test", runToken: "run-token" },
      kind: "complete",
      payload: { summary: "Done" },
    }, fetcher)).rejects.toThrow("did not durably acknowledge");
  });

  it("accepts an idempotently replayed terminal acknowledgement", async () => {
    const fetcher = (async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      kind: "complete",
      recorded: false,
      alreadyAccepted: true,
    }), { status: 200 })) as typeof fetch;

    const result = await __ompSdkProviderTestHooks.invokeChronaTerminalControl({
      connection: { baseUrl: "http://chrona.test", runToken: "revoked-run-token" },
      kind: "complete",
      payload: { summary: "Done" },
    }, fetcher);
    expect(result.details).toMatchObject({ ok: true, kind: "complete", alreadyAccepted: true });
  });

  it("rejects every declared Chrona terminal tool without run-scoped control", () => {
    const terminalToolNames = [
      "chrona_node_complete",
      "chrona_condition_select",
      "chrona_wait_complete",
      "chrona_node_request_input",
      "chrona_node_block",
      "chrona_node_fail",
    ];
    for (const name of terminalToolNames) {
      expect(() => __ompSdkProviderTestHooks.sdkRunToolOptions([{
        name,
        description: "Mutate the current execution node.",
        inputSchema: { type: "object", properties: {} },
      }], name, undefined, undefined)).toThrow("requires run-scoped control authorization");
    }
  });

  it("stops SDK startup after cancellation is observed", () => {
    expect(__ompSdkProviderTestHooks.sdkRunStopped({ done: true, status: "running" })).toBe(true);
    expect(__ompSdkProviderTestHooks.sdkRunStopped({ done: false, status: "cancelled" })).toBe(true);
    expect(__ompSdkProviderTestHooks.sdkRunStopped({ done: false, status: "running" })).toBe(false);
  });

  it("removes queue abort listeners after every wakeup", async () => {
    let listener: (() => void) | undefined;
    let added = 0;
    let removed = 0;
    const signal = {
      aborted: false,
      addEventListener: (_type: string, callback: () => void) => {
        added += 1;
        listener = callback;
      },
      removeEventListener: (_type: string, callback: () => void) => {
        if (listener === callback) listener = undefined;
        removed += 1;
      },
    } as unknown as AbortSignal;
    const handle = {
      done: false,
      queue: [],
      waiters: [],
    };
    const queue = new __ompSdkProviderTestHooks.AsyncEventQueue(handle as never);

    const first = queue.next(signal);
    queue.push({ type: "end" });
    await first;
    const second = queue.next(signal);
    queue.push({ type: "end" });
    await second;

    expect(added).toBe(2);
    expect(removed).toBe(2);
    expect(listener).toBeUndefined();
    expect(handle.waiters).toHaveLength(0);
  });

  it("delivers a queued terminal event before ending an aborted stream", async () => {
    const controller = new AbortController();
    const handle = {
      done: false,
      queue: [],
      waiters: [],
    };
    const queue = new __ompSdkProviderTestHooks.AsyncEventQueue(handle as never);

    const next = queue.next(controller.signal);
    queue.push({ type: "run_cancelled" } as never);
    controller.abort("Chrona terminal action recorded");

    await expect(next).resolves.toEqual({ type: "run_cancelled" });
    handle.done = true;
    await expect(queue.next(controller.signal)).resolves.toEqual({ type: "end" });
  });

  it("stops the SDK session with an explicit terminal-action reason", async () => {
    let abortReason: unknown;
    const handle = {
      terminalActionAccepted: false,
      session: {
        abort: (input: unknown) => {
          abortReason = input;
        },
      },
    };

    __ompSdkProviderTestHooks.acceptTerminalAction(handle as never);
    await Promise.resolve();

    expect(handle.terminalActionAccepted).toBe(true);
    expect(abortReason).toEqual({ reason: "Chrona terminal action recorded" });
    expect(
      __ompSdkProviderTestHooks.isRunTerminalTool(
        {
          ...startInput("chrona_node_complete"),
          control: { baseUrl: "http://chrona.test", runToken: "run-token" },
        },
        "chrona_node_complete",
      ),
    ).toBe(true);
  });

  it("routes declared request-input terminal tools through run-token control", async () => {
    const originalFetch = globalThis.fetch;
    let requestedBody: unknown;
    let terminalAccepted = 0;
    let aborts = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, kind: "request_input", recorded: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const tools = __ompSdkProviderTestHooks.sdkRunToolOptions([{
        name: "chrona_node_request_input",
        description: "Request structured input.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string" }, instructions: { type: "string" } },
          required: ["title", "instructions"],
        },
      }], "chrona_node_request_input", () => { terminalAccepted += 1; }, {
        manager: { disconnectAll: async () => undefined },
        connection: { baseUrl: "http://chrona.test/api", runToken: "run-token" },
        tools: [],
      } as never).customTools;

      await tools[0]!.execute("request-input", {
        title: "Choose source",
        instructions: "Select one source.",
      }, undefined, { abort: () => { aborts += 1; } } as never, undefined);
      await Promise.resolve();

      expect(requestedBody).toEqual({
        body: {
          kind: "request_input",
          payload: { title: "Choose source", instructions: "Select one source." },
        },
      });
      expect(terminalAccepted).toBe(1);
      expect(aborts).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails the run when the Chrona MCP control plane cannot connect", async () => {
    let disconnects = 0;
    const manager = {
      connectServers: async () => ({
        tools: [],
        errors: new Map([["chrona", "HTTP 401"]]),
        connectedServers: [],
        exaApiKeys: [],
      }),
      disconnectAll: async () => { disconnects += 1; },
    };

    await expect(__ompSdkProviderTestHooks.connectChronaMcpControl(
      {
        control: { baseUrl: "http://chrona.test", runToken: "expired-token" },
        sessionId: "chrona:session",
        cwd: "/tmp/workspace",
      },
      () => manager as never,
    )).rejects.toThrow("Oh My Pi could not connect to the Chrona control plane: HTTP 401");
    expect(disconnects).toBe(1);
  });

  it("accepts and aborts only after the declared terminal tool runs", async () => {
    let terminalAccepted = 0;
    let aborts = 0;
    const tools = __ompSdkProviderTestHooks.sdkToolOptions(
      runtimeTools,
      "runtime_complete",
      () => { terminalAccepted += 1; },
    ).customTools;
    const context = { abort: () => { aborts += 1; } };
    await tools.find((tool) => tool.name === "runtime_lookup")!.execute("lookup", { key: "status" }, undefined, context as never, undefined);
    await tools.find((tool) => tool.name === "runtime_complete")!.execute("complete", { summary: "Done" }, undefined, context as never, undefined);
    await Promise.resolve();
    expect(terminalAccepted).toBe(1);
    expect(aborts).toBe(1);
  });


  it("lets resumed sessions restore their persisted model before pin verification", () => {
    expect(__ompSdkProviderTestHooks.sdkModelPatternForSession(
      "OmniRoute/gpt-5.6-sol",
      "/tmp/session.jsonl",
    )).toBeUndefined();
    expect(__ompSdkProviderTestHooks.sdkModelPatternForSession(
      "OmniRoute/gpt-5.6-sol",
      undefined,
    )).toBe("OmniRoute/gpt-5.6-sol");
  });

  it("rejects provider model drift before execution", () => {
    expect(() => __ompSdkProviderTestHooks.assertExpectedModel(
      "OmniRoute/gpt-5.6-sol",
      "openai-codex/gpt-5.5",
    )).toThrow(
      "OMP model routing conflict: expected 'OmniRoute/gpt-5.6-sol', resolved 'openai-codex/gpt-5.5'",
    );
    expect(() => __ompSdkProviderTestHooks.assertExpectedModel(
      "OmniRoute/gpt-5.6-sol",
      "OmniRoute/gpt-5.6-sol",
    )).not.toThrow();
  });

  it("surfaces the concrete SDK tool error text", () => {
    expect(__ompSdkProviderTestHooks.sdkToolErrorMessage({
      content: [{ type: "text", text: "Runtime tool execution timed out" }],
      isError: true,
    })).toBe("Runtime tool execution timed out");
    expect(__ompSdkProviderTestHooks.sdkToolErrorMessage({ details: {} })).toBe("Oh My Pi SDK tool call failed");
  });

  it("classifies aborted agent endings as failures", () => {
    expect(__ompSdkProviderTestHooks.agentEndFailure({
      type: "agent_end",
      messages: [{
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "aborted",
        errorMessage: "Deadline exceeded",
        timestamp: 0,
      }],
    })).toBe("Deadline exceeded");
  });
  it("treats an aborted agent end as completed after a terminal action was accepted", () => {
    const event = {
      type: "agent_end" as const,
      messages: [{
        role: "assistant" as const,
        content: [],
        api: "openai-completions",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "aborted" as const,
        errorMessage: "Operation aborted",
        timestamp: 0,
      }],
    };
    expect(__ompSdkProviderTestHooks.agentEndOutcome(event, true)).toEqual({ status: "completed" });
    expect(__ompSdkProviderTestHooks.agentEndOutcome(event, false)).toEqual({ status: "failed", error: "Operation aborted" });
  });

  it("extracts a declared terminal tool from the completed snapshot", () => {
    const tools = [{ name: "runtime_complete", inputSchema: { type: "object" } }];
    const terminal = __ompSdkProviderTestHooks.terminalToolFromSnapshot({
      raw: {
        terminalTool: {
          name: "runtime_complete",
          input: { summary: "Completed package" },
        },
      },
      terminalToolName: "runtime_complete",
      tools,
    });
    expect(terminal).toEqual({
      name: "runtime_complete",
      input: { summary: "Completed package" },
    });
  });


  it("accepts successful agent endings", () => {
    expect(__ompSdkProviderTestHooks.agentEndFailure({
      type: "agent_end",
      messages: [{
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 0,
      }],
    })).toBeNull();
  });

  it("preserves OMP tool intent as the live activity preview", () => {
    expect(__ompSdkProviderTestHooks.toolCallPreview({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "mcp__codegraph_explore",
      args: { i: "Mapping architectural risk" },
      intent: "Mapping architectural risk",
    })).toBe("Mapping architectural risk");
  });

  it("extracts bounded text from OMP tool progress updates", () => {
    expect(__ompSdkProviderTestHooks.textContentPreview({
      content: [{ type: "text", text: "Scout is reading execution flow" }],
    })).toBe("Scout is reading execution flow");
  });

  it("summarizes OMP lifecycle events without exposing raw session payloads", () => {
    expect(__ompSdkProviderTestHooks.sdkLifecycleSummary({
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: "provider unavailable",
    })).toBe("Retry 2/3 scheduled after provider error.");
    expect(__ompSdkProviderTestHooks.sdkLifecycleSummary({
      type: "auto_compaction_end",
      action: "context-full",
      result: undefined,
      aborted: false,
      willRetry: false,
    })).toBe("Context compaction completed (context-full).");
  });
});

describe("OmpProviderClient SDK delegation", () => {
  it("uses the SDK for arbitrary terminal tool calls", async () => {
    const sdk = new RecordingProvider("sdk-run");
    const client = new OmpProviderClient({ sdkClient: sdk });

    const run = await client.startRun(startInput("custom_terminal"));
    await Array.fromAsync(client.streamRun({ runId: run.runId, sessionId: run.sessionId }));

    expect(run.runId).toBe("sdk-run");
    expect(sdk.calls).toEqual(["startRun:custom_terminal", "streamRun"]);
  });

  it("uses the SDK for normal OMP runs", async () => {
    const sdk = new RecordingProvider("sdk-run");
    const client = new OmpProviderClient({ sdkClient: sdk });

    const run = await client.startRun(startInput());
    await client.getRun({ runId: run.runId, sessionId: run.sessionId });

    expect(run.runId).toBe("sdk-run");
    expect(sdk.calls).toEqual(["startRun:none", "getRun"]);
  });

  it("uses the SDK for health checks", async () => {
    const sdk = new RecordingProvider("sdk-run");
    const client = new OmpProviderClient({ sdkClient: sdk });

    await client.checkHealth();

    expect(sdk.calls).toEqual(["checkHealth"]);
  });

  it("delegates conversation inspection and follow-up turns to the SDK client", async () => {
    const sdk = new RecordingProvider("sdk-run");
    sdk.getConversationCapabilities = () => ({
      resume: true,
      fork: true,
      compact: true,
      handoff: "native",
      contextUsage: "detailed",
    });
    sdk.inspectConversation = async (sessionRef: string) => ({
      available: true,
      sessionRef,
      compacted: false,
    });
    sdk.handoffConversation = async (input) => ({
      sessionRef: `${input.sessionRef}.handoff`,
      handoffText: "compacted context",
    });
    sdk.runConversationTurn = async (input: ProviderConversationTurnInput) => ({
      sessionRef: input.sessionRef,
      outputText: "continued",
    });
    const client = new OmpProviderClient({ sdkClient: sdk });

    expect(client.getConversationCapabilities()?.resume).toBe(true);
    await expect(client.inspectConversation("/tmp/session.jsonl")).resolves.toMatchObject({
      available: true,
    });
    await expect(client.runConversationTurn({
      sessionRef: "/tmp/session.jsonl",
      prompt: "follow up",
      mode: "resume",
    })).resolves.toMatchObject({ outputText: "continued" });
    await expect(client.handoffConversation({
      sessionRef: "/tmp/session.jsonl",
      instructions: "Prepare next task",
    })).resolves.toMatchObject({
      sessionRef: "/tmp/session.jsonl.handoff",
      handoffText: "compacted context",
    });
  });
  it("loads the current OMP default independently of process-global Settings", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "chrona-omp-settings-"));
    try {
      await writeFile(join(agentDir, "config.yml"), [
        "modelRoles:",
        "  default: OmniRoute/gpt-5.6-sol",
        "",
      ].join("\n"));

      const settings = await __ompSdkProviderTestHooks.loadSdkSettings({
        agentDir,
      }, "/tmp/workspace");

      expect(settings.getModelRole("default")).toBe("OmniRoute/gpt-5.6-sol");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("reports effective SDK configuration without secrets", async () => {
    const client = new OmpSdkProviderClient({
      config: {
        model: "gpt-test",
        baseUrl: "https://example.invalid/v1",
        configDirectory: "/tmp/omp-config",
        codingAgentDirectory: "/tmp/omp-agent",
        cwd: "/tmp/workspace",
        apiKey: "secret",
      },
    });

    const diagnostics = await client.getRuntimeDiagnostics();
    expect(diagnostics).toMatchObject({
      provider: "omp",
      contextStrategy: "auto_compact",
      workingDirectory: "/tmp/workspace",
      configDirectory: "/tmp/omp-config",
      agentDirectory: "/tmp/omp-agent",
      configurationCapabilities: {
        tooling: {
          mcp: { supported: true, enabled: true },
          lsp: { supported: true, enabled: true },
          subagents: { supported: true, enabled: true },
          enabledTools: expect.arrayContaining([
            "lsp",
            "task",
          ]),
        },
      },
      sources: {
        model: "provider_override",
        context: "provider_default",
        configDirectory: "provider_override",
        agentDirectory: "provider_override",
        tools: "runtime",
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });
});
