/**
 * Guarded live SDK reproducer for Claude Code + fake LLM + MCP tool submit.
 *
 * Default CI must not spawn a real Claude Code subprocess. Run explicitly with:
 *
 *   CHRONA_CLAUDE_CODE_SDK_AIMOCK_TEST=1 \
 *   CHRONA_LOG_LEVEL=debug \
 *   CHRONA_CLAUDE_DEBUG_DIR=.tmp/claude-debug \
 *   bun test packages/providers/claude-code/src/ClaudeCodeProviderClient.aimock.bun.test.ts
 */

import { describe, expect, test } from "bun:test";
import { LLMock } from "@copilotkit/aimock";
import { createMcpTestServer } from "./mcp-test-server";
import { ClaudeCodeProviderClient } from "./ClaudeCodeProviderClient";

const liveTest = process.env.CHRONA_CLAUDE_CODE_SDK_AIMOCK_TEST === "1" ? test : test.skip;

function debugAimockOutput(label: string, value: unknown) {
  if (process.env.CHRONA_CLAUDE_AIMOCK_DEBUG_OUTPUT !== "1") return;
  console.info(label, JSON.stringify(value, null, 2));
}


describe("ClaudeCodeProviderClient — aimock SDK submit-plan-output repro", () => {
  liveTest("fake LLM can drive chrona_plan_output then chrona_node_complete through the real SDK", async () => {
    const llm = new LLMock({ port: 0, strict: true });
    const toolCalls: Array<{ name: string }> = [];
    const mcpServer = Bun.serve({
      port: 0,
      fetch: createMcpTestServer({ onToolCall: (call) => { toolCalls.push(call); } }),
    });

    llm.on(
      { userMessage: "Submit test output through the SDK.", turnIndex: 0 },
      {
        content: "Submitting plan output now.",
        toolCalls: [
          {
            id: "toolu_node_output",
            name: "mcp__chrona__chrona_plan_output",
            arguments: JSON.stringify({ providerTestPayload: "tiny output" }),
          },
        ],
      },
    );
    llm.on(
      { hasToolResult: true, toolCallId: "toolu_node_output", turnIndex: 1 },
      {
        content: "Output accepted. Completing node.",
        toolCalls: [
          {
            id: "toolu_node_complete",
            name: "mcp__chrona__chrona_node_complete",
            arguments: JSON.stringify({ summary: "Done" }),
          },
        ],
      },
    );
    llm.on(
      { hasToolResult: true, toolCallId: "toolu_node_complete", turnIndex: 2 },
      { content: "Done." },
    );

    const mcpUrl = `http://127.0.0.1:${mcpServer.port}`;
    await llm.start();
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_BASE_URL = llm.url;
    process.env.ANTHROPIC_API_KEY = "aimock";
    process.env.ANTHROPIC_AUTH_TOKEN = "aimock";

    try {
      const client = new ClaudeCodeProviderClient({
        config: {
          mcpBaseUrl: mcpUrl,
          mcpRunToken: "aimock-token",
          model: "claude-3-5-sonnet-20241022",
          timeoutMs: 45_000,
          env: {
            ...process.env,
            ANTHROPIC_BASE_URL: llm.url,
            ANTHROPIC_API_KEY: "aimock",
            ANTHROPIC_AUTH_TOKEN: "aimock",
            CLAUDE_CODE_DEBUG_LOG_LEVEL: "debug",
            CLAUDE_CODE_DEBUG_LOGS_DIR: process.env.CHRONA_CLAUDE_DEBUG_DIR ?? ".tmp/claude-debug/sdk",
          },
          sdkOptions: {
            settingSources: [],
            strictMcpConfig: true,
            settings: { disableAllHooks: true },
            persistSession: false,
            debug: true,
          },
        },
      });

      const ref = await client.startRun({
        sessionId: "chrona-session-aimock-submit:execute",
        instructions: "Call chrona_plan_output, then call chrona_node_complete.",
        input: { type: "text", text: "Submit test output through the SDK." },
      });
      const events = [];
      for await (const event of client.streamRun({ runId: ref.runId })) {
        events.push(event);
      }

      debugAimockOutput("aimock requests", llm.getRequests());
      debugAimockOutput("mcp tool calls", toolCalls);
      debugAimockOutput("provider events", events);

      expect(events.some((event) => event.type === "tool_call" && event.tool === "mcp__chrona__chrona_plan_output")).toBe(true);
      expect(events.some((event) => event.type === "tool_result" && event.tool === "mcp__chrona__chrona_plan_output")).toBe(true);
      expect(events.at(-1)?.type).toBe("run_completed");
      expect(toolCalls.map((call) => call.name)).toEqual(["chrona_plan_output", "chrona_node_complete"]);
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
      if (previousAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousAuthToken;
      await llm.stop();
      mcpServer.stop(true);
    }
  }, 60_000);

  liveTest("fake LLM stream abort after chrona_plan_output is reported as SDK terminal-result failure", async () => {
    const llm = new LLMock({ port: 0, strict: true });
    const toolCalls: Array<{ name: string }> = [];
    const mcpServer = Bun.serve({
      port: 0,
      fetch: createMcpTestServer({ onToolCall: (call) => { toolCalls.push(call); } }),
    });

    llm.on(
      { userMessage: "Submit test output then lose the model stream.", turnIndex: 0 },
      {
        content: "Submitting plan output now.",
        toolCalls: [
          {
            id: "toolu_abort_node_output",
            name: "mcp__chrona__chrona_plan_output",
            arguments: JSON.stringify({ providerTestPayload: "tiny output" }),
          },
        ],
      },
    );
    llm.on(
      { hasToolResult: true, toolCallId: "toolu_abort_node_output", turnIndex: 1 },
      { content: "This response disconnects before the SDK can return a terminal result." },
      { truncateAfterChunks: 1 },
    );

    const mcpUrl = `http://127.0.0.1:${mcpServer.port}`;
    await llm.start();
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_BASE_URL = llm.url;
    process.env.ANTHROPIC_API_KEY = "aimock";
    process.env.ANTHROPIC_AUTH_TOKEN = "aimock";

    try {
      const client = new ClaudeCodeProviderClient({
        config: {
          mcpBaseUrl: mcpUrl,
          mcpRunToken: "aimock-token",
          timeoutMs: 10_000,
          env: {
            ...process.env,
            ANTHROPIC_BASE_URL: llm.url,
            ANTHROPIC_API_KEY: "aimock",
            ANTHROPIC_AUTH_TOKEN: "aimock",
            CLAUDE_CODE_DEBUG_LOG_LEVEL: "debug",
            CLAUDE_CODE_DEBUG_LOGS_DIR: process.env.CHRONA_CLAUDE_DEBUG_DIR ?? ".tmp/claude-debug/sdk",
          },
          sdkOptions: {
            settingSources: [],
            strictMcpConfig: true,
            settings: { disableAllHooks: true },
            persistSession: false,
            debug: true,
          },
        },
      });

      const ref = await client.startRun({
        sessionId: "chrona-session-aimock-abort:execute",
        instructions: "Call chrona_plan_output, then continue so the model stream aborts before completion.",
        input: { type: "text", text: "Submit test output then lose the model stream." },
      });
      const events = [];
      for await (const event of client.streamRun({ runId: ref.runId })) {
        events.push(event);
      }

      debugAimockOutput("abort aimock requests", llm.getRequests());
      debugAimockOutput("abort mcp tool calls", toolCalls);
      debugAimockOutput("abort provider events", events);

      expect(toolCalls.map((call) => call.name)).toEqual(["chrona_plan_output"]);
      expect(events.some((event) => event.type === "tool_result" && event.tool === "mcp__chrona__chrona_plan_output")).toBe(true);
      const terminalEvent = events.at(-1);
      expect(terminalEvent?.type).toBe("run_failed");
      if (terminalEvent?.type !== "run_failed") throw new Error("Expected run_failed terminal event");
      expect(terminalEvent.error).toBe("Claude Code process aborted after plan output was accepted but before node completion");
      expect(terminalEvent.raw).toMatchObject({ stage: "after_plan_output_accepted", lastTool: "mcp__chrona__chrona_plan_output" });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
      if (previousAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousAuthToken;
      await llm.stop();
      mcpServer.stop(true);
    }
  }, 60_000);
});
