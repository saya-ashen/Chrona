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
  adapterKey: string;
  version: string;
  fields: RuntimeTaskConfigField[];
  runnability: {
    requiredPaths: string[];
  };
};

export type RuntimeExecutionAdapter = {
  createRun(input: {
    prompt: string;
    runtimeInput: RuntimeInput;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  sendOperatorMessage(input: {
    runtimeSessionKey: string;
    message: string;
  }): Promise<{
    accepted: boolean;
    runtimeRunRef?: string;
    runtimeSessionKey?: string;
    runStarted?: boolean;
  }>;
  getRunSnapshot(input: {
    runtimeRunRef: string;
    runtimeSessionKey?: string;
    timeoutMs?: number;
  }): Promise<unknown>;
  readHistory(input: { runtimeSessionKey: string }): Promise<unknown>;
  listApprovals(input: { runtimeSessionKey: string }): Promise<unknown[]>;
  waitForApprovalDecision(approvalId: string): Promise<unknown | null>;
  resumeRun(input: {
    runtimeSessionKey: string;
    approvalId?: string;
    decision?: "approve" | "reject";
    inputText?: string;
  }): Promise<unknown>;
};

export type RuntimeAdapterDefinition = {
  key: string;
  inputVersion: string;
  getTaskConfigSpec(): RuntimeTaskConfigSpec;
  validateTaskConfig(input: unknown): RuntimeInput;
  createExecutionAdapter(): Promise<RuntimeExecutionAdapter>;
};

