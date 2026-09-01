/**
 * Live Claude Code provider tests — real `claude` binary + mocked LLM.
 *
 * These tests keep SDK lifecycle coverage while exercising only request-
 * declared, provider-neutral tool contracts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { terminalSnapshotFromEvents } from "@chrona/providers-foundation";
import type { ProviderToolDefinition } from "@chrona/providers-foundation";

import {
  claudeBinaryAvailable,
  collect,
  extractToolResultText,
  makeLiveClient,
  startMockLlm,
  type LiveClient,
  type MockLlm,
} from "./__live__/aimock-live";

const RUN_LIVE_CLAUDE_TESTS = process.env.CHRONA_RUN_LIVE_CLAUDE_TESTS === "1";
const HAS_CLAUDE = RUN_LIVE_CLAUDE_TESTS && claudeBinaryAvailable();
const TEST_TIMEOUT_MS = 90_000;
const fixtureTools: ProviderToolDefinition[] = [{
  name: "fixture_echo",
  description: "Echo a supplied string.",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
}];

describe.skipIf(!HAS_CLAUDE)("ClaudeCodeProviderClient — live SDK", () => {
  let llm: MockLlm;
  let live: LiveClient | undefined;

  beforeEach(async () => {
    llm = await startMockLlm();
  });

  afterEach(async () => {
    live?.cleanup();
    live = undefined;
    await llm.stop();
  });

  test("mocked text surfaces as text_delta and run_completed", async () => {
    llm.mock.on({ userMessage: /outline/i }, { content: "Read context, draft, then review." });
    live = await makeLiveClient({ mockUrl: llm.url });

    const events = await collect(live.client.streamRun({
      clientOperationId: "claude-code-live-text",
      sessionId: "live-session-text",
      instructions: "Produce an outline.",
      input: { type: "text", text: "Generate an outline." },
    }));

    expect(events[0]?.type).toBe("run_started");
    expect(events.at(-1)?.type).toBe("run_completed");
    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text)
      .join("");
    expect(text).toContain("Read context");
    expect(terminalSnapshotFromEvents(events)?.status).toBe("completed");
  }, TEST_TIMEOUT_MS);

  test("request-declared tool call and normalized result flow through the SDK", async () => {
    llm.mock.on({ turnIndex: 0 }, {
      toolCalls: [{ name: "mcp__run_tools__fixture_echo", arguments: { value: "protocol payload" } }],
    });
    llm.mock.on({ turnIndex: 1 }, { content: "Fixture tool completed." });
    live = await makeLiveClient({ mockUrl: llm.url });

    const events = await collect(live.client.streamRun({
      clientOperationId: "claude-code-live-tool-roundtrip",
      sessionId: "live-session-tool",
      instructions: "Call fixture_echo with the supplied value.",
      input: { type: "text", text: "Echo protocol payload." },
      tools: fixtureTools,
      terminalToolName: "fixture_echo",
    }));

    const runStarted = events.find((event) => event.type === "run_started");
    expect(runStarted?.type).toBe("run_started");
    if (runStarted?.type === "run_started") {
      for (const event of events) {
        expect(event).toMatchObject({
          provider: runStarted.run.provider,
          runId: runStarted.run.runId,
          sessionId: runStarted.run.sessionId,
        });
      }
    }
    expect(events.map((event) => event.type)).toContain("tool_call");
    const call = events.find((event) => event.type === "tool_call");
    expect(call).toMatchObject({ tool: "mcp__run_tools__fixture_echo", input: { value: "protocol payload" } });
    const result = events.find((event) => event.type === "tool_result");
    expect(result).toMatchObject({ tool: "mcp__run_tools__fixture_echo" });
    if (result?.type === "tool_result") {
      expect(JSON.parse(extractToolResultText(result.result))).toMatchObject({ ok: true, tool: "fixture_echo" });
    }
    expect(events.at(-1)?.type).toBe("run_completed");
  }, TEST_TIMEOUT_MS);

  test("startRun and getRun maintain a terminal snapshot", async () => {
    llm.mock.on({ userMessage: /.*/ }, { content: "ack" });
    live = await makeLiveClient({ mockUrl: llm.url });

    const events = await collect(live.client.streamRun({
      clientOperationId: "claude-code-live-roundtrip",
      sessionId: "live-session-roundtrip",
      instructions: "Acknowledge.",
      input: { type: "text", text: "ping" },
    }));

    expect(events.at(-1)?.type).toBe("run_completed");
    expect(live.client.getCapabilities().supportsToolCalls).toBe(true);
  }, TEST_TIMEOUT_MS);
});
