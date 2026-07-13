export type TaskRunnabilityResult = {
  isRunnable: boolean;
  state: "ready_to_run";
  summary: string;
  missingFields: string[];
};

export function deriveTaskRunnability(input: {
  executionRuntime?: string | null;
  executionConfig?: unknown;
}): TaskRunnabilityResult {
  void input;

  return {
    isRunnable: true,
    state: "ready_to_run",
    summary: "Ready to run",
    missingFields: [],
  };
}
