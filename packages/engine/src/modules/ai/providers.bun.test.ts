import { describe, expect, it, mock } from "bun:test";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import { runProviderRequest, type ProviderFeatureRequest } from "@chrona/engine/test-support";
const providerCapabilities = {
  supportsSessions: true,
  supportsStreaming: true,
  supportsRunLookup: true,
  supportsCancellation: true,
  supportsToolCalls: true,
  supportsPreviousResponse: false,
  actionInvocation: "unsupported" as const,
  startIdempotency: "unsupported" as const,
  lookupByClientOperationId: false,
  recovery: {
    sessionResume: false,
    historyReplay: false,
    activeRunLookup: false,
    streamReconnect: false,
    providerResumeRef: false,
    runEventReplay: false,
    mode: "local_stream_only" as const,
  },
};


const request: ProviderFeatureRequest = {
  clientOperationId: "providers-test-operation",
  sessionId: "session-key",
  sessionKey: "session-key",
  instructions: "Answer from the accepted result",
  input: { type: "text", text: "How many results?" },
  stream: false,
};

describe("runProviderRequest", () => {
  it("starts the provider run before streaming it with the returned identifiers", async () => {
    const calls: string[] = [];
    const startRun = mock(async () => {
      calls.push("start");
      return {
        provider: "test",
        sessionId: "provider-session",
        runId: "provider-run",
      };
    });
    const streamRun = mock(async function* (input: {
      runId?: string;
      sessionId?: string;
    }) {
      calls.push("stream");
      expect(input).toEqual({
        runId: "provider-run",
        sessionId: "provider-session",
      });
      yield {
        type: "run_completed" as const,
        provider: "test",
        runId: "provider-run",
        sessionId: "provider-session",
        sequence: 0,
        run: {
          provider: "test",
          sessionId: "provider-session",
          runId: "provider-run",
          status: "completed" as const,
        },
        outputText: "13",
      };
    });
    const provider = {
      provider: "test",
      getCapabilities: async () => providerCapabilities,
      startRun,
      streamRun,
    } as unknown as AgentProviderClient;

    const result = await runProviderRequest(provider, request);

    expect(calls).toEqual(["start", "stream"]);
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-key",
        sessionKey: "session-key",
        instructions: "Answer from the accepted result",
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      sessionId: "provider-session",
      runId: "provider-run",
      outputText: "13",
    });
  });

  it("observes validated stream events in provider order", async () => {
    const observed: string[] = [];
    const provider = {
      provider: "test",
      getCapabilities: async () => providerCapabilities,
      startRun: async () => ({
        provider: "test",
        sessionId: "provider-session",
        runId: "provider-run",
      }),
      streamRun: async function* () {
        yield {
          type: "run_started" as const,
          provider: "test",
          runId: "provider-run",
          sessionId: "provider-session",
          sequence: 0,
          run: {
            provider: "test",
            sessionId: "provider-session",
            runId: "provider-run",
            status: "running" as const,
          },
        };
        yield {
          type: "run_completed" as const,
          provider: "test",
          runId: "provider-run",
          sessionId: "provider-session",
          sequence: 1,
          run: {
            provider: "test",
            sessionId: "provider-session",
            runId: "provider-run",
            status: "completed" as const,
          },
          outputText: "13",
        };
      },
    } as unknown as AgentProviderClient;

    await runProviderRequest(provider, request, {
      onEvent: async (event) => {
        observed.push(event.type);
      },
    });

    expect(observed).toEqual(["run_started", "run_completed"]);
  });

  it("does not expose invalid events to observers", async () => {
    const observer = mock(() => undefined);
    const provider = {
      provider: "test",
      getCapabilities: async () => providerCapabilities,
      startRun: async () => ({
        provider: "test",
        sessionId: "provider-session",
        runId: "provider-run",
      }),
      streamRun: async function* () {
        yield {
          type: "text_delta",
          provider: "test",
          runId: "wrong-run",
          sessionId: "provider-session",
          sequence: 0,
          text: "untrusted",
        };
      },
    } as unknown as AgentProviderClient;

    await expect(runProviderRequest(provider, request, { onEvent: observer }))
      .rejects.toMatchObject({ code: "internal" });
    expect(observer).not.toHaveBeenCalled();
  });
});
