export type AiClientType = "llm" | "hermes" | "debug" | "claude_code" | "codex" | (string & {});

export interface AiClientInfo {
  id: string;
  name: string;
  type: AiClientType;
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
  bindings: string[];
  createdAt: string;
}

export type ClientFormPayload = {
  name: string;
  type: AiClientType;
  config: Record<string, unknown>;
  isDefault: boolean;
};

export type ClientFormValues = {
  name: string;
  type: AiClientType;
  isDefault: boolean;
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  configDirectory: string;
  homeDirectory: string;
  codingAgentDirectory: string;
  profileName: string;
  hermesScope: HermesClientScope;
  debugProfile: DebugProviderProfile;
  bindings: string[];
};

export type HermesClientScope = "local" | "remote";
export type DebugProviderProfile = "deterministic" | "tool-submit" | "hermes-like";
export type TestStatus = "idle" | "testing" | "available" | "unavailable";
export type TestResult = { status: TestStatus; reason: string | null };

export type RuntimeProviderInput = {
  key?: unknown;
  label?: string;
  features?: unknown;
};

export type RuntimeProviderOption = {
  key: AiClientType;
  label: string;
  features: string[];
};

export type HermesCheck = {
  key: string;
  status: "ok" | "warning" | "error" | "unknown" | "skipped";
  message: string;
};

export type HermesIntegrationResult = {
  diagnostics: {
    mode: "local" | "remote" | "unknown";
    restartRequired: boolean;
    checks: HermesCheck[];
  };
  plan: {
    summary: string;
    canRunAutomatically: boolean;
    actions: { key: string; kind: "automatic" | "manual"; reason: string; blocked?: boolean }[];
  };
  apiKey?: string;
  maskedApiKey?: string;
  changed?: string[];
  restart?: { ok: boolean; message: string; exitCode: number | null };
};

export type ClientSaveData = { payload: ClientFormPayload; bindings: string[] };
