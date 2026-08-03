import { describe, expect, it, mock } from "bun:test";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type { CompiledAiFeatureRequest } from "../../feature-runtime";
import { FoundationProviderRuntime } from "./foundation-provider-runtime";

const request: CompiledAiFeatureRequest = {
  feature: "test.feature",
  instructions: "Return a terminal result.",
  input: {},
  tools: [],
  structuredOutputSchema: { type: "object" },
  clientOperationId: "feature-run-1",
};

function provider() {
  const lookups: unknown[] = [];
  const client = {
    provider: "fake",
    async getCapabilities() {
      return {
        supportsSessions: true,
        supportsStreaming: true,
        supportsRunLookup: true,
        supportsCancellation: true,
        supportsToolCalls: true,
        supportsPreviousResponse: false,
        actionInvocation: "unsupported" as const,
        startIdempotency: "client_operation_id" as const,
        recovery: {
          sessionResume: true,
          historyReplay: true,
          activeRunLookup: true,
          streamReconnect: true,
          crossProcessDurable: true,
          providerResumeRef: true,
          runEventReplay: true,
          mode: "authoritative_run_lookup" as const,
        },
      };
    },
    getRun: mock(async (input: unknown) => {
      lookups.push(input);
      return {
        provider: "fake",
        runId: "provider-run-1",
        sessionId: "provider-session-1",
        providerResumeRef: "provider-resume-1",
        status: "completed" as const,
        structuredPayload: { status: "completed" },
      };
    }),
  } as unknown as AgentProviderClient;
  return { client, lookups };
}

describe("FoundationProviderRuntime recovery references", () => {
  it("looks up a persisted run by run ID and preserves the provider-native resume ref", async () => {
    const fake = provider();
    const runtime = await new FoundationProviderRuntime("test.feature", fake.client).initialize();

    const turn = await runtime.startOrAttach(request, "provider-run-1");

    expect(fake.lookups).toEqual([{ runId: "provider-run-1" }]);
    expect(turn).toMatchObject({
      kind: "terminal",
      providerRunRef: "provider-run-1",
      providerResumeRef: "provider-resume-1",
    });
    expect(runtime.capabilities).toMatchObject({ supportsClientOperationId: true, supportsResume: true });
  });

  it("does not reinterpret an opaque resume ref as a provider session ID", async () => {
    const fake = provider();
    const runtime = await new FoundationProviderRuntime("test.feature", fake.client).initialize();

    const turn = await runtime.resume({
      providerRunRef: "provider-run-1",
      providerResumeRef: "persisted-opaque-resume",
      clientOperationId: request.clientOperationId,
      request,
    });

    expect(fake.lookups).toEqual([{ runId: "provider-run-1" }]);
    expect(turn).toMatchObject({
      kind: "terminal",
      providerRunRef: "provider-run-1",
      providerResumeRef: "provider-resume-1",
    });
  });
});
