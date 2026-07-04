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
let capturedPrompt: unknown = null;
let nextQueryMessages: unknown[] = [];
let nextQueryError: unknown = null;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock((input: { prompt?: unknown; options?: Record<string, unknown> }) => {
    capturedPrompt = input.prompt;
    capturedOptions = input.options ?? null;
    return Object.assign((async function* () {
      if (nextQueryError) throw nextQueryError;
      for (const message of nextQueryMessages) yield message;
    })(), { close: mock(() => {}), interrupt: async () => {} });
  }),
  startup: mock(async () => ({ close: () => {} })),
}));

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedOptions = null;
  capturedPrompt = null;
  nextQueryMessages = [];
  nextQueryError = null;
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

describe("Claude Code health probe", () => {
  test("runs a tool-free one-turn SDK query", async () => {
    nextQueryMessages = [{ type: "result", subtype: "success", is_error: false }];
    // Test must import after mock.module so runner binds mocked SDK query.
    const { probeClaudeCodeSdk } = await import("./runner");

    await expect(probeClaudeCodeSdk({
      config: {
        model: "claude-test-model",
        env: { ANTHROPIC_API_KEY: "sk-test" },
        cwd: "/tmp/chrona-health",
        mcpBaseUrl: "http://mcp.test",
        mcpRunToken: "",
      },
      timeoutMs: 1000,
    })).resolves.toBeNull();

    expect(capturedPrompt).toContain("chrona-ok");
    expect(capturedOptions).toMatchObject({
      model: "claude-test-model",
      cwd: "/tmp/chrona-health",
      tools: [],
      maxTurns: 1,
      permissionMode: "dontAsk",
    });
    expect((capturedOptions?.env as Record<string, string>).ANTHROPIC_API_KEY).toBe("sk-test");
  });

  test("reports SDK result errors as failed connectivity", async () => {
    nextQueryMessages = [{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["invalid auth"] }];
    // Test must import after mock.module so runner binds mocked SDK query.
    const { probeClaudeCodeSdk } = await import("./runner");

    await expect(probeClaudeCodeSdk({ config: { mcpBaseUrl: "http://mcp.test", mcpRunToken: "" }, timeoutMs: 1000 })).resolves.toContain("invalid auth");
  });
});
