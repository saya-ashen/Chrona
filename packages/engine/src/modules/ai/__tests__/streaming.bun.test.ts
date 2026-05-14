import { describe, expect, it, mock } from "bun:test";

const openclawCallMock = mock(() => Promise.resolve('{"unexpected":true}'));
const executeFeatureStreamMock = mock(async function* () {
  yield* [];
  throw new Error("stream exploded");
});

mock.module("../providers", () => ({
  buildPreparedFeatureRequest: (input: unknown) => {
    const inputObj =
      typeof input === "string" ? { input } : (input as Record<string, unknown>);
    const inputText =
      typeof input === "string"
        ? input
        : typeof inputObj.title === "string"
          ? inputObj.title
          : JSON.stringify(inputObj);

    return {
      input: inputObj,
      instructions: inputText,
      inputText,
    };
  },
  openclawCall: openclawCallMock,
}));

mock.module("../runtime/client-registry", () => ({
  aiClientRegistry: {
    requireOpenClawClient: (client: EngineAiClient) => client,
  },
}));

import { generatePlanStream } from "../features/generate-plan";
import type { EngineAiClient } from "../runtime/client-registry";

describe("generatePlanStream", () => {
  it("does not fall back to blocking OpenClaw calls when streaming generate_plan fails", async () => {
    openclawCallMock.mockClear();
    executeFeatureStreamMock.mockClear();

    const client = {
      record: {
        id: "client-1",
        name: "OpenClaw",
        type: "openclaw",
        config: {
          gatewayUrl: "http://gateway.local",
          bridgeUrl: "http://gateway.local",
          bridgeToken: "",
        },
        isDefault: true,
        enabled: true,
      },
      providerClient: { streamRun: executeFeatureStreamMock } as unknown as EngineAiClient["providerClient"],
    } as EngineAiClient;

    const events = [] as Array<{ type: string; message?: string }>;
    for await (const event of generatePlanStream(client, { title: "Build plan" })) {
      events.push(event as { type: string; message?: string });
    }

    expect(executeFeatureStreamMock).toHaveBeenCalledTimes(1);
    expect(openclawCallMock).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "stream exploded",
    });
  });

  it("streams non-OpenClaw provider clients through startRun and run event stream", async () => {
    const createSessionMock = mock(() => Promise.resolve({
      provider: "hermes",
      sessionId: "session-1",
    }));
    const startRunMock = mock(() => Promise.resolve({
      provider: "hermes",
      runId: "run-1",
      sessionId: "session-1",
    }));
    const streamRunMock = mock(async function* () {
      yield { type: "text_delta", text: "hello" };
      yield {
        type: "run_completed",
        run: {
          provider: "hermes",
          runId: "run-1",
          sessionId: "session-1",
          status: "completed",
        },
        outputText: "hello",
      };
    });

    const client = {
      record: {
        id: "client-2",
        name: "Hermes",
        type: "hermes",
        config: { baseUrl: "" },
        isDefault: true,
        enabled: true,
      },
      providerClient: {
        provider: "hermes",
        createSession: createSessionMock,
        startRun: startRunMock,
        streamRun: streamRunMock,
      },
    } as unknown as EngineAiClient;

    const { dispatchStream } = await import("../streaming");
    const events = [] as Array<{ type: string; text?: string; structured?: unknown }>;
    for await (const event of dispatchStream(client, "generate_plan", {
      scope: "task-1",
      instructions: "Generate plan",
      inputText: "Build plan",
      input: { title: "Build plan" },
      userMessage: "Build plan",
    })) {
      events.push(event as { type: string; text?: string; structured?: unknown });
    }

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(streamRunMock).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(events).toEqual([
      { type: "partial", text: "hello" },
      { type: "done", text: "hello", structured: null },
    ]);
  });
});
