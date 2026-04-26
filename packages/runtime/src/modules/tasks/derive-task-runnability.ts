import { readMissingRequiredPaths, readRequiredFieldLabel } from "@chrona/runtime-core";
import { getRuntimeTaskConfigSpec } from "../task-execution/registry";
import { resolveTaskRuntimeConfig } from "../task-execution/task-config";

type DeriveTaskRunnabilityInput = {
  runtimeAdapterKey?: string | null;
  workspaceDefaultRuntime?: string | null;
  runtimeInput?: unknown;
  runtimeModel: string | null | undefined;
  prompt: string | null | undefined;
  runtimeConfig?: unknown;
};

export type TaskRunnabilityState =
  | "missing_model"
  | "missing_prompt"
  | "missing_model_and_prompt"
  | "missing_required_fields"
  | "ready_to_run";

export type TaskRunnabilityResult = {
  isRunnable: boolean;
  state: TaskRunnabilityState;
  summary: string;
  missingFields: string[];
};

function formatMissingSummary(labels: string[]) {
  if (labels.length === 0) {
    return "Ready to run";
  }

  if (labels.length === 1) {
    return `Needs ${labels[0].toLowerCase()}`;
  }

  if (labels.length === 2) {
    return `Needs ${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`;
  }

  return `Needs ${labels.slice(0, -1).map((label) => label.toLowerCase()).join(", ")}, and ${labels.at(-1)?.toLowerCase()}`;
}

export function deriveTaskRunnability(
  input: DeriveTaskRunnabilityInput,
): TaskRunnabilityResult {
  const resolvedRuntimeConfig = resolveTaskRuntimeConfig(input);
  const spec = getRuntimeTaskConfigSpec(resolvedRuntimeConfig.runtimeAdapterKey);
  const missingFields = readMissingRequiredPaths(spec, resolvedRuntimeConfig.runtimeInput);
  const missingLabels = missingFields.map((path) => readRequiredFieldLabel(spec, path));

  if (missingFields.length === 0) {
    return {
      isRunnable: true,
      state: "ready_to_run",
      summary: "Ready to run",
      missingFields: [],
    };
  }

  if (missingFields.length === 2 && missingFields.includes("model") && missingFields.includes("prompt")) {
    return {
      isRunnable: false,
      state: "missing_model_and_prompt",
      summary: "Needs model and prompt",
      missingFields,
    };
  }

  if (missingFields.length === 1 && missingFields[0] === "model") {
    return {
      isRunnable: false,
      state: "missing_model",
      summary: "Needs model",
      missingFields,
    };
  }

  if (missingFields.length === 1 && missingFields[0] === "prompt") {
    return {
      isRunnable: false,
      state: "missing_prompt",
      summary: "Needs prompt",
      missingFields,
    };
  }

  return {
    isRunnable: false,
    state: "missing_required_fields",
    summary: formatMissingSummary(missingLabels),
    missingFields,
  };
}
