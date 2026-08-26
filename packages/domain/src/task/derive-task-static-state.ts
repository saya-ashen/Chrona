type DeriveTaskStaticStateInput = {
  hasAcceptedPlan: boolean;
};

type DeriveTaskStaticStateResult = {
  persistedStatus: "Draft" | "Ready";
  runnabilityState: "ready_to_run" | "missing_accepted_plan";
  runnabilitySummary: string;
  missingPaths: string[];
};

/** Provider configuration is resolved from AI Clients at execution time. */
export function deriveTaskStaticState(
  input: DeriveTaskStaticStateInput,
): DeriveTaskStaticStateResult {
  if (!input.hasAcceptedPlan) {
    return {
      persistedStatus: "Draft",
      runnabilityState: "missing_accepted_plan",
      runnabilitySummary: "Generate and accept a plan",
      missingPaths: [],
    };
  }

  return {
    persistedStatus: "Ready",
    runnabilityState: "ready_to_run",
    runnabilitySummary: "Ready to run",
    missingPaths: [],
  };
}
