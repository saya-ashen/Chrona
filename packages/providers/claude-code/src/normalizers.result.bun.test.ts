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
): { type: string; status?: string; error?: string } {
  const ctx = createNormalizerContext();
  const options: NormalizerOptions = { cancelRequested };
  const events = mapClaudeCodeStreamItems([{ type: "result", ...rec }], ctx, options);
  expect(events).toHaveLength(1);
  const event = events[0];
  return {
    type: event.type,
    status: "run" in event ? event.run?.status : undefined,
    error: event.type === "run_failed" ? event.error : undefined,
  };
}

describe("normalizers result terminal mapping", () => {
  test("subtype:success → run_completed (cancel flag irrelevant)", () => {
    expect(mapResult({ subtype: "success", result: "done" }, false).type).toBe("run_completed");
    expect(mapResult({ subtype: "success", result: "done" }, true).type).toBe("run_completed");
  });

  test("terminal result events carry terminal run status", () => {
    expect(mapResult({ subtype: "success", result: "done" }, false)).toMatchObject({
      type: "run_completed",
      status: "completed",
    });
    expect(mapResult({ subtype: "error_during_execution" }, false)).toMatchObject({
      type: "run_failed",
      status: "failed",
    });
    expect(mapResult({ subtype: "error_during_execution" }, true)).toMatchObject({
      type: "run_cancelled",
      status: "cancelled",
    });
  });

  test("cancelRequested + error_during_execution → run_cancelled", () => {
    expect(mapResult({ subtype: "error_during_execution" }, true).type).toBe("run_cancelled");
  });

  test("cancelRequested + generic error subtype → run_cancelled (F-02 regression)", () => {
    // The SDK's post-interrupt subtype is not guaranteed to be
    // `error_during_execution`; any non-success terminal after a cancel is a
    // cancellation, not a failure.
    expect(mapResult({ subtype: "error" }, true).type).toBe("run_cancelled");
    expect(mapResult({ subtype: "error_max_turns" }, true).type).toBe("run_cancelled");
    expect(mapResult({ subtype: "unexpected_abort_code" }, true).type).toBe("run_cancelled");
  });

  test("missing subtype defaults to success → run_completed even when cancelled", () => {
    // A `result` with no subtype is treated as success by design; the cancel
    // remap only applies to explicit non-success terminals.
    expect(mapResult({}, true).type).toBe("run_completed");
  });

  test("no cancel + error subtype → run_failed", () => {
    expect(mapResult({ subtype: "error_during_execution" }, false).type).toBe("run_failed");
    expect(mapResult({ subtype: "error", errors: ["boom"] }, false)).toMatchObject({ type: "run_failed", error: "boom" });
  });

  test("success subtype with API error status maps to run_failed", () => {
    expect(mapResult({ subtype: "success", is_error: true, api_error_status: 401 }, false)).toMatchObject({
      type: "run_failed",
      error: "Claude Code API request failed with HTTP 401 (authentication failed).",
    });
  });

  test("result API error preserves SDK error detail", () => {
    expect(mapResult({ subtype: "success", api_error_status: 401, errors: ["invalid x-api-key"] }, false)).toMatchObject({
      type: "run_failed",
      error: "Claude Code API request failed with HTTP 401 (authentication failed). invalid x-api-key",
    });
  });

  test("assistant authentication error maps to run_failed", () => {
    const ctx = createNormalizerContext();
    const options: NormalizerOptions = { cancelRequested: false };

    const events = mapClaudeCodeStreamItems([
      { type: "assistant", error: "authentication_failed", message: { content: [] } },
    ], ctx, options);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run_failed",
      error: "Claude Code assistant error: authentication_failed",
    });
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
          content_block: { type: "tool_use", id: "toolu_1", name: "fixture_echo" },
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
