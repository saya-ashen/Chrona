import type {
  CheckpointForm,
  CheckpointInputFields,
  NodeActionFormField,
} from "@chrona/contracts/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const MAX_SUMMARY_LENGTH = 4_000;
const MAX_TEXT_VALUE_LENGTH = 20_000;

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Manual completion requires a form payload.");
  }
  return payload as Record<string, unknown>;
}

function inputFieldsFromPayload(payload: Record<string, unknown>): CheckpointInputFields {
  const value = payload.inputFields;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Manual completion requires inputFields.");
  }
  const fields: CheckpointInputFields = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (
      typeof fieldValue !== "string"
      && typeof fieldValue !== "boolean"
      && !(Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string"))
    ) {
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${key}' has an invalid value type.`);
    }
    fields[key] = fieldValue;
  }
  return fields;
}

function fieldKind(field: NodeActionFormField) {
  return "kind" in field ? field.kind : field.type === "select" ? "choice" : "text";
}

function isMissing(field: NodeActionFormField, value: CheckpointInputFields[string] | undefined) {
  if (fieldKind(field) === "boolean") return value !== true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== "string" || value.trim().length === 0;
}

function validateText(field: NodeActionFormField, value: CheckpointInputFields[string] | undefined) {
  if (value === undefined || value === "") return;
  if (typeof value !== "string") {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' must be text.`);
  }
  if (value.length > MAX_TEXT_VALUE_LENGTH) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' is too long.`);
  }
}

function choiceRules(field: NodeActionFormField) {
  if ("kind" in field && field.kind === "choice") {
    return {
      selection: field.selection,
      values: new Set(field.options.map((option) => option.value)),
      min: field.minSelections,
      max: field.maxSelections,
    };
  }
  if (!("kind" in field) && field.type === "select") {
    return { selection: "single" as const, values: new Set(field.options ?? []), min: undefined, max: undefined };
  }
  return null;
}

function validateChoice(field: NodeActionFormField, value: CheckpointInputFields[string] | undefined) {
  const rules = choiceRules(field);
  if (!rules || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  if (selected.length === 0 || selected.some((item) => !rules.values.has(item))) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' contains an invalid choice.`);
  }
  if (rules.selection === "single" && selected.length !== 1) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' accepts one choice.`);
  }
  if (rules.min !== undefined && selected.length < rules.min) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' requires at least ${rules.min} choices.`);
  }
  if (rules.max !== undefined && selected.length > rules.max) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' accepts at most ${rules.max} choices.`);
  }
}

function validateBoolean(field: NodeActionFormField, value: CheckpointInputFields[string] | undefined) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Field '${field.label}' must be true or false.`);
  }
}

function displayValue(value: CheckpointInputFields[string]) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "boolean" ? (value ? "Yes" : "No") : value.trim();
}

export function validateManualCompletionSubmission(input: {
  form: CheckpointForm;
  payload: unknown;
}): { inputFields: CheckpointInputFields; summary: string } {
  const payload = payloadRecord(input.payload);
  if (!input.form.revision || payload.formRevision !== input.form.revision) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "The manual completion form changed. Refresh the task and submit the current form.",
    );
  }

  const inputFields = inputFieldsFromPayload(payload);
  const allowed = new Set(input.form.inputFields.map((field) => field.name));
  const unknown = Object.keys(inputFields).find((key) => !allowed.has(key));
  if (unknown) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Unknown manual completion field '${unknown}'.`);
  }

  for (const field of input.form.inputFields) {
    const value = inputFields[field.name];
    if (("required" in field && field.required) && isMissing(field, value)) {
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Complete required field '${field.label}'.`);
    }
    const kind = fieldKind(field);
    if (kind === "text") validateText(field, value);
    if (kind === "choice") validateChoice(field, value);
    if (kind === "boolean") validateBoolean(field, value);
  }

  const summary = input.form.inputFields
    .flatMap((field) => {
      const value = inputFields[field.name];
      return value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
        ? []
        : [`${field.label}: ${displayValue(value)}`];
    })
    .join("\n")
    .slice(0, MAX_SUMMARY_LENGTH);

  return { inputFields, summary: summary || "Manual step completed." };
}
