import type { RuntimeInput, RuntimeTaskConfigSpec } from "@chrona/runtime-core";

type DeriveTaskStaticStateInput = {
  executionConfig?: unknown;
  runtimeSpec: RuntimeTaskConfigSpec;
  hasAcceptedPlan: boolean;
};

type DeriveTaskStaticStateResult = {
  persistedStatus: "Draft" | "Ready";
  runnabilityState:
    | "ready_to_run"
    | "missing_required_config"
    | "missing_accepted_plan";
  runnabilitySummary: string;
  missingPaths: string[];
};

function isRuntimeInput(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readPathValue(input: RuntimeInput, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, input);
}

function hasConfiguredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function deriveTaskStaticState(
  input: DeriveTaskStaticStateInput,
): DeriveTaskStaticStateResult {
  const executionConfig = isRuntimeInput(input.executionConfig)
    ? input.executionConfig
    : {};
  const missingPaths = input.runtimeSpec.runnability.requiredPaths.filter(
    (path) => !hasConfiguredValue(readPathValue(executionConfig, path)),
  );

  if (missingPaths.length > 0) {
    return {
      persistedStatus: "Draft",
      runnabilityState: "missing_required_config",
      runnabilitySummary:
        missingPaths.length === 1
          ? `Missing required config: ${missingPaths[0]}`
          : `Missing required config: ${missingPaths.join(", ")}`,
      missingPaths,
    };
  }

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
