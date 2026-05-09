import {
  OPENCLAW_EXECUTION_RUNTIME,
  getOpenClawTaskConfigSpec,
  validateOpenClawTaskConfig,
} from "@chrona/openclaw";
import {
  getResearchTaskConfigSpec,
  RESEARCH_EXECUTION_RUNTIME,
  validateResearchTaskConfig,
} from "../research-execution/config";
import type {
  RuntimeAdapterDefinition,
  RuntimeInput,
  RuntimeTaskConfigSpec,
} from "@chrona/runtime-core";

const runtimeRegistry = new Map<string, RuntimeAdapterDefinition>([
  [
    OPENCLAW_EXECUTION_RUNTIME,
    {
      key: OPENCLAW_EXECUTION_RUNTIME,
      inputVersion: getOpenClawTaskConfigSpec().version,
      getTaskConfigSpec: getOpenClawTaskConfigSpec,
      validateTaskConfig: validateOpenClawTaskConfig,
      createExecutionAdapter: async () => {
        throw new Error("createExecutionAdapter is only available from the server execution registry");
      },
    },
  ],
  [
    RESEARCH_EXECUTION_RUNTIME,
    {
      key: RESEARCH_EXECUTION_RUNTIME,
      inputVersion: getResearchTaskConfigSpec().version,
      getTaskConfigSpec: getResearchTaskConfigSpec,
      validateTaskConfig: validateResearchTaskConfig,
      createExecutionAdapter: async () => {
        throw new Error("createExecutionAdapter is only available from the server execution registry");
      },
    },
  ],
]);

export function getRuntimeAdapterDefinition(key: string) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    throw new Error("runtime adapter key is required");
  }

  const definition = runtimeRegistry.get(normalizedKey);

  if (!definition) {
    throw new Error(`Unknown runtime adapter: ${normalizedKey}`);
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
    OPENCLAW_EXECUTION_RUNTIME
  );
}

export function getRuntimeTaskConfigSpec(key: string): RuntimeTaskConfigSpec {
  return getRuntimeAdapterDefinition(key).getTaskConfigSpec();
}

export function validateRuntimeTaskConfig(key: string, input: unknown): RuntimeInput {
  return getRuntimeAdapterDefinition(key).validateTaskConfig(input);
}

export function listExecutionRuntimes() {
  return [...runtimeRegistry.keys()];
}
