import { describe, expect, it } from "bun:test";
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
    terminalToolName,
  };
}


describe("OmpSdkProviderClient direct config", () => {
  it("copies configured API key and base URL into SDK environment variables", async () => {
    const client = new OmpSdkProviderClient({
      config: {
        apiKey: "sk-direct-omp",
        baseUrl: "https://llm.example.test/v1",
      },
    });

    const health = await client.checkHealth();

    expect(health.ok).toBe(true);
    expect(process.env.CHRONA_OMP_API_KEY_HEALTH).toBe("sk-direct-omp");
    expect(process.env.CHRONA_OMP_BASE_URL_HEALTH).toBe("https://llm.example.test/v1");
  });
});

describe("OmpSdkProviderClient node runtime tools", () => {
  it("expands task node terminal action into the full task runtime tool set", () => {
    expect(__ompSdkProviderTestHooks.sdkToolNamesForTerminal("chrona_node_complete")).toEqual([
      "chrona_plan_output",
      "chrona_node_complete",
      "chrona_node_block",
      "chrona_node_fail",
    ]);
  });

  it("keeps plan generation as a single strict terminal tool", () => {
    expect(__ompSdkProviderTestHooks.sdkToolNamesForTerminal("chrona_plan_generate")).toEqual([
      "chrona_plan_generate",
    ]);
  });

  it("does not narrow OMP SDK tools with toolNames", () => {
    const options = __ompSdkProviderTestHooks.sdkToolOptionsForTerminal("chrona_node_complete");
    expect(options.customTools.map((tool) => tool.name)).toEqual([
      "chrona_plan_output",
      "chrona_node_complete",
      "chrona_node_block",
      "chrona_node_fail",
    ]);
    expect("toolNames" in options).toBe(false);
  });
  it("surfaces the concrete SDK tool error text", () => {
    expect(__ompSdkProviderTestHooks.sdkToolErrorMessage({
      content: [{ type: "text", text: "Chrona control request timed out" }],
      isError: true,
    })).toBe("Chrona control request timed out");
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
  it("uses the SDK for plan-generation terminal tool calls", async () => {
    const sdk = new RecordingProvider("sdk-run");
    const client = new OmpProviderClient({ sdkClient: sdk });

    const run = await client.startRun(startInput("chrona_plan_generate"));
    await Array.fromAsync(client.streamRun({ runId: run.runId, sessionId: run.sessionId }));

    expect(run.runId).toBe("sdk-run");
    expect(sdk.calls).toEqual(["startRun:chrona_plan_generate", "streamRun"]);
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
});
