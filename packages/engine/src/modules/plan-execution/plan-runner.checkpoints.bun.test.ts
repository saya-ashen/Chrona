import { describe, expect, it } from "bun:test";
import {
  assertNoLegacyCheckpointResultError,
  LEGACY_CHECKPOINT_RESULT_ERROR,
} from "./checkpoint-regression-assertions";
import { createPlanGraphScenario } from "./plan-graph-test-fixtures";

describe("checkpoint graph regression fixtures", () => {
  it("defines approved, missing, and malformed checkpoint outcomes without legacy error text", () => {
    for (const scenarioId of ["checkpoint", "missing-result", "malformed-result"] as const) {
      const scenario = createPlanGraphScenario(scenarioId);

      assertNoLegacyCheckpointResultError({
        scenarioId: scenario.id,
        expected: scenario.expectedOutcome,
        actual: scenario,
        visibleText: scenario.name,
        logs: ["checkpoint fixture prepared"],
      });
    }
  });

  it("fails immediately when supported checkpoint evidence contains the legacy error", () => {
    expect(() => assertNoLegacyCheckpointResultError({
      scenarioId: "checkpoint-regression",
      expected: "supported checkpoint flow succeeds",
      actual: { message: LEGACY_CHECKPOINT_RESULT_ERROR },
    })).toThrow(LEGACY_CHECKPOINT_RESULT_ERROR);
  });
});
