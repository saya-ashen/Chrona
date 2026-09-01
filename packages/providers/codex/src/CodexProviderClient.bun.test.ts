import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { StartRunInput } from "@chrona/providers-foundation";
import type { AcpClientHandlers, AcpProviderConfig, AcpTransport } from "@chrona/acp-provider";
import { codexAcpConfig, codexAcpEnv } from "./types";
import { CodexProviderClient } from "./CodexProviderClient";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    clientOperationId: "codex-base-operation",
    sessionId: "codex-session-1",
    instructions: "Finish node.",
    input: "Return success.",
    stream: true,
    ...overrides,
  };
}

type RequestRecord = { method: string; params: unknown };

type FakeSession = {
  sessionId: string;
  updates: Array<
    | { kind: "session_update"; update: unknown }
    | { kind: "stop"; stopReason: string; response: unknown }
  >;
  prompt(input: unknown): Promise<unknown>;
  nextUpdate(): Promise<FakeSession["updates"][number] | undefined>;
  dispose(): void;
};

class FakeAcpTransport implements AcpTransport {
  readonly requests: RequestRecord[] = [];
  readonly session: FakeSession;

  constructor(input: FakeSession["updates"] | { updates?: FakeSession["updates"]; promptError?: Error } = []) {
    const updates = Array.isArray(input) ? input : input.updates ?? [];
    const promptError = Array.isArray(input) ? undefined : input.promptError;
    this.session = {
      sessionId: "codex-native-session-1",
      updates,
      async prompt() {
        if (promptError) throw promptError;
        return { stopReason: "end_turn" };
      },
      async nextUpdate() {
        return this.updates.shift();
      },
      dispose() {},
    };
  }

  async connect<T>(_config: AcpProviderConfig, _handlers: AcpClientHandlers, op: (connection: Parameters<Parameters<AcpTransport["connect"]>[2]>[0]) => Promise<T>): Promise<T> {
    const context = {
      request: async (method: string, params: unknown) => {
        this.requests.push({ method, params });
        if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } };
        if (method === "session/load") return { modes: null };
        throw new Error(`unexpected request ${method}`);
      },
      buildSession: (params: unknown) => {
        this.requests.push({ method: "session/new", params });
        return { start: async () => this.session };
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

const ORIGINAL_FETCH = globalThis.fetch;

function stubMcpTools(toolNames: string[]) {
  globalThis.fetch = mock(async (_url: string | URL | Request, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) as { method?: string } : {};
    if (body.method === "initialize") {
      return new Response("", { status: 200, headers: { "mcp-session-id": "mcp-session-1" } });
    }
    if (body.method === "tools/list") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: toolNames.map((name) => ({ name })) } }), { status: 200 });
    }
    return new Response("unexpected MCP method", { status: 400 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restore();
});

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

  it("passes gateway config, default gateway auth, and Chrona MCP direct namespace", () => {
    const env = codexAcpEnv({
      apiKey: "sk-gateway",
      baseUrl: " https://gateway.example/v1 ",
      model: "gpt-5-codex",
    });

    expect(env.MODEL_PROVIDER).toBe("chrona-gateway");
    expect(JSON.parse(env.CODEX_CONFIG ?? "{}")).toMatchObject({
      baseUrl: " https://gateway.example/v1 ",
      model: "gpt-5-codex",
      model_provider: "chrona-gateway",
      model_providers: {
        "chrona-gateway": {
          base_url: "https://gateway.example/v1",
          http_headers: { Authorization: "Bearer sk-gateway" },
          wire_api: "responses",
        },
      },
      features: {
        code_mode: {
          enabled: true,
          direct_only_tool_namespaces: ["chrona", "mcp__chrona"],
        },
      },
    });
    expect(JSON.parse(env.DEFAULT_AUTH_REQUEST ?? "{}")).toEqual({
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl: "https://gateway.example/v1",
          headers: { Authorization: "Bearer sk-gateway" },
          providerName: "Chrona Codex Gateway",
        },
      },
    });
  });

  it("uses api-key auth only for default OpenAI Codex provider", () => {
    const env = codexAcpEnv({ apiKey: "sk-openai" });

    expect(JSON.parse(env.DEFAULT_AUTH_REQUEST ?? "{}")).toEqual({
      methodId: "api-key",
      _meta: { "api-key": { apiKey: "sk-openai" } },
    });
  });

  it("maps config directory to CODEX_HOME", () => {
    const env = codexAcpEnv({ configDirectory: " /tmp/chrona-codex " });

    expect(env.CODEX_HOME).toBe("/tmp/chrona-codex");
    expect(JSON.parse(env.CODEX_CONFIG ?? "{}")).toMatchObject({
      features: {
        code_mode: {
          enabled: true,
          direct_only_tool_namespaces: ["chrona", "mcp__chrona"],
        },
      },
    });
  });

  it("preserves caller Codex feature config while adding Chrona direct MCP namespaces", () => {
    const env = codexAcpEnv({
      codexConfig: {
        features: {
          code_mode: {
            enabled: false,
            direct_only_tool_namespaces: ["existing", "chrona"],
          },
        },
      },
    });

    expect(JSON.parse(env.CODEX_CONFIG ?? "{}")).toMatchObject({
      features: {
        code_mode: {
          enabled: true,
          direct_only_tool_namespaces: ["existing", "chrona", "mcp__chrona"],
        },
      },
    });
  });
});

