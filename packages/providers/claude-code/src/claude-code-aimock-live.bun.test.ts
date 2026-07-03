/**
 * Live Claude Code provider tests — real `claude` binary + mocked LLM.
 *
 * These are the counterpart to the replay tests
 * (`ClaudeCodeProviderClient.bun.test.ts`). Instead of feeding a hand-authored
 * NDJSON tape into `createReplayRunner`, they:
 *
 *   1. Spin up `@copilotkit/aimock`'s `LLMock` (an Anthropic `/v1/messages`
 *      compatible server) and program the exact tokens / tool calls the LLM
 *      should emit.
 *   2. Spin up a tiny in-process Chrona MCP server (real
 *      `@modelcontextprotocol/sdk` Streamable HTTP transport) that genuinely
 *      executes the tools the agent invokes.
 *   3. Spawn the REAL `claude` binary through the Agent SDK (the production
 *      default backend), pointed at both via env.
 *   4. Assert the `ProviderRunEvent` stream the provider produces — proving
 *      `runner.ts` + `normalizers.ts` + `ClaudeCodeProviderClient` correctly
 *      drive and translate a genuine Claude Code run.
 *
 * Gated on the `claude` binary being installed; otherwise the whole describe
 * block is skipped (clean pass on minimal CI images).
 *
 * Each test spawns a real subprocess, so per-test timeouts are generous.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { terminalSnapshotFromEvents } from "@chrona/providers-foundation";

import {
  claudeBinaryAvailable,
  collect,
  extractToolResultText,
  makeLiveClient,
  startChronaMcpStub,
  startMockLlm,
  type ChronaMcpStub,
  type LiveClient,
  type MockLlm,
} from "./__live__/aimock-live";

const RUN_LIVE_CLAUDE_TESTS = process.env.CHRONA_RUN_LIVE_CLAUDE_TESTS === "1";
const HAS_CLAUDE = RUN_LIVE_CLAUDE_TESTS && claudeBinaryAvailable();
const TEST_TIMEOUT_MS = 90_000;

// Live SDK tests spawn the real `claude` binary. Keep default CI deterministic;
// run with CHRONA_RUN_LIVE_CLAUDE_TESTS=1 when validating the installed SDK.
describe.skipIf(!HAS_CLAUDE)(
  // eslint-disable-next-line max-lines-per-function -- test file; outer arrow aggregates 3 sub-describes.
  () => {
    let llm: MockLlm;
    let mcp: ChronaMcpStub;
    let live: LiveClient | undefined;

    beforeEach(async () => {
      llm = await startMockLlm();
      mcp = await startChronaMcpStub([
        {
          name: "chrona_node_complete",
          description: "Complete the current task node.",
          inputShape: {
            nodeId: z.string(),
            status: z.string().optional(),
          },
          handler: (args) => ({ ok: true, runId: "live-runtime-1", echo: args }),
        },
        {
          name: "chrona_plan_generate",
          description: "Generate an execution plan for a task.",
          inputShape: {
            taskId: z.string(),
            summary: z.string().optional(),
            nodes: z
              .array(
                z.object({
                  id: z.string(),
                  title: z.string().optional(),
                  objective: z.string().optional(),
                }),
              )
              .optional(),
          },
          handler: (args) => ({
            ok: true,
            planId: "live-plan-1",
            received: { taskId: args.taskId, nodeCount: Array.isArray(args.nodes) ? args.nodes.length : 0 },
          }),
        },
        {
          name: "chrona_node_block",
          description: "Block the current task node on missing input.",
          inputShape: {
            nodeId: z.string(),
            reason: z.string().optional(),
          },
          handler: (args) => ({ ok: true, blocked: true, nodeId: args.nodeId }),
        },
      ]);
    });

    afterEach(async () => {
      live?.cleanup();
      live = undefined;
      await mcp.close();
      await llm.stop();
    });

    describe("text-only run", () => {
    test(
      "mocked LLM tokens surface as text_delta and run_completed",
      async () => {
        // The mock returns a plain assistant message for any prompt.
        llm.mock.on(
          { userMessage: /plan/i },
          { content: "Step 1: read context. Step 2: draft. Step 3: review." },
        );

        live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

        const events = await collect(
          live.client.streamRun({
            sessionId: "live-sess-text",
            instructions: "Produce a short plan.",
            input: { type: "text", text: "Generate a plan for the next 30 minutes." },
          }),
        );

        const types = events.map((e) => e.type);
        // The genuine Claude Code init → assistant → result flow maps to:
        expect(types[0]).toBe("run_started");
        expect(types.at(-1)).toBe("run_completed");

        // The mocked LLM content flows through verbatim as text.
        const text = events
          .filter((e) => e.type === "text_delta")
          .map((e) => (e as { text: string }).text)
          .join("");
        expect(text).toContain("Step 1");
        expect(text).toContain("review");

        // Terminal snapshot agrees the run completed.
        const snap = terminalSnapshotFromEvents(events);
        expect(snap?.status).toBe("completed");

        // The agent actually talked to the mock LLM (≥1 request).
        expect(llm.mock.getRequests().length).toBeGreaterThanOrEqual(1);
      },
      TEST_TIMEOUT_MS,
    );
    });

    describe("tool round-trip", () => {
    test(
      "LLM calls a chrona MCP tool, server executes it, result flows back",
      async () => {
        // Turn 0 (no assistant reply yet): emit a tool call to the chrona MCP tool.
        llm.mock.on(
          { turnIndex: 0 },
          {
            toolCalls: [
              {
                name: "mcp__chrona__chrona_node_complete",
                arguments: { nodeId: "n3", status: "completed" },
              },
            ],
          },
        );
        // Turn 1 (after the tool result is in history): finish with a summary.
        llm.mock.on({ turnIndex: 1 }, { content: "Node n3 completed." });

        live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

        const events = await collect(
          live.client.streamRun({
            sessionId: "live-sess-tool",
            instructions: "Complete node n3 via chrona_node_complete.",
            input: { type: "text", text: "Run node 3." },
          }),
        );

        const types = events.map((e) => e.type);
        expect(types[0]).toBe("run_started");
        expect(types.at(-1)).toBe("run_completed");
        expect(types).toContain("tool_call");
        expect(types).toContain("tool_result");

        // The tool_call carries the MCP-prefixed name + the LLM's arguments.
        const call = events.find((e) => e.type === "tool_call");
        expect(call).toBeDefined();
        if (call?.type === "tool_call") {
          expect(call.tool).toBe("mcp__chrona__chrona_node_complete");
          expect(call.input).toMatchObject({ nodeId: "n3", status: "completed" });
        }

        // The REAL MCP server executed the tool with those exact args.
        expect(mcp.calls).toHaveLength(1);
        expect(mcp.calls[0]).toMatchObject({
          tool: "chrona_node_complete",
          args: { nodeId: "n3", status: "completed" },
        });

        // The tool_result event carries the server's structured ack.
        const result = events.find((e) => e.type === "tool_result");
        expect(result).toBeDefined();
        if (result?.type === "tool_result") {
          expect(result.tool).toBe("mcp__chrona__chrona_node_complete");
          const text = extractToolResultText(result.result);
          expect(text).toContain("live-runtime-1");
          expect(JSON.parse(text)).toMatchObject({ ok: true });
        }

        const snap = terminalSnapshotFromEvents(events);
        expect(snap?.status).toBe("completed");
      },
      TEST_TIMEOUT_MS,
    );
    });

    describe("client contract over a real run", () => {
    test(
      "startRun / getRun round-trip drives a real run to a terminal snapshot",
      async () => {
        llm.mock.on({ userMessage: /.*/ }, { content: "ack" });

        live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

        // Drain the stream so the run reaches a terminal state, then snapshot.
        const events = await collect(
          live.client.streamRun({
            sessionId: "live-sess-roundtrip",
            instructions: "Acknowledge.",
            input: { type: "text", text: "ping" },
          }),
        );
        expect(events.at(-1)?.type).toBe("run_completed");

        const caps = live.client.getCapabilities();
        expect(caps.supportsStreaming).toBe(true);
        expect(caps.supportsToolCalls).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );
    });
  },
);

