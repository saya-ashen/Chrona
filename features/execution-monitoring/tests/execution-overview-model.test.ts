import { describe, expect, it } from "vitest";
import {
  buildExecutionActivityState,
  RESULT_FINALIZATION_STALE_MS,
  resultStatusFor,
} from "../ui/execution-overview-model";

const nowMs = Date.parse("2026-08-19T10:00:00.000Z");

function stateFor(finalization: { status: string; startedAt?: string }) {
  return buildExecutionActivityState({
    nodes: [],
    liveActivity: [],
    liveRuntimeActivity: [],
    savedTrailActivity: [],
    runtimeEvents: [],
    executionStatus: "completed",
    isExecutionRunning: false,
    finalization,
    nowMs,
  });
}

describe.each([
  {
    name: "fresh running finalization",
    finalization: {
      status: "Running",
      startedAt: new Date(nowMs - RESULT_FINALIZATION_STALE_MS + 1).toISOString(),
    },
    expected: { running: true, failed: false, stalled: false, resultStatus: "running" },
  },
  {
    name: "stalled running finalization",
    finalization: {
      status: "Running",
      startedAt: new Date(nowMs - RESULT_FINALIZATION_STALE_MS).toISOString(),
    },
    expected: { running: false, failed: true, stalled: true, resultStatus: "stalled" },
  },
  {
    name: "explicit failed finalization",
    finalization: { status: "Failed" },
    expected: { running: false, failed: true, stalled: false, resultStatus: "failed" },
  },
  {
    name: "ready finalization",
    finalization: { status: "Ready" },
    expected: { running: false, failed: false, stalled: false, resultStatus: "ready" },
  },
])("finalization state: $name", ({ finalization, expected }) => {
  it("derives final result status", () => {
    const state = stateFor(finalization);

    expect({
      running: state.finalizationRunning,
      failed: state.finalizationFailed,
      stalled: state.finalizationStalled,
      resultStatus: resultStatusFor(state),
    }).toEqual(expected);
  });
});