describe("codexAcpConfig", () => {
  it("maps Codex config to generic ACP config", () => {
    expect(codexAcpConfig({
      binaryPath: "/tmp/codex-acp",
      timeoutMs: 120,
      mcpBaseUrl: "http://chrona.test",
      mcpRunToken: "token",
    })).toMatchObject({
      provider: "codex",
      displayName: "OpenAI Codex",
      command: "/tmp/codex-acp",
      timeoutMs: 120,
      mcpBaseUrl: "http://chrona.test",
      mcpRunToken: "token",
      healthCheck: "prompt",
      auth: { useExisting: true },
    });
  });

  it("selects ACP authentication from the configured credential source", () => {
    expect(codexAcpConfig({}).auth).toEqual({ useExisting: true });
    expect(codexAcpConfig({ apiKey: "sk-openai" }).auth).toEqual({
      methodId: "api-key",
    });
    expect(
      codexAcpConfig({ baseUrl: "https://gateway.example/v1" }).auth,
    ).toEqual({ methodId: "gateway" });
    expect(codexAcpConfig({ noBrowser: true }).auth).toEqual({
      useExisting: true,
    });
  });

  it("uses bundled codex-acp when no binary override is configured", () => {
    const config = codexAcpConfig({});

    expect(config.command).toContain("@agentclientprotocol/codex-acp");
    expect(config.command.endsWith("dist/index.js")).toBe(true);
  });
});

describe("CodexProviderClient", () => {
  it("delegates to generic ACP provider", async () => {
    const transport = new FakeAcpTransport([
      { kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } },
      {
        kind: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "CHRONA_ACP_HEALTH_OK" },
        },
      },
      { kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } },
    ]);
    const client = new CodexProviderClient({
      config: { mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" },
      acp: { transport },
    });

    expect(await client.getCapabilities()).toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsToolCalls: true,
      approval: { supported: true },
      recovery: { mode: "session_history", sessionResume: true, historyReplay: true, activeRunLookup: false },
      reason: "OpenAI Codex ACP provider",
    });
    const run = await client.startRun(baseInput({ sessionKey: "chrona:codex" }));
    const streamed = [];
    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(run.provider).toBe("codex");
    expect(streamed.at(-1)).toMatchObject({ type: "run_completed", provider: "codex" });
    expect(transport.requests.find((request) => request.method === "session/new")?.params).toMatchObject({
      mcpServers: [
        {
          url: "http://chrona.test/api/mcp?session_id=chrona%3Acodex",
          headers: [{ name: "Authorization", value: "Bearer run-token" }],
        },
      ],
    });

    stubMcpTools(["terminal_result", "plan_context"]);
    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "codex",
      ok: true,
      reason: "OpenAI Codex model endpoint completed a prompt",
    });
  });

  it("loads prior Codex ACP sessions without applying Claude Code resume guards", async () => {
    const syntheticLookingRef = "claude-sdk-3583bad8-4764-417b-9998-973c5b6bde60";
    const transport = new FakeAcpTransport([{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }]);
    const client = new CodexProviderClient({
      config: { mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" },
      acp: { transport },
    });

    const run = await client.startRun(baseInput({
      sessionKey: "chrona:codex",
      resumeSessionRef: syntheticLookingRef,
    }));
    const streamed = [];
    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(transport.requests.some((request) => request.method === "session/new")).toBe(false);
    expect(transport.requests.find((request) => request.method === "session/load")?.params).toMatchObject({
      sessionId: syntheticLookingRef,
    });
    expect(run).toMatchObject({
      provider: "codex",
      sessionId: "codex-session-1",
      nativeSessionId: syntheticLookingRef,
    });
    expect(streamed.at(-1)).toMatchObject({
      type: "run_completed",
      provider: "codex",
      sessionId: "codex-session-1",
      nativeSessionId: syntheticLookingRef,
    });
  });


  it("surfaces upstream auth status from Codex logs", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "chrona-codex-test-"));
    const db = new Database(join(codexHome, "logs_2.sqlite"));
    db.run("CREATE TABLE logs (id INTEGER PRIMARY KEY, feedback_log_body TEXT)");
    db.query("INSERT INTO logs (feedback_log_body) VALUES (?)").run(
      "Request completed method=POST url=https://api.krill-ai.com/codex/v1/responses status=401 Unauthorized headers={}",
    );
    db.close();
    const transport = new FakeAcpTransport({ promptError: new Error("Internal error") });
    const client = new CodexProviderClient({
      config: { configDirectory: codexHome, mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" },
      acp: { transport },
    });

    const streamed = [];
    const run = await client.startRun(baseInput());
    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.at(-1)).toMatchObject({
      type: "run_failed",
      error: "Internal error: upstream provider authentication failed (401 Unauthorized). Check provider API key and base URL.",
    });
  });
});
