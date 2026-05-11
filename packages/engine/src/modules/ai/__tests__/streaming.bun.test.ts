import { describe, expect, it, mock } from "bun:test";

const openclawCallMock = mock(() => Promise.resolve('{"unexpected":true}'));
const executeFeatureStreamMock = mock(async function* () {
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
      providerClient: { stream: executeFeatureStreamMock } as unknown as EngineAiClient["providerClient"],
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
});
