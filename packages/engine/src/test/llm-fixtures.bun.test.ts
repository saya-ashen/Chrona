import { describe, expect, test } from "bun:test";
import { readProviderResponseFixture } from "./llm-fixture-recorder";

describe("LLM fixture replay", () => {
  test("fixture reader validates cassette shape", async () => {
    const fixture = await readProviderResponseFixture("packages/engine/src/test/llm-fixtures/debug/chat/valid-small-chat.json");

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.provider).toBe("debug");
    expect(fixture.feature).toBe("chat");
    expect(fixture.request.inputHash.startsWith("sha256:")).toBe(true);
    expect(fixture.response.provider).toBe("debug");
    expect(fixture.response.status).toBe("completed");
    expect(fixture.response.outputText).toBe("Use deterministic fixtures for routine tests.");
  });

  test("fixture contains only provider snapshot replay fields", async () => {
    const fixture = await readProviderResponseFixture("packages/engine/src/test/llm-fixtures/debug/chat/valid-small-chat.json");

    expect(fixture.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.request.redactedInput).toEqual({
      input: { message: "Summarize a deterministic test task" },
      instructions: "Feature: chat",
      sessionKey: "debug-chat-fixture",
      stream: false,
    });
    expect(fixture.response).toEqual({
      error: null,
      outputText: "Use deterministic fixtures for routine tests.",
      provider: "debug",
      runId: "debug-chat-fixture-run",
      sessionId: "debug-chat-fixture",
      status: "completed",
      structuredPayload: null,
    });
    expect(JSON.stringify(fixture)).not.toContain("Authorization");
    expect(JSON.stringify(fixture)).not.toContain("apiKey");
  });
});
