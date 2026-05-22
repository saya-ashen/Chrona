import { describe, expect, it } from "bun:test";
import {
  assertNoLegacyCheckpointResultError,
  LEGACY_CHECKPOINT_RESULT_ERROR,
} from "@chrona/engine/modules/plan-execution/checkpoint-regression-assertions";
import { SAMPLE_CHECKPOINT_RESULT_CASES } from "./plan-execution-fixtures";

describe("plan execution checkpoint regression", () => {
  it("passes supported checkpoint evidence when legacy Hermes error is absent", () => {
    expect(() => assertNoLegacyCheckpointResultError({
      scenarioId: "api-checkpoint-supported-flow",
      expected: "checkpoint result accepted",
      actual: { status: "completed", result: { outcome: "accept" } },
      visibleText: "Checkpoint approved",
      logs: ["review checkpoint result received"],
    })).not.toThrow();
  });

  it("keeps success, missing, malformed, and delayed checkpoint fixtures free of the legacy error", () => {
    for (const checkpointCase of SAMPLE_CHECKPOINT_RESULT_CASES) {
      expect(() => assertNoLegacyCheckpointResultError({
        scenarioId: checkpointCase.scenarioId,
        expected: checkpointCase.expectedDiagnostic,
        actual: checkpointCase.payload,
        logs: [`checkpoint ${checkpointCase.status} for ${checkpointCase.nodeId}`],
      })).not.toThrow();
    }
  });

  it("fails supported checkpoint evidence when legacy Hermes error leaks", () => {
    expect(() => assertNoLegacyCheckpointResultError({
      scenarioId: "api-checkpoint-regression",
      expected: "checkpoint result accepted",
      actual: { status: "failed" },
      errorSummary: LEGACY_CHECKPOINT_RESULT_ERROR,
    })).toThrow(LEGACY_CHECKPOINT_RESULT_ERROR);
  });
});
