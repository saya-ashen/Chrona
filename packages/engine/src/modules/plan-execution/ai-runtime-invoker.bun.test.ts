import { describe, expect, it, mock } from "bun:test";
import type {
  AgentProviderClient,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
} from "@chrona/providers-foundation";
import { runProviderRequest } from "./ai-runtime-invoker";

const request = {
  sessionId: "session-1",
  sessionKey: "session-key-1",
  instructions: "do work",
  input: { kind: "task" },
};

function runRef(): ProviderRunRef {
  return {
    provider: "hermes",
    runId: "run-1",
    nativeRunId: "run-1",
    sessionId: "session-1",
    status: "running",
  };
}

function incompleteStream(): AsyncIterable<ProviderRunEvent> {
  return (async function* () {
    yield { type: "text_delta", text: "partial", runId: "run-1" } as ProviderRunEvent;
    // Ends without a terminal run_completed/run_failed event.
  })();
}

describe("runProviderRequest stream-interruption fallback", () => {
  it("keeps the run Running when the stream ends with no terminal event and the provider still reports it running", async () => {
    const startRun = mock(async () => runRef());
    const streamRun = mock(() => incompleteStream());
    const getRun = mock(
      async (): Promise<ProviderRunSnapshot> => ({
        provider: "hermes",
        runId: "run-1",
        sessionId: "session-1",
        status: "running",
        error: null,
      }),
    );

    const client = {
      provider: "hermes",
      startRun,
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    // startRun once (no duplicate run spawned), streamRun twice (initial + one
    // reconnect), then getRun reconciles the authoritative state.
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(streamRun).toHaveBeenCalledTimes(2);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("running");
    expect(snapshot.error).toBeNull();
  });

  it("finalizes from the provider snapshot when the run completed while the stream was severed", async () => {
    const streamRun = mock(() => incompleteStream());
    const getRun = mock(
      async (): Promise<ProviderRunSnapshot> => ({
        provider: "hermes",
        runId: "run-1",
        sessionId: "session-1",
        status: "completed",
        outputText: "final answer",
        error: null,
      }),
    );

    const client = {
      provider: "hermes",
      startRun: mock(async () => runRef()),
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.outputText).toBe("final answer");
  });

  it("leaves the run Running for later recovery when getRun is unavailable", async () => {
    const getRun = mock(async (): Promise<ProviderRunSnapshot> => {
      throw new Error("provider unreachable");
    });

    const client = {
      provider: "hermes",
      startRun: mock(async () => runRef()),
      streamRun: mock(() => incompleteStream()),
      getRun,
    } as unknown as AgentProviderClient;

    const snapshot = await runProviderRequest(client, request);

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(snapshot.status).toBe("running");
    expect(snapshot.error).toBeNull();
    expect(snapshot.runId).toBe("run-1");
  });

  it("rethrows non-transient stream errors without reconnecting or polling", async () => {
    const getRun = mock(async () => {
      throw new Error("should not be called");
    });
    const streamRun = mock((): AsyncIterable<ProviderRunEvent> =>
      (async function* () {
        yield* [];
        throw new Error("fatal misconfiguration");
      })(),
    );

    const client = {
      provider: "hermes",
      startRun: mock(async () => runRef()),
      streamRun,
      getRun,
    } as unknown as AgentProviderClient;

    await expect(runProviderRequest(client, request)).rejects.toThrow(
      "fatal misconfiguration",
    );
    expect(streamRun).toHaveBeenCalledTimes(1);
    expect(getRun).not.toHaveBeenCalled();
  });
});
