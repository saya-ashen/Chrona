import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";
import { CHRONA_CLAUDE_CODE_PROVIDER_TYPE } from "@chrona/claude-code";
import { CHRONA_DEBUG_PROVIDER_TYPE } from "@chrona/providers-debug";
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

const CLAUDE_CODE_TASK_CONFIG_SPEC: RuntimeTaskConfigSpec = {
  runtime: CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
  version: "1",
  fields: [],
  runnability: { requiredPaths: [] },
};

const DEBUG_TASK_CONFIG_SPEC: RuntimeTaskConfigSpec = {
  runtime: CHRONA_DEBUG_PROVIDER_TYPE,
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
  [
    CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
    {
      key: CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
      inputVersion: CLAUDE_CODE_TASK_CONFIG_SPEC.version,
      getTaskConfigSpec: () => CLAUDE_CODE_TASK_CONFIG_SPEC,
      validateTaskConfig: (input: unknown) =>
        validateTaskConfigAgainstSpec(CLAUDE_CODE_TASK_CONFIG_SPEC, input),
    },
  ],
  [
    CHRONA_DEBUG_PROVIDER_TYPE,
    {
      key: CHRONA_DEBUG_PROVIDER_TYPE,
      inputVersion: DEBUG_TASK_CONFIG_SPEC.version,
      getTaskConfigSpec: () => DEBUG_TASK_CONFIG_SPEC,
      validateTaskConfig: (input: unknown) =>
        validateTaskConfigAgainstSpec(DEBUG_TASK_CONFIG_SPEC, input),
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

export function isKnownExecutionRuntime(key: string | null | undefined) {
  const normalizedKey = key?.trim();
  return !!normalizedKey && runtimeRegistry.has(normalizedKey);
}

export function resolveExecutionRuntime(input: {
  executionRuntime?: string | null;
  workspaceDefaultRuntime?: string | null;
}): string {
  const explicitRuntime = input.executionRuntime?.trim();
  if (explicitRuntime) {
    return explicitRuntime;
  }

  const workspaceDefaultRuntime = input.workspaceDefaultRuntime?.trim();
  if (workspaceDefaultRuntime && isKnownExecutionRuntime(workspaceDefaultRuntime)) {
    return workspaceDefaultRuntime;
  }

  return HERMES_EXECUTION_RUNTIME;
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
  return [
    HERMES_EXECUTION_RUNTIME,
    CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
    CHRONA_DEBUG_PROVIDER_TYPE,
  ];
}
