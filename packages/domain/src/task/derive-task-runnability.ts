export type TaskRunnabilityResult = {
  isRunnable: boolean;
  state: "ready_to_run";
  summary: string;
  missingFields: string[];
};

/** Provider readiness is derived from the selected AI Client, not task adapters. */
export function deriveTaskRunnability(): TaskRunnabilityResult {
  return {
    isRunnable: true,
    state: "ready_to_run",
    summary: "Ready to run",
    missingFields: [],
  };
}
