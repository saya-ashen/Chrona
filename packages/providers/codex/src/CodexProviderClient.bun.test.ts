import { describe, expect, it } from "bun:test";
import type { StartRunInput } from "@chrona/providers-foundation";
import type { AcpClientHandlers, AcpProviderConfig, AcpTransport } from "@chrona/acp-provider";
import { codexAcpConfig, codexAcpEnv } from "./types";
import { CodexProviderClient } from "./CodexProviderClient";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
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
  updates: Array<{ kind: "stop"; stopReason: string; response: unknown }>;
  prompt(input: unknown): Promise<unknown>;
  nextUpdate(): Promise<FakeSession["updates"][number] | undefined>;
  dispose(): void;
};

class FakeAcpTransport implements AcpTransport {
  readonly requests: RequestRecord[] = [];
  readonly session: FakeSession;

  constructor(updates: FakeSession["updates"] = []) {
    this.session = {
      sessionId: "codex-native-session-1",
      updates,
      async prompt() {
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
        if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } };
        throw new Error(`unexpected request ${method}`);
      },
      buildSession: (params: unknown) => {
        this.requests.push({ method: "session/new", params });
        return { start: async () => this.session };
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

  it("maps config directory to CODEX_HOME", () => {
    const env = codexAcpEnv({ configDirectory: " /tmp/chrona-codex " });

    expect(env.CODEX_HOME).toBe("/tmp/chrona-codex");
    expect(env.CODEX_CONFIG).toBeUndefined();
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
    });
  });
});

describe("CodexProviderClient", () => {
  it("delegates to generic ACP provider", async () => {
    const transport = new FakeAcpTransport([{ kind: "stop", stopReason: "end_turn", response: { stopReason: "end_turn" } }]);
    const client = new CodexProviderClient({
      config: { mcpBaseUrl: "http://chrona.test", mcpRunToken: "run-token" },
      acp: { transport },
    });

    expect(client.getCapabilities()).toMatchObject({
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
  });
});
