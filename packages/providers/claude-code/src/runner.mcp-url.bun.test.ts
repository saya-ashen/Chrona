/**
 * Claude Code MCP URL regression.
 *
 * This is provider-specific: Claude Code registers Chrona as an SDK MCP
 * server URL, unlike Hermes which receives the session id in its run payload
 * and calls Chrona MCP directly from the mock/server side.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

import type { StartRunInput } from "@chrona/providers-foundation";

let capturedOptions: Record<string, unknown> | null = null;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock((input: { options?: Record<string, unknown> }) => {
    capturedOptions = input.options ?? null;
    return Object.assign((async function* () {})(), { interrupt: async () => {} });
  }),
}));

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedOptions = null;
  mock.restore();
});

function stubMcpProbe() {
  let call = 0;
  globalThis.fetch = mock(async () => {
    call += 1;
    if (call === 1) {
      return new Response("", { status: 200, headers: { "mcp-session-id": "probe-session" } });
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "chrona_plan_generate" }] } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

describe("Claude Code MCP URL session identity", () => {
  test("uses Chrona sessionKey for MCP authorization instead of provider sessionId", async () => {
    stubMcpProbe();
    const { createClaudeCodeRunner } = await import("./runner");
    const runner = await createClaudeCodeRunner({
      mcpBaseUrl: "http://mcp.test/",
      mcpRunToken: "",
    });

    const input = {
      sessionId: "ai-generate_plan-chrona-task-task-1-plan-gener-20260624-deadbeef",
      sessionKey: "chrona:task:task-1:plan-generation",
      instructions: "Generate a Chrona task plan.",
      input: { type: "text", text: "Plan task-1." },
    } satisfies StartRunInput;

    await runner.start(input);

    const mcpServers = capturedOptions?.["mcpServers"] as
      | { chrona?: { url?: string } }
      | undefined;
    expect(mcpServers?.chrona?.url).toBe(
      "http://mcp.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aplan-generation",
    );
    expect(mcpServers?.chrona?.url).not.toContain(input.sessionId);
  });
});
