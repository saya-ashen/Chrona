import { describe, expect, it } from "bun:test";
import type {
  AgentProviderClient,
  ProviderRunRef,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import { OmpProviderClient } from "./OmpProviderClient";
import { OmpSdkProviderClient, __ompSdkProviderTestHooks } from "./OmpSdkProviderClient";

class RecordingProvider implements AgentProviderClient {
  readonly provider = "omp";
  calls: string[] = [];

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
});
