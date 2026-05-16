import {
  OPENCLAW_EXECUTION_RUNTIME,
  getOpenClawTaskConfigSpec,
  validateOpenClawTaskConfig,
} from "@chrona/openclaw";
import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";
import type {
  RuntimeAdapterDefinition,
  RuntimeInput,
  RuntimeTaskConfigSpec,
} from "@chrona/runtime-core";

const runtimeRegistry = new Map<string, RuntimeAdapterDefinition>([
  [
    HERMES_EXECUTION_RUNTIME,
    {
      key: HERMES_EXECUTION_RUNTIME,
      inputVersion: getOpenClawTaskConfigSpec().version,
      getTaskConfigSpec: getOpenClawTaskConfigSpec,
      validateTaskConfig: validateOpenClawTaskConfig,
    },
  ],
  [
    OPENCLAW_EXECUTION_RUNTIME,
    {
      key: OPENCLAW_EXECUTION_RUNTIME,
      inputVersion: getOpenClawTaskConfigSpec().version,
      getTaskConfigSpec: getOpenClawTaskConfigSpec,
      validateTaskConfig: validateOpenClawTaskConfig,
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
  return [...runtimeRegistry.keys()];
}
