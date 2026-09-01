/**
 * Supplementary live SDK coverage using provider-neutral request tools.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

describe.skipIf(!HAS_CLAUDE)("ClaudeCodeProviderClient — live provider protocol", () => {
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

  test("normalizes generic tool calls and result call ids", async () => {
    llm.mock.on({ turnIndex: 0 }, {
      toolCalls: [{ name: "mcp__run_tools__fixture_echo", arguments: { value: "payload" } }],
    });
    llm.mock.on({ turnIndex: 1 }, { content: "Acknowledged." });
    live = await makeLiveClient({ mockUrl: llm.url });

    const events = await collect(live.client.streamRun({
      clientOperationId: "claude-code-live-generic-tool",
      sessionId: "live-session-generic-tool",
      instructions: "Call the fixture echo tool.",
      input: { type: "text", text: "Send payload." },
      tools: fixtureTools,
      terminalToolName: "fixture_echo",
    }));

    const call = events.find((event) => event.type === "tool_call");
    const result = events.find((event) => event.type === "tool_result");
    expect(call).toMatchObject({ tool: "mcp__run_tools__fixture_echo", input: { value: "payload" } });
    expect(result).toMatchObject({ tool: "mcp__run_tools__fixture_echo" });
    if (call?.type === "tool_call" && result?.type === "tool_result") {
      expect(result.callId).toBe(call.callId);
      expect(JSON.parse(extractToolResultText(result.result))).toMatchObject({ ok: true, tool: "fixture_echo" });
    }
    expect(events.at(-1)?.type).toBe("run_completed");
  }, TEST_TIMEOUT_MS);

  test("surfaces mocked LLM API errors as provider events", async () => {
    llm.mock.on({ userMessage: /.*/ }, {
      error: { type: "invalid_request_error", message: "invalid fixture request" },
    });
    live = await makeLiveClient({ mockUrl: llm.url, timeoutMs: 5_000 });

    const events = await collect(live.client.streamRun({
      clientOperationId: "claude-code-live-api-error",
      sessionId: "live-session-api-error",
      instructions: "Trigger the mocked request error.",
      input: { type: "text", text: "error" },
    }));

    expect(events.at(-1)).toMatchObject({ type: "run_failed" });
  }, TEST_TIMEOUT_MS);

  test("reports a healthy SDK connection", async () => {
    live = await makeLiveClient({ mockUrl: llm.url });
    const health = await live.client.checkHealth();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe("claude_code");
  }, TEST_TIMEOUT_MS);
});