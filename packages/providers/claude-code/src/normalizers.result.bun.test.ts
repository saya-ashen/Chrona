/**
 * normalizers.result.bun.test.ts — pure-function coverage for the `result`
 * terminal mapping in `normalizers.ts`.
 *
 * Focus: the cancel-vs-fail decision. The SDK emits a `result` message to end
 * every run; its `subtype` decides the terminal event. After a user-initiated
 * cancel (`cancelRequested: true`) ANY non-success subtype must map to
 * `run_cancelled` — the SDK's post-interrupt subtype is not stable, so we must
 * not key off `error_during_execution` specifically (regression: F-02, where a
 * cancelled run surfaced `run_failed`).
 *
 * No `claude` binary involved — `mapClaudeCodeStreamItems` is pure.
 */

import { describe, expect, test } from "bun:test";

import {
  createNormalizerContext,
  mapClaudeCodeStreamItems,
  type NormalizerOptions,
} from "./normalizers";

function mapResult(
  rec: Record<string, unknown>,
  cancelRequested: boolean,
): string {
  const ctx = createNormalizerContext();
  const options: NormalizerOptions = { cancelRequested };
  const events = mapClaudeCodeStreamItems([{ type: "result", ...rec }], ctx, options);
  expect(events).toHaveLength(1);
  return events[0].type;
}

describe("normalizers result terminal mapping", () => {
  test("subtype:success → run_completed (cancel flag irrelevant)", () => {
    expect(mapResult({ subtype: "success", result: "done" }, false)).toBe("run_completed");
    expect(mapResult({ subtype: "success", result: "done" }, true)).toBe("run_completed");
  });

  test("cancelRequested + error_during_execution → run_cancelled", () => {
    expect(mapResult({ subtype: "error_during_execution" }, true)).toBe("run_cancelled");
  });

  test("cancelRequested + generic error subtype → run_cancelled (F-02 regression)", () => {
    // The SDK's post-interrupt subtype is not guaranteed to be
    // `error_during_execution`; any non-success terminal after a cancel is a
    // cancellation, not a failure.
    expect(mapResult({ subtype: "error" }, true)).toBe("run_cancelled");
    expect(mapResult({ subtype: "error_max_turns" }, true)).toBe("run_cancelled");
    expect(mapResult({ subtype: "unexpected_abort_code" }, true)).toBe("run_cancelled");
  });

  test("missing subtype defaults to success → run_completed even when cancelled", () => {
    // A `result` with no subtype is treated as success by design; the cancel
    // remap only applies to explicit non-success terminals.
    expect(mapResult({}, true)).toBe("run_completed");
  });

  test("no cancel + error subtype → run_failed", () => {
    expect(mapResult({ subtype: "error_during_execution" }, false)).toBe("run_failed");
    expect(mapResult({ subtype: "error", errors: ["boom"] }, false)).toBe("run_failed");
  });
});

describe("normalizers non-emitting SDK messages", () => {
  test("assistant/user messages without mapped blocks emit raw_event instead of empty batch", () => {
    const ctx = createNormalizerContext();
    const options: NormalizerOptions = { cancelRequested: false };

    const events = mapClaudeCodeStreamItems([
      { type: "assistant", message: { content: [] } },
      { type: "user", message: { content: [{ type: "text", text: "ignored" }] } },
    ], ctx, options);

    expect(events.map((event) => event.type)).toEqual(["raw_event", "raw_event"]);
  });

  test("content_block_stop without known call id emits raw_event instead of empty batch", () => {
    const ctx = createNormalizerContext();
    const options: NormalizerOptions = { cancelRequested: false };

    const events = mapClaudeCodeStreamItems([
      { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
    ], ctx, options);

    expect(events.map((event) => event.type)).toEqual(["raw_event"]);
  });

  test("content_block_stop with known call id emits both tool events", () => {
    const ctx = createNormalizerContext();
    const options: NormalizerOptions = { cancelRequested: false };

    const events = mapClaudeCodeStreamItems([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "chrona_plan_generate" },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{\"title\":\"Plan\"}" },
        },
      },
      { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
    ], ctx, options);

    expect(events.map((event) => event.type)).toEqual([
      "tool_started",
      "raw_event",
      "tool_call",
      "tool_completed",
    ]);
  });
});
