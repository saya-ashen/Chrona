export type HermesConnectionMode = "local" | "remote" | "unknown";

export type HermesCheckStatus = "ok" | "warning" | "error" | "unknown" | "skipped";

export type HermesCheckKey =
  | "baseUrlScope"
  | "hermesCli"
  | "chronaPluginInstalled"
  | "chronaPluginVersion"
  | "chronaPluginMcpUrl"
  | "hermesEnvFile"
  | "apiServerReachable"
  | "apiKey"
  | "apiCapabilities";

export type HermesSetupActionKey =
  | "installPlugin"
  | "updatePlugin"
  | "updatePluginConfig"
  | "writeApiEnv"
  | "restartHermes"
  | "manualRemoteConfig"
  | "manualInstallHermes"
  | "manualFixApiKey"
  | "manualUpgradeHermes";

export type HermesSetupActionKind = "automatic" | "manual";

export type HermesCheck = {
  key: HermesCheckKey;
  status: HermesCheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type HermesSetupAction = {
  key: HermesSetupActionKey;
  kind: HermesSetupActionKind;
  required: boolean;
  blocked?: boolean;
  reason: string;
};

export type HermesDiagnostics = {
  mode: HermesConnectionMode;
  baseUrl: string;
  mcpUrl: string;
  apiKeyConfigured: boolean;
  canAutoConfigure: boolean;
  restartRequired: boolean;
  checks: HermesCheck[];
};

export type HermesSetupPlan = {
  canRunAutomatically: boolean;
  actions: HermesSetupAction[];
  summary: string;
};

export type HermesIntegrationInput = {
  baseUrl?: string;
  apiKey?: string;
  mcpUrl?: string;
  hermesHome?: string;
  pluginDir?: string;
  timeoutMs?: number;
};

export type HermesLocalSetupInput = HermesIntegrationInput & {
  apiKey: string;
  skipEnable?: boolean;
};
