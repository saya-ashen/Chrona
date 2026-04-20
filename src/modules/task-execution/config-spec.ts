import type {
  RuntimeInput,
  RuntimeTaskConfigField,
  RuntimeTaskConfigSpec,
} from "@/modules/task-execution/types";

function isRuntimeInput(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isMissingValue(value: unknown) {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

function getSegments(path: string) {
  return path.split(".").filter(Boolean);
}

export function getValueAtPath(input: unknown, path: string): unknown {
  if (!isRuntimeInput(input)) {
    return undefined;
  }

  let current: unknown = input;

  for (const segment of getSegments(path)) {
    if (!isRuntimeInput(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function setValueAtPath(input: RuntimeInput, path: string, value: unknown) {
  const segments = getSegments(path);

  if (segments.length === 0) {
    throw new Error("path is required");
  }

  let current: RuntimeInput = input;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];

    if (!isRuntimeInput(existing)) {
      current[segment] = {};
    }

    current = current[segment] as RuntimeInput;
  }

  current[segments[segments.length - 1] as string] = value;
}

export function deleteValueAtPath(input: RuntimeInput, path: string) {
  const segments = getSegments(path);

  if (segments.length === 0) {
    return;
  }

  let current: RuntimeInput = input;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];

    if (!isRuntimeInput(existing)) {
      return;
    }

    current = existing;
  }

  delete current[segments[segments.length - 1] as string];
}

function formatFieldName(field: RuntimeTaskConfigField) {
  return field.label || field.key;
}

function normalizeTextField(field: RuntimeTaskConfigField, value: unknown) {
  if (isMissingValue(value)) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${formatFieldName(field)} must be text`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  const constraints = field.constraints;

  if (constraints?.minLength !== undefined && normalized.length < constraints.minLength) {
    throw new Error(`${formatFieldName(field)} must be at least ${constraints.minLength} characters`);
  }

  if (constraints?.maxLength !== undefined && normalized.length > constraints.maxLength) {
    throw new Error(`${formatFieldName(field)} must be at most ${constraints.maxLength} characters`);
  }

  if (constraints?.pattern && !(new RegExp(constraints.pattern).test(normalized))) {
    throw new Error(`${formatFieldName(field)} is invalid`);
  }

  if (field.kind === "select" && field.options && field.options.length > 0) {
    const allowedValues = new Set(field.options.map((option) => option.value));

    if (!allowedValues.has(normalized)) {
      throw new Error(`${formatFieldName(field)} must be one of: ${[...allowedValues].join(", ")}`);
    }
  }

  return normalized;
}

function normalizeNumberField(field: RuntimeTaskConfigField, value: unknown) {
  if (isMissingValue(value)) {
    return undefined;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`${formatFieldName(field)} must be a number`);
  }

  const constraints = field.constraints;

  if (constraints?.min !== undefined && parsed < constraints.min) {
    throw new Error(`${formatFieldName(field)} must be at least ${constraints.min}`);
  }

  if (constraints?.max !== undefined && parsed > constraints.max) {
    throw new Error(`${formatFieldName(field)} must be at most ${constraints.max}`);
  }

  return parsed;
}

function normalizeBooleanField(field: RuntimeTaskConfigField, value: unknown) {
  if (isMissingValue(value)) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  throw new Error(`${formatFieldName(field)} must be true or false`);
}

function normalizeJsonField(field: RuntimeTaskConfigField, value: unknown) {
  if (isMissingValue(value)) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${formatFieldName(field)} must be valid JSON`);
    }
  }

  if (typeof value === "object") {
    return cloneValue(value);
  }

  throw new Error(`${formatFieldName(field)} must be valid JSON`);
}

function normalizeFieldValue(field: RuntimeTaskConfigField, value: unknown) {
  switch (field.kind) {
    case "text":
    case "textarea":
    case "select":
      return normalizeTextField(field, value);
    case "number":
      return normalizeNumberField(field, value);
    case "boolean":
      return normalizeBooleanField(field, value);
    case "json":
      return normalizeJsonField(field, value);
    default:
      return value;
  }
}

export function validateTaskConfigAgainstSpec(
  spec: RuntimeTaskConfigSpec,
  input: unknown,
  options?: { applyDefaults?: boolean },
): RuntimeInput {
  if (input != null && !isRuntimeInput(input)) {
    throw new Error("runtimeInput must be an object");
  }

  const normalized = isRuntimeInput(input) ? cloneValue(input) : {};
  const applyDefaults = options?.applyDefaults ?? true;

  for (const field of spec.fields) {
    if (applyDefaults && getValueAtPath(normalized, field.path) === undefined && field.defaultValue !== undefined) {
      setValueAtPath(normalized, field.path, cloneValue(field.defaultValue));
    }

    const nextValue = normalizeFieldValue(field, getValueAtPath(normalized, field.path));

    if (nextValue === undefined) {
      deleteValueAtPath(normalized, field.path);
      continue;
    }

    setValueAtPath(normalized, field.path, nextValue);
  }

  return normalized;
}

export function readMissingRequiredPaths(spec: RuntimeTaskConfigSpec, input: unknown) {
  return spec.runnability.requiredPaths.filter((path) => isMissingValue(getValueAtPath(input, path)));
}

export function readRequiredFieldLabel(spec: RuntimeTaskConfigSpec, path: string) {
  return spec.fields.find((field) => field.path === path)?.label ?? path;
}
