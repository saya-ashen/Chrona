/**
 * Live Claude Code provider tests — supplementary coverage.
 *
 * Companion to `claude-code-aimock-live.bun.test.ts` (the baseline 3
 * tests for text-only / tool round-trip / startRun+getRun contract).
 * Each describe below targets one spec 017 / plan §0.2 row that the
 * replay-based tests could not cover:
 *
 *   - plan-generation tool round-trip (spec 019 plan-card wire)
 *   - cancel mid-run → synthetic `run_cancelled` terminal
 *   - multi-turn ordering (tool_call → tool_result → text_delta)
 *   - MCP tool error propagation (thrown handler → isError content)
 *   - LLM 4xx surface (text_delta "API Error: …" + run_completed)
 *   - reasoning_delta (Anthropic thinking block)
 *   - callId pairing (tool_call.callId === tool_result.callId)
 *   - usage accounting (input_tokens / output_tokens reach terminal)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";


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
describe.skipIf(!HAS_CLAUDE)(
  "ClaudeCodeProviderClient — live extras (real claude + mocked LLM)",
  // eslint-disable-next-line max-lines-per-function -- test file; outer arrow aggregates 9 sub-describes.
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
            received: {
              taskId: args.taskId,
              nodeCount: Array.isArray(args.nodes) ? args.nodes.length : 0,
            },
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

    describe("plan-generation tool round-trip", () => {
      test(
        "LLM calls chrona_plan_generate; spec 019 plan card wire reaches MCP",
        async () => {
          llm.mock.on(
            { turnIndex: 0 },
            {
              toolCalls: [
                {
                  name: "mcp__chrona__chrona_plan_generate",
                  arguments: {
                    taskId: "task-42",
                    summary: "Research X, draft Y, deliver Z.",
                    nodes: [
                      { id: "n1", title: "Draft plan", objective: "Create outline" },
                      { id: "n2", title: "Execute", objective: "Run the plan" },
                    ],
                  },
                },
              ],
            },
          );
          llm.mock.on({ turnIndex: 1 }, { content: "Plan generated." });

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-plan",
              instructions:
                "Generate a plan for task-42 using the chrona_plan_generate tool.",
              input: {
                type: "text",
                text: "Generate a plan for task-42.",
              },
            }),
          );

          const types = events.map((e) => e.type);
          expect(types.at(-1)).toBe("run_completed");

          // The plan tool name from spec 019 must surface in BOTH the call
          // and the result. This is the exact regression spec 019 T3 was
          // worried about — if the tool name is misspelled in the runner /
          // MCP wiring, claude would never invoke it and we'd see neither.
          const planCalls = events.filter(
            (e) => e.type === "tool_call" && (e as { tool?: string }).tool === "mcp__chrona__chrona_plan_generate",
          );
          const planResults = events.filter(
            (e) => e.type === "tool_result" && (e as { tool?: string }).tool === "mcp__chrona__chrona_plan_generate",
          );
          expect(planCalls.length).toBeGreaterThanOrEqual(1);
          expect(planResults.length).toBe(planCalls.length);

          const planResult = planResults[0];
          if (planResult?.type === "tool_result") {
            const text = extractToolResultText(planResult.result);
            expect(text).toContain("live-plan-1");
            expect(JSON.parse(text)).toMatchObject({
              ok: true,
              planId: "live-plan-1",
              received: { taskId: "task-42", nodeCount: 2 },
            });
          }

          const planServerCalls = mcp.calls.filter(
            (c) => c.tool === "chrona_plan_generate",
          );
          expect(planServerCalls).toHaveLength(1);
          expect(planServerCalls[0]?.args).toMatchObject({
            taskId: "task-42",
            nodes: expect.any(Array),
          });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("cancel mid-run", () => {
      test(
        "cancelRun after tool_call surfaces a run_cancelled terminal in the stream",
        async () => {
          llm.mock.on(
            { turnIndex: 0 },
            {
              toolCalls: [
                {
                  name: "mcp__chrona__chrona_node_block",
                  arguments: { nodeId: "n9", reason: "long running" },
                },
              ],
            },
          );

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const ref = await live.client.startRun({
            sessionId: "live-sess-cancel",
            instructions: "Block node n9 (will be cancelled).",
            input: { type: "text", text: "Block n9." },
          });

          // streamRun ATTACHED to the same runId so the cancel hits the
          // handle the iterator is reading from.
          const iter = live.client.streamRun({
            runId: ref.runId,
            sessionId: ref.sessionId,
            instructions: "Block node n9 (will be cancelled).",
            input: { type: "text", text: "Block n9." },
          });

          // Consume the entire stream in one pass. As soon as we see the
          // LLM-emitted tool_call, issue the cancel. The provider
          // synthesizes a `run_cancelled` terminal from the post-cancel
          // snapshot, so we keep iterating until we hit it.
          const all: string[] = [];
          let cancelled = false;
          for await (const ev of iter) {
            all.push(ev.type);
            if (!cancelled && ev.type === "tool_call") {
              await live.client.cancelRun({ runId: ref.runId });
              cancelled = true;
            }
            if (
              ev.type === "run_cancelled" ||
              ev.type === "run_failed" ||
              ev.type === "run_completed"
            ) {
              break;
            }
          }
          expect(all).toContain("run_started");
          expect(all).toContain("tool_call");
          expect(all.at(-1)).toBe("run_cancelled");

          // getRun on the same runId reflects the cancelled status.
          const snap = await live.client.getRun({ runId: ref.runId });
          expect(snap.status).toBe("cancelled");
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("multi-turn (tool result -> follow-up text)", () => {
      test(
        "after tool_result, the LLM's next turn surfaces as text_delta in order",
        async () => {
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
          llm.mock.on({ turnIndex: 1 }, { content: "Acknowledged completion of n3." });

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-multiturn",
              instructions: "Complete node n3 then summarize.",
              input: { type: "text", text: "Run and confirm n3." },
            }),
          );

          const types = events.map((e) => e.type);
          // Strict ordering: tool_call must precede tool_result must precede text.
          const callIdx = types.indexOf("tool_call");
          const resultIdx = types.indexOf("tool_result");
          const textIdx = types.findIndex((t) => t === "text_delta");
          expect(callIdx).toBeGreaterThanOrEqual(0);
          expect(resultIdx).toBeGreaterThan(callIdx);
          if (textIdx >= 0) {
            expect(textIdx).toBeGreaterThan(resultIdx);
          }
          expect(types.at(-1)).toBe("run_completed");

          // The LLM was actually called twice (turn 0 + turn 1).
          expect(llm.mock.getRequests().length).toBeGreaterThanOrEqual(2);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("MCP tool error propagation", () => {
      test(
        "thrown tool handler surfaces the error string in the tool_result",
        async () => {
          // Replace the shared stub with one whose only tool throws — this
          // proves the provider's tool_result event still flows when the
          // MCP side errors.
          await mcp.close();
          mcp = await startChronaMcpStub([
            {
              name: "chrona_node_complete",
              description: "Complete (always throws).",
              inputShape: {
                nodeId: z.string(),
              },
              handler: () => {
                throw new Error("node-no-longer-runnable");
              },
            },
          ]);

          llm.mock.on(
            { turnIndex: 0 },
            {
              toolCalls: [
                {
                  name: "mcp__chrona__chrona_node_complete",
                  arguments: { nodeId: "n1" },
                },
              ],
            },
          );
          llm.mock.on({ turnIndex: 1 }, { content: "I see the error." });

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-mcperr",
              instructions: "Complete n1 (will error).",
              input: { type: "text", text: "Complete n1." },
            }),
          );

          const result = events.find((e) => e.type === "tool_result");
          expect(result).toBeDefined();
          if (result?.type === "tool_result") {
            // Anthropic puts the MCP-thrown error in the user message
            // content block; the normalizer passes `block.content` through
            // as the `result` field, so the throw message is reachable.
            const text = extractToolResultText(result.result);
            expect(text).toContain("node-no-longer-runnable");
          }

          // Run still terminates cleanly — error in a tool call does NOT
          // fail the run; the agent gets a turn to respond to it.
          expect(events.at(-1)?.type).toBe("run_completed");
          // The MCP server still saw the invocation.
          expect(mcp.calls).toHaveLength(1);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("LLM 4xx surfaces in the stream", () => {
      test(
        "non-retryable LLM error reaches the stream as API Error text_delta",
        async () => {
          // The Anthropic SDK handles a 4xx (context-too-long, bad request,
          // etc.) as a *complete* response — it does NOT throw, because the
          // stream was not interrupted. The error is wrapped in a
          // `text_delta` of the form "API Error: <code> <message>" and
          // the run ends as `run_completed`. The engine detects this by
          // pattern-matching the prefix; we verify the prefix surfaces
          // verbatim through the normalizer.
          llm.mock.on(
            { userMessage: /.*/ },
            {
              error: {
                message: "input tokens exceed limit",
                type: "invalid_request_error",
                code: "context_length_exceeded",
              },
              status: 400,
            },
          );

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-fail",
              instructions: "This request will be rejected by the mock LLM.",
              input: { type: "text", text: "Trigger an LLM error." },
            }),
          );

          // The mock returned 400 — verify it actually reached the wire.
          const lastReq = llm.mock.getLastRequest();
          expect(lastReq).not.toBeNull();
          expect(lastReq?.response?.status).toBe(400);

          // The error text must surface in the stream (the only way the
          // engine can learn about a non-thrown LLM error).
          const allText = events
            .filter((e) => e.type === "text_delta")
            .map((e) => (e as { text: string }).text)
            .join("");
          expect(allText.toLowerCase()).toContain("input tokens exceed limit");

          // The run reaches a terminal (the SDK closes the stream cleanly
          // after a 4xx; it is NOT treated as an interrupted stream).
          expect(events.at(-1)?.type).toBe("run_completed");
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("reasoning_delta", () => {
      test(
        "anthropic thinking block surfaces as reasoning_delta events",
        async () => {
          // The `reasoning` field on a fixture response emits an Anthropic
          // thinking content block. The normalizer maps thinking blocks to
          // `reasoning_delta` events (plan §0.2 row).
          llm.mock.on(
            { userMessage: /.*/ },
            {
              content: "Here is the final answer.",
              reasoning: "Let me think through this step by step…",
            },
          );

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-reasoning",
              instructions: "Think then answer.",
              input: { type: "text", text: "Solve 2+2." },
            }),
          );

          const types = events.map((e) => e.type);
          expect(types.at(-1)).toBe("run_completed");
          // The reasoning block + the final text should both surface.
          expect(types).toContain("reasoning_delta");
          const reasoning = events
            .filter((e) => e.type === "reasoning_delta")
            .map((e) => (e as { text: string }).text)
            .join("");
          expect(reasoning).toContain("step by step");
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("callId pairing", () => {
      test(
        "tool_call.callId equals the matching tool_result.callId",
        async () => {
          llm.mock.on(
            { turnIndex: 0 },
            {
              toolCalls: [
                {
                  name: "mcp__chrona__chrona_node_complete",
                  arguments: { nodeId: "n7", status: "completed" },
                },
              ],
            },
          );
          llm.mock.on({ turnIndex: 1 }, { content: "done." });

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-callid",
              instructions: "Complete n7.",
              input: { type: "text", text: "Run n7." },
            }),
          );

          // Loosely typed: the foundation schema's tool_call and tool_result
          // events both expose `callId` (optional) and `tool` (tool_call)
          // / `result` (tool_result). Pull the two slices by `type` and pair.
          const calls = events
            .filter((e) => e.type === "tool_call")
            .map((e) => e as unknown as { callId?: string; tool?: string });
          const results = events
            .filter((e) => e.type === "tool_result")
            .map((e) => e as unknown as { callId?: string; tool?: string });
          expect(calls.length).toBeGreaterThanOrEqual(1);
          expect(results.length).toBe(calls.length);
          for (let i = 0; i < calls.length; i++) {
            expect(calls[i]!.callId).toBeDefined();
            expect(results[i]!.callId).toBe(calls[i]!.callId);
            expect(results[i]!.tool).toBe(calls[i]!.tool);
          }
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("usage accounting", () => {
      test(
        "fixture's usage numbers reach the terminal run_completed snapshot",
        async () => {
          llm.mock.on(
            { userMessage: /.*/ },
            {
              content: "ack",
              usage: { input_tokens: 7, output_tokens: 11 },
            },
          );

          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });

          const events = await collect(
            live.client.streamRun({
              sessionId: "live-sess-usage",
              instructions: "Acknowledge.",
              input: { type: "text", text: "ping" },
            }),
          );

          const terminal = events.at(-1);
          expect(terminal?.type).toBe("run_completed");
          // Usage lives on the terminal event payload.
          const usage = (terminal as
            | { usage?: { inputTokens?: number; outputTokens?: number } }
            | undefined)?.usage;
          expect(usage).toBeDefined();
          if (usage) {
            // The normalizer renames Anthropic's input_tokens/output_tokens
            // to Chrona's inputTokens/outputTokens.
            expect(usage.inputTokens).toBe(7);
            expect(usage.outputTokens).toBe(11);
          }
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("health probe", () => {
      test(
        "checkHealth returns ok=true when the binary is reachable",
        async () => {
          live = await makeLiveClient({ mockUrl: llm.url, mcpBaseUrl: mcp.baseUrl });
          const health = await live.client.checkHealth();
          expect(health.ok).toBe(true);
          expect(health.provider).toBe("claude_code");
          expect(health.reason ?? null).toBeNull();
        },
        TEST_TIMEOUT_MS,
      );
    });
  },
);