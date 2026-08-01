import { describe, expect, test } from "bun:test";
import type { AiClientRecord } from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";
import type { AgentProviderClient, ProviderRunEvent, ProviderRunSnapshot } from "@chrona/providers-foundation";
import type { EngineAiClient } from "@chrona/engine/test-support";
import { dispatchFeaturePayload, dispatchPreparedFeaturePayload } from "../index";

process.env.DATABASE_URL ??= "file:/tmp/chrona-provider-response-parsing.sqlite";

function providerSnapshot(overrides: Partial<ProviderRunSnapshot> = {}): ProviderRunSnapshot {
  return {
    provider: "debug",
    runId: "run-1",
    sessionId: "session-1",
    status: "completed",
    outputText: "raw output",
    structuredPayload: { parsed: { answer: "ok" }, rawOutput: "raw output", feature: "chat", runId: "run-1" },
    error: null,
    ...overrides,
  };
}

function client(snapshot: ProviderRunSnapshot): EngineAiClient {
  const providerClient: AgentProviderClient = {
    provider: "debug",
    getCapabilities: async () => ({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      actionInvocation: "unsupported" as const,
      startIdempotency: "unsupported" as const,
      lookupByClientOperationId: false,
    }),
    checkHealth: async () => ({ ok: true, provider: "debug", checkedAt: new Date(0).toISOString() }),
    createSession: async () => ({ provider: "debug", sessionId: "session-1" }),
    startRun: async () => ({ provider: "debug", runId: "run-1", sessionId: "session-1" }),
    streamRun: async function* (): AsyncIterable<ProviderRunEvent> {
      const eventIdentity = {
        provider: "debug",
        runId: snapshot.runId,
        sessionId: snapshot.sessionId ?? "session-1",
      };
      if (snapshot.error) {
        yield {
          ...eventIdentity,
          sequence: 0,
          type: "run_failed",
          run: { ...eventIdentity, status: "failed" },
          error: snapshot.error,
        };
        return;
      }
      yield {
        ...eventIdentity,
        sequence: 0,
        type: "run_completed",
        run: { ...eventIdentity, status: snapshot.status },
        outputText: snapshot.outputText,
        structuredPayload: snapshot.structuredPayload,
        raw: snapshot.raw,
      };
    },
    getRun: async () => snapshot,
    cancelRun: async () => ({ provider: "debug", runId: "run-1", sessionId: "session-1", status: "cancelled" }),
  };

  return {
    record: {
      id: "debug",
      name: "Debug",
      type: "debug",
      config: {},
      enabled: true,
      isDefault: true,
    } satisfies AiClientRecord,
    providerClient,
  };
}

function clientWithStreamFailure(error: Error): EngineAiClient {
  const providerClient: AgentProviderClient = {
    provider: "debug",
    getCapabilities: async () => ({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      actionInvocation: "unsupported" as const,
      startIdempotency: "unsupported" as const,
      lookupByClientOperationId: false,
    }),
    checkHealth: async () => ({ ok: true, provider: "debug", checkedAt: new Date(0).toISOString() }),
    createSession: async () => ({ provider: "debug", sessionId: "session-1" }),
    startRun: async () => ({ provider: "debug", runId: "run-1", sessionId: "session-1" }),
    streamRun: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw error;
          },
        };
      },
    }),
    getRun: async () => providerSnapshot(),
    cancelRun: async () => ({ provider: "debug", runId: "run-1", sessionId: "session-1", status: "cancelled" }),
  };

  return {
    record: {
      id: "debug",
      name: "Debug",
      type: "debug",
      config: {},
      enabled: true,
      isDefault: true,
    } satisfies AiClientRecord,
    providerClient,
  };
}

describe("provider response parsing", () => {
  test("returns parsed structured payload and debug metadata", async () => {
    const result = await dispatchFeaturePayload<{ answer: string }>(client(providerSnapshot()), "chat", { prompt: "hello" }, "scope-1");

    expect(result.parsed).toEqual({ answer: "ok" });
    expect(result.rawText).toBe("raw output");
    expect(result.debug).toMatchObject({ feature: "chat", runId: "run-1", rawOutput: "raw output" });
  });

  test("accepts direct structured objects", async () => {
    const result = await dispatchFeaturePayload<{ answer: string }>(
      client(providerSnapshot({ structuredPayload: { answer: "direct" } })),
      "chat",
      {},
      "scope-1",
    );

    expect(result.parsed).toEqual({ answer: "direct" });
  });

  test("falls back to fenced JSON output when no structured payload is present", async () => {
    const result = await dispatchFeaturePayload<{ answer: string }>(
      client(providerSnapshot({ structuredPayload: null, outputText: "```json\n{\"answer\":\"fenced\"}\n```" })),
      "chat",
      {},
      "scope-1",
    );

    expect(result.parsed).toEqual({ answer: "fenced" });
  });

  test("falls back to terminal tool input before output text", async () => {
    const result = await dispatchFeaturePayload<{ answer: string }>(
      client(providerSnapshot({
        structuredPayload: null,
        outputText: "not JSON",
        raw: { terminalTool: { input: { answer: "tool" } } },
      })),
      "chat",
      {},
      "scope-1",
    );

    expect(result.parsed).toEqual({ answer: "tool" });
  });

  test("rejects provider responses after all parsed payload fallbacks fail", async () => {
    await expect(dispatchFeaturePayload(client(providerSnapshot({ structuredPayload: null, outputText: "text only" })), "chat", {}, "scope-1"))
      .rejects.toMatchObject({ code: "invalid_response", message: "[debug] Feature 'chat' did not return a parsed payload" } satisfies Partial<AiClientError>);
  });

  test("retains prepared feature validation errors for schema-invalid payloads", async () => {
    await expect(dispatchPreparedFeaturePayload(
      client(providerSnapshot({ structuredPayload: { parsed: { suggestions: [{}] } } })),
      {
        feature: "suggest",
        instructions: "Return suggestions",
        structuredOutputSchema: {
          name: "suggestions",
          description: "Suggestions",
          schema: {},
        },
      },
      "scope-1",
    )).rejects.toMatchObject({
      code: "invalid_response",
      message: "[debug] Feature 'suggest' suggestions must include a non-empty title",
    } satisfies Partial<AiClientError>);
  });

  test("rejects provider error snapshots before parsing", async () => {
    await expect(dispatchFeaturePayload(client(providerSnapshot({ error: "provider failed", structuredPayload: null })), "chat", {}, "scope-1"))
      .rejects.toMatchObject({ code: "internal", message: "[debug] provider failed" } satisfies Partial<AiClientError>);
  });

  test("wraps provider stream failures as AiClientError", async () => {
    await expect(dispatchFeaturePayload(clientWithStreamFailure(new Error("provider stream timeout")), "chat", {}, "scope-1"))
      .rejects.toMatchObject({ code: "internal", message: "[debug] provider stream timeout" } satisfies Partial<AiClientError>);
  });
});
