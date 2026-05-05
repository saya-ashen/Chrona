import {
  DEFAULT_RUNTIME_ADAPTER_KEY,
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "@chrona/providers-core";
import {
  getResearchTaskConfigSpec,
  RESEARCH_RUNTIME_ADAPTER_KEY,
  RESEARCH_RUNTIME_INPUT_VERSION,
  validateResearchTaskConfig,
} from "../research-execution/config";
import type {
  RuntimeAdapterDefinition,
  RuntimeInput,
  RuntimeTaskConfigSpec,
} from "@chrona/runtime-core";

const runtimeRegistry = new Map<string, RuntimeAdapterDefinition>([
  [
    DEFAULT_RUNTIME_ADAPTER_KEY,
    {
      key: DEFAULT_RUNTIME_ADAPTER_KEY,
      inputVersion: OPENCLAW_RUNTIME_INPUT_VERSION,
      getTaskConfigSpec: getOpenClawTaskConfigSpec,
      validateTaskConfig: validateOpenClawTaskConfig,
      createExecutionAdapter: async () => {
        throw new Error("createExecutionAdapter is only available from the server execution registry");
      },
    },
  ],
  [
    RESEARCH_RUNTIME_ADAPTER_KEY,
    {
      key: RESEARCH_RUNTIME_ADAPTER_KEY,
      inputVersion: RESEARCH_RUNTIME_INPUT_VERSION,
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

export function resolveRuntimeAdapterKey(input: {
  runtimeAdapterKey?: string | null;
  workspaceDefaultRuntime?: string | null;
}) {
  return (
    input.runtimeAdapterKey?.trim() ||
    input.workspaceDefaultRuntime?.trim() ||
    DEFAULT_RUNTIME_ADAPTER_KEY
  );
}

export function getRuntimeTaskConfigSpec(key: string): RuntimeTaskConfigSpec {
  return getRuntimeAdapterDefinition(key).getTaskConfigSpec();
}

export function validateRuntimeTaskConfig(key: string, input: unknown): RuntimeInput {
  return getRuntimeAdapterDefinition(key).validateTaskConfig(input);
}

function _listRuntimeAdapterKeys() {
  return [...runtimeRegistry.keys()];
}
