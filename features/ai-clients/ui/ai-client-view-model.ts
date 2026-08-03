import { aiClientsApi } from "../browser-api";
import { providerCapabilityMatrix } from "@chrona/contracts";
import type {
  AiClientInfo,
  AiClientType,
  ClientFormPayload,
  ClientFormValues,
  DebugProviderProfile,
  HermesClientScope,
  HermesIntegrationResult,
  RuntimeProviderInput,
  RuntimeProviderOption,
  TestResult,
  TestStatus,
} from "./ai-client-types";

export const DEFAULT_PROVIDER_RUN_TIMEOUT_MS = 60 * 60 * 1000;
export const LOCAL_HERMES_BASE_URL = "http://127.0.0.1:8642";

const DEBUG_PROVIDER_PROFILES = ["deterministic", "tool-submit", "hermes-like"] as const;
const PROVIDER_SORT_RANK: Record<string, number> = {
  claude_code: 0,
  codex: 1,
  omp: 2,
  llm: 3,
  debug: 4,
  hermes: 99,
};
const RECOMMENDED_FEATURE_ORDER = ["task.plan", "task.execution", "dashboard.brief"];
const DURABLE_RUNTIME_FEATURES = new Set(["goal.review", "task.plan"]);
const FEATURE_COPY: Record<string, { label: string; description: string }> = {
  suggest: { label: "Smart Suggestions", description: "Generate task and schedule suggestions." },
  conflicts: { label: "Conflict Analysis", description: "Analyze schedule conflicts." },
  timeslots: { label: "Timeslot Recommendations", description: "Recommend scheduling windows." },
  chat: { label: "Chat / Plan Generation", description: "Answer task planning chat prompts." },
  "dashboard.brief": { label: "Dashboard Brief", description: "Generate dashboard summaries and focus recommendations." },
  "task.plan": { label: "Task Planning", description: "Generate or refine task plans." },
  "goal.review": { label: "Goal Review", description: "Generate grounded Goal review proposals." },
  "task.execution": { label: "Task Execution", description: "Execute approved task steps." },
};

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function timeoutMs(timeoutSeconds: string): number {
  return Number(timeoutSeconds) * 1000;
}

function buildClaudeCodeConfig(input: ClientFormValues): Record<string, unknown> {
  const model = nonEmpty(input.model);
  const baseUrl = nonEmpty(input.baseUrl);
  const authToken = nonEmpty(input.apiKey);
  const configDirectory = nonEmpty(input.configDirectory);
  const env = Object.fromEntries([
    ["ANTHROPIC_MODEL", model],
    ["ANTHROPIC_BASE_URL", baseUrl],
    ["ANTHROPIC_AUTH_TOKEN", authToken],
    ["CLAUDE_CONFIG_DIR", configDirectory],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined));
  return { model, timeoutMs: timeoutMs(input.timeoutSeconds), configDirectory, profileName: nonEmpty(input.profileName), env: Object.keys(env).length ? env : undefined };
}

function buildCodexConfig(input: ClientFormValues): Record<string, unknown> {
  const configDirectory = nonEmpty(input.configDirectory);
  return {
    model: nonEmpty(input.model), baseUrl: nonEmpty(input.baseUrl), apiKey: nonEmpty(input.apiKey), configDirectory,
    profileName: nonEmpty(input.profileName), env: configDirectory ? { CODEX_HOME: configDirectory } : undefined,
    timeoutMs: timeoutMs(input.timeoutSeconds),
  };
}

function buildOmpConfig(input: ClientFormValues): Record<string, unknown> {
  return {
    model: nonEmpty(input.model), apiKey: nonEmpty(input.apiKey), baseUrl: nonEmpty(input.baseUrl),
    homeDirectory: nonEmpty(input.homeDirectory), configDirectory: nonEmpty(input.configDirectory),
    codingAgentDirectory: nonEmpty(input.codingAgentDirectory), timeoutMs: timeoutMs(input.timeoutSeconds),
  };
}

export function buildClientPayload(input: ClientFormValues): ClientFormPayload {
  const config = input.type === "debug" ? { profile: input.debugProfile }
    : input.type === "claude_code" ? buildClaudeCodeConfig(input)
    : input.type === "codex" ? buildCodexConfig(input)
    : input.type === "omp" ? buildOmpConfig(input)
    : { baseUrl: input.baseUrl || (input.hermesScope === "local" ? LOCAL_HERMES_BASE_URL : ""), apiKey: input.apiKey, timeoutMs: timeoutMs(input.timeoutSeconds), scope: input.type === "hermes" ? input.hermesScope : undefined };
  return { name: input.name, type: input.type, config, isDefault: input.isDefault };
}

export function normalizeDebugProfile(input: unknown): DebugProviderProfile {
  return DEBUG_PROVIDER_PROFILES.includes(input as DebugProviderProfile) ? input as DebugProviderProfile : "deterministic";
}

function hasProviderKey(input: unknown): input is RuntimeProviderInput & { key: AiClientType } {
  if (!input || typeof input !== "object") return false;
  const key = (input as RuntimeProviderInput).key;
  return typeof key === "string" && key.trim().length > 0;
}

