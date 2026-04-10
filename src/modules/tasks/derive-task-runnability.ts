type DeriveTaskRunnabilityInput = {
  runtimeModel: string | null | undefined;
  prompt: string | null | undefined;
  runtimeConfig?: unknown;
};

export type TaskRunnabilityState =
  | "missing_model"
  | "missing_prompt"
  | "missing_model_and_prompt"
  | "ready_to_run";

export type TaskRunnabilityResult = {
  isRunnable: boolean;
  state: TaskRunnabilityState;
  summary: string;
  missingFields: Array<"model" | "prompt">;
};

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function deriveTaskRunnability(
  input: DeriveTaskRunnabilityInput,
): TaskRunnabilityResult {
  const hasModel = hasText(input.runtimeModel);
  const hasPrompt = hasText(input.prompt);

  if (!hasModel && !hasPrompt) {
    return {
      isRunnable: false,
      state: "missing_model_and_prompt",
      summary: "Needs model and prompt",
      missingFields: ["model", "prompt"],
    };
  }

  if (!hasModel) {
    return {
      isRunnable: false,
      state: "missing_model",
      summary: "Needs model",
      missingFields: ["model"],
    };
  }

  if (!hasPrompt) {
    return {
      isRunnable: false,
      state: "missing_prompt",
      summary: "Needs prompt",
      missingFields: ["prompt"],
    };
  }

  return {
    isRunnable: true,
    state: "ready_to_run",
    summary: "Ready to run",
    missingFields: [],
  };
}
