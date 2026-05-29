import { HermesProviderClient } from "@chrona/hermes";

import { readHermesEnv } from "./env-file.js";
import {
  DEFAULT_CHRONA_MCP_URL,
  getBundledHermesPluginVersion,
  getHermesPluginDir,
  getInstalledHermesPluginVersion,
  isHermesCliAvailable,
  isHermesPluginInstalled,
  readHermesPluginConfig,
} from "./plugin.js";
import type { HermesCheck, HermesConnectionMode, HermesDiagnostics, HermesIntegrationInput } from "./types.js";

const DEFAULT_HERMES_BASE_URL = "http://127.0.0.1:8642";
const localAutoFixableChecks = ["chronaPluginInstalled", "chronaPluginVersion", "chronaPluginMcpUrl", "hermesEnvFile"];
const skippedRemoteChecks = ["hermesCli", "chronaPluginInstalled", "chronaPluginVersion", "chronaPluginMcpUrl", "hermesEnvFile"] as const;

const HERMES_REQUIRED_CAPABILITIES = [
  { key: "run_submission", label: "run submission (/v1/runs)" },
  { key: "run_status", label: "run status (/v1/runs/{run_id})" },
  { key: "run_events_sse", label: "run event streaming (/v1/runs/{run_id}/events)" },
  { key: "run_stop", label: "run cancellation (/v1/runs/{run_id}/stop)" },
] as const;

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function localModeFromBaseUrl(baseUrl: string): HermesConnectionMode {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return "local";
    if (host) return "remote";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function getMissingCapabilities(raw: unknown): string[] {
  const health = unknownRecord(raw);
  const capabilities = unknownRecord(health?.capabilities);
  const features = unknownRecord(capabilities?.features);

  return HERMES_REQUIRED_CAPABILITIES.filter(
    (capability) => features?.[capability.key] !== true,
  ).map((capability) => capability.label);
}

function addCheck(checks: HermesCheck[], check: HermesCheck): void {
  checks.push(check);
}

function getBaseUrlScopeMessage(mode: HermesConnectionMode): string {
  if (mode === "local") return "Hermes base URL points to this machine.";
  if (mode === "remote") return "Hermes base URL points to a remote machine. Local auto-configuration is disabled.";
  return "Hermes base URL could not be classified as local or remote.";
}

function addPluginChecks(checks: HermesCheck[], input: HermesIntegrationInput, mcpUrl: string): void {
  const pluginDir = getHermesPluginDir({ hermesHome: input.hermesHome, pluginDir: input.pluginDir });
  const pluginInstalled = isHermesPluginInstalled(pluginDir);
  addCheck(checks, {
    key: "chronaPluginInstalled",
    status: pluginInstalled ? "ok" : "error",
    message: pluginInstalled ? "Chrona Hermes plugin is installed." : "Chrona Hermes plugin is not installed.",
    details: { pluginDir },
  });

  if (!pluginInstalled) return;
  addPluginVersionCheck(checks, pluginDir);
  addPluginMcpUrlCheck(checks, pluginDir, mcpUrl);
}

function addPluginVersionCheck(checks: HermesCheck[], pluginDir: string): void {
  const installedVersion = getInstalledHermesPluginVersion(pluginDir);
  const bundledVersion = getBundledHermesPluginVersion();
  addCheck(checks, {
    key: "chronaPluginVersion",
    status: installedVersion === bundledVersion ? "ok" : "warning",
    message: installedVersion === bundledVersion
      ? `Chrona Hermes plugin version is current (${bundledVersion}).`
      : `Chrona Hermes plugin version is ${installedVersion ?? "unknown"}; bundled version is ${bundledVersion}.`,
    details: { installedVersion, bundledVersion },
  });
}

function addPluginMcpUrlCheck(checks: HermesCheck[], pluginDir: string, mcpUrl: string): void {
  const pluginConfig = readHermesPluginConfig(pluginDir);
  addCheck(checks, {
    key: "chronaPluginMcpUrl",
    status: pluginConfig?.mcpUrl === mcpUrl ? "ok" : "warning",
    message: pluginConfig?.mcpUrl === mcpUrl
      ? "Chrona Hermes plugin MCP URL matches this Chrona server."
      : `Chrona Hermes plugin MCP URL is ${pluginConfig?.mcpUrl ?? "not configured"}; expected ${mcpUrl}.`,
    details: { configuredMcpUrl: pluginConfig?.mcpUrl, expectedMcpUrl: mcpUrl },
  });
}

function getHermesEnvCheckMessage(apiEnabled: boolean, keyConfigured: boolean, keyMatches: boolean): string {
  if (apiEnabled && keyMatches) return "Hermes .env enables the API server and matches the configured API key.";
  if (!apiEnabled && !keyConfigured) return "Hermes .env should contain API_SERVER_ENABLED=true and API_SERVER_KEY matching Chrona.";
  if (!apiEnabled) return "Hermes .env has an API key, but API_SERVER_ENABLED should be true.";
  if (!keyConfigured) return "Hermes .env enables the API server, but API_SERVER_KEY is missing.";
  return "Hermes .env enables the API server, but API_SERVER_KEY does not match the configured Chrona API key.";
}

function addHermesEnvCheck(checks: HermesCheck[], input: HermesIntegrationInput, effectiveApiKey: string | undefined): void {
  const env = readHermesEnv(input.hermesHome);
  const apiEnabled = env.API_SERVER_ENABLED === "true";
  const keyConfigured = Boolean(env.API_SERVER_KEY);
  const keyMatches = Boolean(effectiveApiKey && env.API_SERVER_KEY === effectiveApiKey);
  addCheck(checks, {
    key: "hermesEnvFile",
    status: apiEnabled && keyMatches ? "ok" : "warning",
    message: getHermesEnvCheckMessage(apiEnabled, keyConfigured, keyMatches),
    details: {
      apiServerEnabled: apiEnabled,
      apiServerKeyConfigured: keyConfigured,
      apiServerKeyMatches: keyMatches,
      apiServerKeyUsedForDiagnostics: Boolean(effectiveApiKey && !input.apiKey),
    },
  });
}

function addLocalEnvironmentChecks(
  checks: HermesCheck[],
  input: HermesIntegrationInput,
  effectiveApiKey: string | undefined,
  mcpUrl: string,
): void {
  const hermesCliAvailable = isHermesCliAvailable();
  addCheck(checks, {
    key: "hermesCli",
    status: hermesCliAvailable ? "ok" : "error",
    message: hermesCliAvailable
      ? "Hermes CLI found locally."
      : "Hermes CLI was not found locally. Install Hermes or configure a remote base URL.",
  });
  addPluginChecks(checks, input, mcpUrl);
  addHermesEnvCheck(checks, input, effectiveApiKey);
}

function addSkippedLocalChecks(checks: HermesCheck[]): void {
  for (const key of skippedRemoteChecks) {
    addCheck(checks, {
      key,
      status: "skipped",
      message: "Skipped for remote Hermes. Configure the remote machine manually.",
    });
  }
}

function isAuthFailure(message: string): boolean {
  return message.toLowerCase().includes("token") || message.includes("401") || message.includes("403");
}

function addSuccessfulApiChecks(checks: HermesCheck[], apiKey: string | undefined, raw: unknown): void {
  const missing = getMissingCapabilities(raw);
  addCheck(checks, {
    key: "apiCapabilities",
    status: missing.length === 0 ? "ok" : "error",
    message: missing.length === 0
      ? "Hermes API server exposes required Chrona capabilities."
      : `Hermes API server is missing required capabilities: ${missing.join(", ")}.`,
    details: { missing },
  });
  addCheck(checks, {
    key: "apiKey",
    status: "ok",
    message: apiKey ? "Hermes API accepted the configured API key." : "Hermes API is reachable without an API key.",
  });
}

function addFailedApiChecks(checks: HermesCheck[], apiKey: string | undefined, message: string): void {
  const authFailure = isAuthFailure(message);
  addCheck(checks, {
    key: "apiKey",
    status: authFailure ? "error" : "unknown",
    message: authFailure
      ? apiKey
        ? "Hermes API rejected the configured API key."
        : "Hermes API requires an API key. Configure Chrona with the same API_SERVER_KEY used by Hermes."
      : "Hermes API key could not be verified until the API server is reachable.",
  });
  addCheck(checks, {
    key: "apiCapabilities",
    status: "unknown",
    message: "Hermes capabilities could not be verified until the API server is reachable.",
  });
}

async function addApiChecks(checks: HermesCheck[], input: HermesIntegrationInput, baseUrl: string, timeoutMs: number): Promise<void> {
  const health = await new HermesProviderClient({ baseUrl, apiKey: input.apiKey, timeoutMs }).checkHealth({ deep: true, timeoutMs });

  addCheck(checks, {
    key: "apiServerReachable",
    status: health.ok ? "ok" : "error",
    message: health.ok
      ? (health.reason ?? health.message ?? "Hermes API server is reachable.")
      : (health.reason ?? health.message ?? "Hermes API server is not reachable."),
    details: { status: health.status, raw: health.raw },
  });

  if (health.ok) addSuccessfulApiChecks(checks, input.apiKey, health.raw);
  else addFailedApiChecks(checks, input.apiKey, health.reason ?? health.message ?? "Hermes API health check failed.");
}

function hasLocalAutoFixableIssue(checks: HermesCheck[]): boolean {
  return checks.some((check) =>
    localAutoFixableChecks.includes(check.key) && check.status !== "ok" && check.status !== "skipped",
  );
}

export async function detectHermesEnvironment(input: HermesIntegrationInput = {}): Promise<HermesDiagnostics> {
  const baseUrl = input.baseUrl || DEFAULT_HERMES_BASE_URL;
  const mcpUrl = input.mcpUrl || process.env.CHRONA_MCP_URL || DEFAULT_CHRONA_MCP_URL;
  const timeoutMs = input.timeoutMs ?? 5_000;
  const mode = localModeFromBaseUrl(baseUrl);
  const envApiKey = mode === "local" ? readHermesEnv(input.hermesHome).API_SERVER_KEY?.trim() || undefined : undefined;
  const effectiveInput = { ...input, apiKey: input.apiKey ?? envApiKey };
  const checks: HermesCheck[] = [];

  addCheck(checks, {
    key: "baseUrlScope",
    status: mode === "unknown" ? "warning" : "ok",
    message: getBaseUrlScopeMessage(mode),
    details: { baseUrl },
  });

  if (mode === "local") addLocalEnvironmentChecks(checks, input, effectiveInput.apiKey, mcpUrl);
  else addSkippedLocalChecks(checks);

  await addApiChecks(checks, effectiveInput, baseUrl, timeoutMs);

  return {
    mode,
    baseUrl,
    mcpUrl,
    apiKeyConfigured: Boolean(effectiveInput.apiKey),
    canAutoConfigure: mode === "local" && hasLocalAutoFixableIssue(checks),
    restartRequired: checks.some((check) => check.key === "hermesEnvFile" && check.status !== "ok"),
    checks,
  };
}
