import { validateTaskConfigAgainstSpec } from "@chrona/runtime-core";
import {
  getRuntimeAdapterDefinition,
  getRuntimeTaskConfigSpec,
  resolveRuntimeAdapterKey,
  validateRuntimeTaskConfig,
} from "@/modules/task-execution/registry";
import type { RuntimeInput } from "@chrona/runtime-core";

export function isRuntimeInput(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readRuntimeText(input: RuntimeInput, key: string) {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractLegacyRuntimeFields(runtimeInput: RuntimeInput) {
  const runtimeModel = readRuntimeText(runtimeInput, "model");
  const prompt = readRuntimeText(runtimeInput, "prompt");
  const runtimeConfig = { ...runtimeInput };

  delete runtimeConfig.model;
  delete runtimeConfig.prompt;

  return {
    runtimeModel,
    prompt,
    runtimeConfig: Object.keys(runtimeConfig).length > 0 ? runtimeConfig : null,
  };
}

export function buildCompatRuntimeInput(input: {
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
}) {
  const compatInput: RuntimeInput = isRuntimeInput(input.runtimeConfig)
    ? { ...input.runtimeConfig }
    : {};
  const runtimeModel = normalizeText(input.runtimeModel);
  const prompt = normalizeText(input.prompt);

  if (runtimeModel) {
    compatInput.model = runtimeModel;
  }

  if (prompt) {
    compatInput.prompt = prompt;
  }

  return compatInput;
}

export function resolveTaskRuntimeConfig(input: {
  runtimeAdapterKey?: string | null;
  workspaceDefaultRuntime?: string | null;
  runtimeInput?: unknown;
  runtimeInputIsAuthoritative?: boolean;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
  promptOverride?: string | null;
}) {
  const runtimeAdapterKey = resolveRuntimeAdapterKey({
    runtimeAdapterKey: input.runtimeAdapterKey,
    workspaceDefaultRuntime: input.workspaceDefaultRuntime,
  });
  const definition = getRuntimeAdapterDefinition(runtimeAdapterKey);
  const compatRuntimeInput = buildCompatRuntimeInput({
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
  });
  const runtimeInput: RuntimeInput = isRuntimeInput(input.runtimeInput)
    ? input.runtimeInputIsAuthoritative
      ? { ...compatRuntimeInput, ...input.runtimeInput }
      : { ...input.runtimeInput, ...compatRuntimeInput }
    : compatRuntimeInput;
  const legacyRuntimeModel = normalizeText(input.runtimeModel);
  const legacyPrompt = normalizeText(input.prompt);
  const promptOverride = normalizeText(input.promptOverride);

  if (!readRuntimeText(runtimeInput, "model") && legacyRuntimeModel) {
    runtimeInput.model = legacyRuntimeModel;
  }

  if (!readRuntimeText(runtimeInput, "prompt") && legacyPrompt) {
    runtimeInput.prompt = legacyPrompt;
  }

  if (promptOverride) {
    runtimeInput.prompt = promptOverride;
  }

  return {
    runtimeAdapterKey,
    runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion?.trim() || definition.inputVersion,
    effectiveRuntimeModel: readRuntimeText(runtimeInput, "model") ?? legacyRuntimeModel,
    effectivePrompt: readRuntimeText(runtimeInput, "prompt") ?? legacyPrompt ?? promptOverride,
  };
}

export function validateTaskRuntimeConfig(input: {
  runtimeAdapterKey?: string | null;
  workspaceDefaultRuntime?: string | null;
  runtimeInput?: unknown;
  runtimeInputIsAuthoritative?: boolean;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
  promptOverride?: string | null;
}) {
  const resolved = resolveTaskRuntimeConfig(input);
  const validatedRuntimeInput = validateRuntimeTaskConfig(
    resolved.runtimeAdapterKey,
    resolved.runtimeInput,
  );
  const definition = getRuntimeAdapterDefinition(resolved.runtimeAdapterKey);
  const legacyNormalizedRuntimeInput = validateTaskConfigAgainstSpec(
    getRuntimeTaskConfigSpec(resolved.runtimeAdapterKey),
    resolved.runtimeInput,
    { applyDefaults: false },
  );
  const legacyFields = extractLegacyRuntimeFields(legacyNormalizedRuntimeInput);
  const normalizedLegacyFields = extractLegacyRuntimeFields(validatedRuntimeInput);

  return {
    runtimeAdapterKey: resolved.runtimeAdapterKey,
    runtimeInput: validatedRuntimeInput,
    runtimeInputVersion: input.runtimeInputVersion?.trim() || definition.inputVersion,
    effectiveRuntimeModel: normalizedLegacyFields.runtimeModel,
    effectivePrompt: normalizedLegacyFields.prompt,
    runtimeModel: normalizedLegacyFields.runtimeModel,
    prompt: normalizedLegacyFields.prompt,
    runtimeConfig: legacyFields.runtimeConfig,
  };
}

