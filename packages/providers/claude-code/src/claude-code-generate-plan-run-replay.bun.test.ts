/**
 * Spec 019 — Claude Code provider replay test for plan generation (test G).
 *
 * Asserts the `chrona_plan_generate` MCP tool name surfaces in a successful
 * `generate_plan` replay: the run ends with `run_completed`, the stream
 * contains at least one `tool_result` event for `chrona_plan_generate`
 * (the actual MCP tool name — verified at
 * `@chrona/contracts/ai-feature-specs.ts:33`), and the terminal snapshot
 * reports `status === "completed"`.
 *
 * Pure replay test — no Claude Code process is spawned. The synthetic
 * `plan-generation.jsonl` fixture drives `createReplayRunner`, the client
 * wraps it, and the assertions read the resulting event stream.
 *
 * Plan: specs/019-plan-card-and-accept-tests/plan.md §3 (test G).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { terminalSnapshotFromEvents } from "@chrona/providers-foundation";

import { ClaudeCodeProviderClient } from "./ClaudeCodeProviderClient";
import { createReplayRunner } from "./runner";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

function makeClient(): ClaudeCodeProviderClient {
  const tapePath = join(FIXTURES_DIR, "plan-generation.jsonl");
  return new ClaudeCodeProviderClient({
    config: {
      mcpBaseUrl: "http://localhost:0",
    },
    runner: createReplayRunner(tapePath),
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe("ClaudeCodeProviderClient — plan generation replay", () => {
  test("generate_plan run: ends with run_completed and includes a chrona_plan_generate tool_result", async () => {
    const client = makeClient();
    const events = await collect(
      client.streamRun({
        sessionId: "chrona-session-fixture-plan",
        instructions: "Generate a plan for task-1 using the chrona_plan_generate tool.",
        input: { type: "text", text: "Generate a plan for task-1." },
      }),
    );

    const types = events.map((e) => e.type);
    // The terminal event must be `run_completed`, not `run_failed`.
    expect(types.at(-1)).toBe("run_completed");
    expect(types.at(0)).toBe("run_started");

    // At least one `tool_result` event for `chrona_plan_generate` (the
    // MCP tool name wired in the server's plan-arrival flow).
    const planToolResults = events.filter(
      (e) => e.type === "tool_result" && (e as { tool?: string }).tool === "chrona_plan_generate",
    );
    expect(planToolResults.length).toBeGreaterThanOrEqual(1);

    // The corresponding `tool_call` event must also reference
    // `chrona_plan_generate` so we know the result is paired with the
    // right tool.
    const planToolCalls = events.filter(
      (e) => e.type === "tool_call" && (e as { tool?: string }).tool === "chrona_plan_generate",
    );
    expect(planToolCalls.length).toBe(planToolResults.length);

    // Terminal snapshot agrees the run completed.
    const snap = terminalSnapshotFromEvents(events);
    expect(snap?.status).toBe("completed");
    expect(snap?.runId).toBe("plan-run");
    void client;
  });
});