import { describe, expect, it } from "bun:test";
import { deriveTaskStaticState } from "./derive-task-static-state";

describe("deriveTaskStaticState", () => {
  it("keeps tasks draft until a plan is accepted", () => {
    expect(deriveTaskStaticState({ hasAcceptedPlan: false })).toEqual({
      persistedStatus: "Draft",
      runnabilityState: "missing_accepted_plan",
      runnabilitySummary: "Generate and accept a plan",
      missingPaths: [],
    });
  });

  it("marks tasks ready after plan acceptance", () => {
    expect(deriveTaskStaticState({ hasAcceptedPlan: true })).toEqual({
      persistedStatus: "Ready",
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
      missingPaths: [],
    });
  });
});
