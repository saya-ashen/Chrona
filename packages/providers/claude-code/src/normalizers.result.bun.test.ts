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
