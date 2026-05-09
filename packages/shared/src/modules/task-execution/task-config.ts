import {
  getRuntimeTaskConfigSpec,
  resolveExecutionRuntime,
  validateRuntimeTaskConfig,
} from "./registry";
import type { RuntimeInput } from "@chrona/runtime-core";

function isRuntimeInput(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveTaskRuntimeConfig(input: {
  executionRuntime?: string | null;
  workspaceDefaultRuntime?: string | null;
  executionConfig?: unknown;
}) {
  const executionRuntime = resolveExecutionRuntime({
    executionRuntime: input.executionRuntime,
    workspaceDefaultRuntime: input.workspaceDefaultRuntime,
  });
  const executionConfig: RuntimeInput = isRuntimeInput(input.executionConfig)
    ? { ...input.executionConfig }
    : {};

  return {
    executionRuntime,
    executionConfig,
  };
}

export function validateTaskRuntimeConfig(input: {
  executionRuntime?: string | null;
  workspaceDefaultRuntime?: string | null;
  executionConfig?: unknown;
}) {
  const resolved = resolveTaskRuntimeConfig(input);
  const validatedExecutionConfig = validateRuntimeTaskConfig(
    resolved.executionRuntime,
    resolved.executionConfig,
  );

  return {
    executionRuntime: resolved.executionRuntime,
    executionConfig: validatedExecutionConfig,
  };
}
