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
  getOrCreateClient: () => ({
    executeFeatureStream: executeFeatureStreamMock,
  }),
}));

import { generatePlanStream } from "../streaming";
import type { AiClientRecord } from "@chrona/contracts";

describe("generatePlanStream", () => {
  it("does not fall back to blocking OpenClaw calls when streaming generate_plan fails", async () => {
    openclawCallMock.mockClear();
    executeFeatureStreamMock.mockClear();

    const client = {
      type: "openclaw",
      config: {
        gatewayUrl: "http://gateway.local",
      },
      enabled: true,
    } as AiClientRecord;

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
