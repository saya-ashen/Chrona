import { describe, expect, it, mock } from "bun:test";

const providerCallMock = mock(() => Promise.resolve('{"unexpected":true}'));
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
  providerCall: providerCallMock,
}));

mock.module("../../../../../../features/ai-clients", () => ({
  aiClientRegistry: {
    requireProviderClient: (client: EngineAiClient) => client,
  },
}));

import { generatePlanStream } from "../features/generate-plan";
import { dispatchStream } from "../streaming";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type { EngineAiClient } from "../../../../../../features/ai-clients";

describe("generatePlanStream", () => {
  it("does not fall back to blocking provider calls when streaming generate_plan fails", async () => {
    providerCallMock.mockClear();
    executeFeatureStreamMock.mockClear();

    const createSessionMock = mock(() => Promise.resolve({
      provider: "hermes",
      sessionId: "session-1",
    }));
    const startRunMock = mock(() => Promise.resolve({
      provider: "hermes",
      runId: "run-1",
      sessionId: "session-1",
    }));

    const client = {
      record: {
        id: "client-1",
        name: "Agent Provider",
        type: "agent-provider",
        config: {
          baseUrl: "http://provider.local",
        },
        isDefault: true,
        enabled: true,
      },
      providerClient: {
        createSession: createSessionMock,
        startRun: startRunMock,
        streamRun: executeFeatureStreamMock,
      } as unknown as EngineAiClient["providerClient"],
    } as EngineAiClient;

    const events = [] as Array<{ type: string; message?: string }>;
    for await (const event of generatePlanStream(client, { title: "Build plan" })) {
      events.push(event as { type: string; message?: string });
    }

    expect(executeFeatureStreamMock).toHaveBeenCalledTimes(1);
    expect(providerCallMock).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "stream exploded",
    });
  });

  it("adds Codex discovery guidance only for Codex plan streams", async () => {
    async function collectStartInput(type: string) {
      let startInput = {} as { instructions?: string; terminalToolName?: string };
      const startRunMock = mock((input: { instructions?: string; terminalToolName?: string }) => {
        startInput = input;
        return Promise.resolve({
          provider: type,
          runId: `run-${type}`,
          sessionId: `session-${type}`,
        });
      });
      const streamRunMock = mock(async function* () {
        yield { type: "run_completed" as const, outputText: "" };
      });
      const client = {
        record: {
          id: `client-${type}`,
          name: type,
          type,
          config: { baseUrl: "" },
          isDefault: true,
          enabled: true,
        },
        providerClient: {
          provider: type,
          startRun: startRunMock,
          streamRun: streamRunMock,
        },
      } as unknown as EngineAiClient;

      for await (const _event of generatePlanStream(client, { title: "Build plan" })) {
        // drain stream
      }

      return startInput;
    }

    const codexStart = await collectStartInput("codex");
    const claudeStart = await collectStartInput("claude_code");
    expect(codexStart.instructions).toContain("first call tool_search");
    expect(codexStart.terminalToolName).toBe("chrona_plan_generate");
    expect(claudeStart.instructions).not.toContain("tool_search");
    expect(claudeStart.terminalToolName).toBe("chrona_plan_generate");
  });

  it("streams provider clients through startRun and run event stream", async () => {
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

    
    const events = [] as Array<{ type: string; text?: string; structured?: unknown; tool?: string; input?: Record<string, unknown> }>;
    for await (const event of dispatchStream(client, "generate_plan", {
      scope: "task-1",
      instructions: "Generate plan",
      inputText: "Build plan",
      input: { title: "Build plan" },
      featureSpec: {
        feature: "generate_plan",
        instructions: "Generate plan",
        inputText: "Build plan",
        structuredOutputSchema: {
          name: "ignored_schema",
          description: "Should not be sent to Hermes.",
          schema: { type: "object" },
        },
      } as never,
      userMessage: "Build plan",
    })) {
      if (event.type !== "status") {
        events.push(event as { type: string; text?: string; structured?: unknown; tool?: string; input?: Record<string, unknown> });
      }
    }

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(startRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.stringMatching(/^ai-generate_plan-task-1-/) }),
    );
    expect(startRunMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ structuredOutputSchema: expect.anything() }),
    );
    expect(streamRunMock).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(streamRunMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ structuredOutputSchema: expect.anything() }),
    );
    expect(events).toEqual([
      { type: "partial", text: "hello" },
      { type: "done", text: "hello", structured: null },
    ]);
  });

  it("keeps Hermes preview-only tool events in the stream", async () => {
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
      yield { type: "tool_started" as const, toolName: "skill_view", preview: "writing-plans" };
      yield { type: "tool_completed" as const, toolName: "skill_view" };
    });

    const client = {
      record: {
        id: "client-3",
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
    const events = [] as Array<{ type: string; tool?: string; input?: Record<string, unknown>; result?: string; error?: boolean; text?: string; structured?: unknown }>;
    for await (const event of dispatchStream(client, "generate_plan", {
      scope: "task-1",
      instructions: "Generate plan",
      inputText: "Build plan",
      input: { title: "Build plan" },
      userMessage: "Build plan",
    })) {
      if (event.type !== "status") {
        events.push(event as { type: string; tool?: string; input?: Record<string, unknown>; result?: string; error?: boolean; text?: string; structured?: unknown });
      }
    }

    expect(events).toEqual([
      { type: "tool_call", tool: "skill_view", input: { preview: "writing-plans" } },
      { type: "tool_result", tool: "skill_view", result: "completed", error: false },
      { type: "done", text: "", structured: null },
    ]);
  });

  it("cancels the provider run when the caller aborts an active generate_plan stream", async () => {
    const controller = new AbortController();
    const cancelRunMock = mock(async () => ({
      provider: "hermes",
      runId: "run-1",
      sessionId: "session-1",
      status: "cancelled" as const,
    }));
    const streamRunMock = mock(async function* () {
      yield { type: "text_delta" as const, text: "still running" };
      yield { type: "text_delta" as const, text: "late event" };
    });
    const providerClient: Partial<AgentProviderClient> = {
      provider: "hermes",
      startRun: mock(async () => ({
        provider: "hermes",
        runId: "run-1",
        sessionId: "session-1",
        status: "running" as const,
      })),
      streamRun: streamRunMock,
      cancelRun: cancelRunMock,
    };
    const client = {
      record: {
        id: "client-4",
        name: "Hermes",
        type: "hermes",
        config: { baseUrl: "" },
        isDefault: true,
        enabled: true,
      },
      providerClient,
    } as EngineAiClient;

    const events = [] as Array<{ type: string; text?: string }>;
    for await (const event of dispatchStream(client, "generate_plan", {
      scope: "task-1",
      instructions: "Generate plan",
      inputText: "Build plan",
      input: { title: "Build plan" },
      userMessage: "Build plan",
      signal: controller.signal,
    })) {
      events.push(event as { type: string; text?: string });
      if (event.type === "partial") controller.abort();
    }

    expect(events).toContainEqual({ type: "partial", text: "still running" });
    expect(events).not.toContainEqual({ type: "partial", text: "late event" });
    expect(cancelRunMock).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", sessionId: "session-1" }));
  });
});