export function normalizeRuntimeProviders(input: unknown): RuntimeProviderOption[] {
  const providers = (input as { providers?: unknown[] }).providers ?? [];
  return providers
    .filter((provider): provider is RuntimeProviderInput & { key: AiClientType } => hasProviderKey(provider))
    .map((provider) => ({ key: provider.key, label: typeof provider.label === "string" ? provider.label : provider.key, features: Array.isArray(provider.features) ? provider.features.filter((feature): feature is string => typeof feature === "string") : [] }))
    .sort((left, right) => (PROVIDER_SORT_RANK[left.key] ?? 50) - (PROVIDER_SORT_RANK[right.key] ?? 50));
}

export function isDebugProviderVisible(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PROVIDER === "true";
}

export function getProviderFeatures(providers: RuntimeProviderOption[], type: AiClientType): string[] {
  const durableRuntimeCapable = providerCapabilityMatrix.find((entry) => entry.provider === type)?.recovery.crossProcessDurable === true;
  return (providers.find((provider) => provider.key === type)?.features ?? []).filter(
    (feature) => feature !== "suggest" && (durableRuntimeCapable || !DURABLE_RUNTIME_FEATURES.has(feature)),
  );
}

export function getFeatureCopy(feature: string): { label: string; description: string } {
  return FEATURE_COPY[feature] ?? { label: feature, description: feature };
}

export function recommendedFeatureBindings(features: string[]): string[] {
  const available = new Set(features);
  return RECOMMENDED_FEATURE_ORDER.filter((feature) => available.has(feature));
}

export function sameBindings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getDefaultClientName(type: AiClientType, providers: RuntimeProviderOption[]): string {
  if (type === "llm") return "My OpenAI Compatible Client";
  return `My ${providers.find((provider) => provider.key === type)?.label ?? type} Client`;
}

export function getStatusLabel(copy: Record<string, string>, status: TestStatus): string {
  return status === "testing" ? copy.testing : status === "available" ? copy.available : status === "unavailable" ? copy.unavailable : copy.statusUnknown;
}

export function getStatusVariant(status: TestStatus): "default" | "secondary" | "destructive" | "outline" {
  return status === "available" ? "default" : status === "unavailable" ? "destructive" : status === "testing" ? "secondary" : "outline";
}

export async function testClientAvailability(payload: ClientFormPayload): Promise<TestResult> {
  const data = await aiClientsApi.test(payload);
  return { status: data.available ? "available" : "unavailable", reason: data.reason ?? null };
}

export async function diagnoseHermes(values: ClientFormValues): Promise<HermesIntegrationResult> {
  return aiClientsApi.diagnoseHermes({ baseUrl: values.baseUrl, apiKey: values.apiKey || undefined, timeoutMs: timeoutMs(values.timeoutSeconds) });
}

export async function setupLocalHermes(values: ClientFormValues): Promise<HermesIntegrationResult> {
  return aiClientsApi.setupLocalHermes({ baseUrl: values.baseUrl, apiKey: values.apiKey || undefined, timeoutMs: timeoutMs(values.timeoutSeconds) });
}

export async function restartLocalHermes(): Promise<{ ok: boolean; message: string; exitCode: number | null }> {
  return aiClientsApi.restartLocalHermes();
}

export type { HermesClientScope };

type StoredClientConfig = {
  timeoutSeconds?: number;
  timeoutMs?: number;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  configDirectory?: string;
  homeDirectory?: string;
  codingAgentDirectory?: string;
  profileName?: string;
  scope?: HermesClientScope;
  profile?: unknown;
  env?: Record<string, string>;
};

function configValue(config: StoredClientConfig, key: keyof StoredClientConfig, envKeys: string[] = []): string {
  const direct = config[key];
  if (typeof direct === "string") return direct;
  return envKeys.map((envKey) => config.env?.[envKey]).find((value): value is string => typeof value === "string") ?? "";
}

function initialClientType(initial: AiClientInfo | undefined, providers: RuntimeProviderOption[]): AiClientType {
  const fallback = providers.find((provider) => provider.key === "claude_code")?.key ?? providers[0]?.key ?? "claude_code";
  return initial && providers.some((provider) => provider.key === initial.type) ? initial.type : fallback;
}

function defaultFormConfig(config: StoredClientConfig): Omit<ClientFormValues, "name" | "type" | "isDefault" | "bindings"> {
  return {
    timeoutSeconds: String(config.timeoutSeconds ?? (config.timeoutMs ?? DEFAULT_PROVIDER_RUN_TIMEOUT_MS) / 1000),
    baseUrl: configValue(config, "baseUrl", ["ANTHROPIC_BASE_URL"]),
    apiKey: configValue(config, "apiKey", ["ANTHROPIC_AUTH_TOKEN"]),
    model: configValue(config, "model", ["ANTHROPIC_MODEL"]),
    configDirectory: configValue(config, "configDirectory", ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CONFIG_DIR"]),
    homeDirectory: configValue(config, "homeDirectory", ["HOME"]),
    codingAgentDirectory: configValue(config, "codingAgentDirectory", ["PI_CODING_AGENT_DIR"]),
    profileName: configValue(config, "profileName"),
    hermesScope: config.scope ?? "local", debugProfile: normalizeDebugProfile(config.profile),
  };
}

export function getInitialFormValues(initial: AiClientInfo | undefined, providers: RuntimeProviderOption[], forceDefault: boolean): ClientFormValues {
  const type = initialClientType(initial, providers);
  const config = (initial?.config ?? {}) as StoredClientConfig;
  return {
    ...defaultFormConfig(config),
    name: initial?.name ?? "", type, isDefault: forceDefault || initial?.isDefault || false,
    bindings: initial?.bindings ?? recommendedFeatureBindings(getProviderFeatures(providers, type)),
  };
}
