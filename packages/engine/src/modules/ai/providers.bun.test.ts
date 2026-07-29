import { describe, expect, it, mock } from "bun:test";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import { runProviderRequest, type ProviderFeatureRequest } from "@chrona/engine/test-support";

const request: ProviderFeatureRequest = {
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
});
