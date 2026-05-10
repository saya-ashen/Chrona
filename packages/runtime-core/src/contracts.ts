export type RuntimeInput = Record<string, unknown>;

export type RuntimeTaskConfigFieldKind =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "boolean"
  | "json";

export type RuntimeTaskConfigFieldOption = {
  value: string;
  label: string;
};

export type RuntimeTaskConfigFieldVisibilityRule = {
  path: string;
  op: "eq" | "in";
  value: unknown;
};

export type RuntimeTaskConfigFieldConstraints = {
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type RuntimeTaskConfigField = {
  key: string;
  path: string;
  kind: RuntimeTaskConfigFieldKind;
  label: string;
  description?: string;
  required?: boolean;
  advanced?: boolean;
  defaultValue?: unknown;
  options?: RuntimeTaskConfigFieldOption[];
  visibleWhen?: RuntimeTaskConfigFieldVisibilityRule[];
  constraints?: RuntimeTaskConfigFieldConstraints;
};

export type RuntimeTaskConfigSpec = {
  runtime: string;
  version: string;
  fields: RuntimeTaskConfigField[];
  runnability: {
    requiredPaths: string[];
  };
};

export type RuntimeAdapterDefinition = {
  key: string;
  inputVersion: string;
  getTaskConfigSpec(): RuntimeTaskConfigSpec;
  validateTaskConfig(input: unknown): RuntimeInput;
};
