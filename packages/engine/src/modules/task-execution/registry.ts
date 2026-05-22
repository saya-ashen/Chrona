import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";
import type {
  RuntimeAdapterDefinition,
  RuntimeInput,
  RuntimeTaskConfigSpec,
} from "@chrona/runtime-core";
import { validateTaskConfigAgainstSpec } from "@chrona/runtime-core";

const HERMES_TASK_CONFIG_SPEC: RuntimeTaskConfigSpec = {
  runtime: HERMES_EXECUTION_RUNTIME,
  version: "1",
  fields: [],
  runnability: { requiredPaths: [] },
};

const runtimeRegistry = new Map<string, RuntimeAdapterDefinition>([
  [
    HERMES_EXECUTION_RUNTIME,
    {
      key: HERMES_EXECUTION_RUNTIME,
      inputVersion: HERMES_TASK_CONFIG_SPEC.version,
      getTaskConfigSpec: () => HERMES_TASK_CONFIG_SPEC,
      validateTaskConfig: (input: unknown) =>
        validateTaskConfigAgainstSpec(HERMES_TASK_CONFIG_SPEC, input),
    },
  ],
]);

export function getRuntimeAdapterDefinition(key: string) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    throw new Error("runtime key is required");
  }

  const definition = runtimeRegistry.get(normalizedKey);

  if (!definition) {
    throw new Error(`Unknown runtime: ${normalizedKey}`);
  }

  return definition;
}

export function resolveExecutionRuntime(input: {
  executionRuntime?: string | null;
  workspaceDefaultRuntime?: string | null;
}) {
  return (
    input.executionRuntime?.trim() ||
    input.workspaceDefaultRuntime?.trim() ||
    HERMES_EXECUTION_RUNTIME
  );
}

export function getRuntimeTaskConfigSpec(key: string): RuntimeTaskConfigSpec {
  return getRuntimeAdapterDefinition(key).getTaskConfigSpec();
}

export function validateRuntimeTaskConfig(
  key: string,
  input: unknown,
): RuntimeInput {
  return getRuntimeAdapterDefinition(key).validateTaskConfig(input);
}

export function listExecutionRuntimes() {
  return [HERMES_EXECUTION_RUNTIME];
}
