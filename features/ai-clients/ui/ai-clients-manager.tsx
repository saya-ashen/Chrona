"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useI18n } from "@chrona/i18n/react";
import { providerCapabilityMatrix, type ProviderCapabilityMatrixEntry, type ProviderCapabilityName } from "@chrona/providers-foundation/capability-matrix";
import { deriveAutomationReadiness } from "@chrona/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/rpc-client";
import { notifyAiClientsChanged } from "@/lib/ai-client-events";

const DEFAULT_PROVIDER_RUN_TIMEOUT_MS = 30 * 60 * 1000;

type AiClientType = "llm" | "hermes" | "debug" | "claude_code" | "codex" | (string & {});

interface AiClientInfo {
  id: string;
  name: string;
  type: AiClientType;
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
  bindings: string[];
  createdAt: string;
}

type ClientFormPayload = {
  name: string;
  type: AiClientType;
  config: Record<string, unknown>;
  isDefault: boolean;
};

type RuntimeProviderInput = {
  key?: unknown;
  label?: string;
  features?: unknown;
};

type ClientFormValues = {
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

type HermesClientScope = "local" | "remote";

type DebugProviderProfile = "deterministic" | "tool-submit" | "hermes-like";

const DEBUG_PROVIDER_PROFILES = [
  "deterministic",
  "tool-submit",
  "hermes-like",
] as const satisfies readonly DebugProviderProfile[];

function normalizeDebugProfile(input: unknown): DebugProviderProfile {
  return DEBUG_PROVIDER_PROFILES.includes(input as DebugProviderProfile)
    ? input as DebugProviderProfile
    : "deterministic";
}

type TestStatus = "idle" | "testing" | "available" | "unavailable";

type TestResult = {
  status: TestStatus;
  reason: string | null;
};
type ReadinessState = "ready" | "limited" | "warning" | "pending";

type ReadinessItem = {
  key: "overall" | "configured" | "reachable" | "execution" | "recovery";
  label: string;
  state: ReadinessState;
  detail: string;
};


type RuntimeProviderOption = {
  key: AiClientType;
  label: string;
  features: string[];
};

const LOCAL_HERMES_BASE_URL = "http://127.0.0.1:8642";

type HermesCheck = {
  key: string;
  status: "ok" | "warning" | "error" | "unknown" | "skipped";
  message: string;
};

type HermesSetupAction = {
  key: string;
  kind: "automatic" | "manual";
  reason: string;
  blocked?: boolean;
};

type HermesIntegrationResult = {
  diagnostics: {
    mode: "local" | "remote" | "unknown";
    restartRequired: boolean;
    checks: HermesCheck[];
  };
  plan: {
    summary: string;
    canRunAutomatically: boolean;
    actions: HermesSetupAction[];
  };
  apiKey?: string;
  maskedApiKey?: string;
  changed?: string[];
  restart?: { ok: boolean; message: string; exitCode: number | null };
};

function nonEmptyEnvValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildClaudeCodeConfig(input: {
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  configDirectory: string;
  profileName: string;
}): Record<string, unknown> {
  const model = nonEmptyEnvValue(input.model);
  const baseUrl = nonEmptyEnvValue(input.baseUrl);
  const authToken = nonEmptyEnvValue(input.apiKey);
  const configDirectory = nonEmptyEnvValue(input.configDirectory);
  const profileName = nonEmptyEnvValue(input.profileName);
  const env: Record<string, string> = {};

  if (model) env.ANTHROPIC_MODEL = model;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
  if (configDirectory) env.CLAUDE_CONFIG_DIR = configDirectory;

  return {
    model,
    timeoutMs: Number(input.timeoutSeconds) * 1000,
    configDirectory,
    profileName,
    env: Object.keys(env).length > 0 ? env : undefined,
  };
}

function buildCodexConfig(input: {
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  configDirectory: string;
  profileName: string;
}): Record<string, unknown> {
  const configDirectory = nonEmptyEnvValue(input.configDirectory);
  const env: Record<string, string> = {};

  if (configDirectory) env.CODEX_HOME = configDirectory;

  return {
    model: nonEmptyEnvValue(input.model),
    baseUrl: nonEmptyEnvValue(input.baseUrl),
    apiKey: nonEmptyEnvValue(input.apiKey),
    configDirectory,
    profileName: nonEmptyEnvValue(input.profileName),
    env: Object.keys(env).length > 0 ? env : undefined,
    timeoutMs: Number(input.timeoutSeconds) * 1000,
  };
}

function buildOmpConfig(input: {
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  homeDirectory: string;
  configDirectory: string;
  codingAgentDirectory: string;
}): Record<string, unknown> {
  return {
    model: nonEmptyEnvValue(input.model),
    apiKey: nonEmptyEnvValue(input.apiKey),
    baseUrl: nonEmptyEnvValue(input.baseUrl),
    homeDirectory: nonEmptyEnvValue(input.homeDirectory),
    configDirectory: nonEmptyEnvValue(input.configDirectory),
    codingAgentDirectory: nonEmptyEnvValue(input.codingAgentDirectory),
    timeoutMs: Number(input.timeoutSeconds) * 1000,
  };
}

function buildClientPayload(input: {
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
}): ClientFormPayload {
  if (input.type === "debug") {
    return {
      name: input.name,
      type: input.type,
      config: { profile: input.debugProfile },
      isDefault: input.isDefault,
    };
  }

  if (input.type === "claude_code") {
    return {
      name: input.name,
      type: input.type,
      config: buildClaudeCodeConfig(input),
      isDefault: input.isDefault,
    };
  }

  if (input.type === "codex") {
    return {
      name: input.name,
      type: input.type,
      config: buildCodexConfig(input),
      isDefault: input.isDefault,
    };
  }

  if (input.type === "omp") {
    return {
      name: input.name,
      type: input.type,
      config: buildOmpConfig(input),
      isDefault: input.isDefault,
    };
  }

  return {
    name: input.name,
    type: input.type,
    config: {
      baseUrl: input.baseUrl || (input.hermesScope === "local" ? LOCAL_HERMES_BASE_URL : ""),
      apiKey: input.apiKey,
      timeoutMs: Number(input.timeoutSeconds) * 1000,
      scope: input.type === "hermes" ? input.hermesScope : undefined,
    },
    isDefault: input.isDefault,
  };
}

function isDebugProviderVisible() {
  return (
    import.meta.env.DEV
    || import.meta.env.VITE_ENABLE_DEBUG_PROVIDER === "true"
  );
}

const PROVIDER_SORT_RANK: Record<string, number> = {
  claude_code: 0,
  codex: 1,
  omp: 2,
  llm: 3,
  debug: 4,
  hermes: 99,
};

function providerSortRank(key: string) {
  return PROVIDER_SORT_RANK[key] ?? 50;
}

function normalizeRuntimeProviders(input: unknown): RuntimeProviderOption[] {
  const providers = (input as { providers?: unknown[] }).providers ?? [];
  return providers
    .filter((provider): provider is RuntimeProviderInput & { key: AiClientType } => {
      const key = (provider as { key?: unknown }).key;
      return typeof key === "string" && key.trim().length > 0;
    })
    .map((provider) => ({
      key: provider.key,
      label: typeof provider.label === "string" ? provider.label : provider.key,
      features: Array.isArray(provider.features) ? provider.features.filter((feature): feature is string => typeof feature === "string") : [],
    }))
    .sort((left, right) => providerSortRank(left.key) - providerSortRank(right.key));
}

async function testClientAvailability(payload: ClientFormPayload): Promise<TestResult> {
  const res = await api.ai.clients.test.$post({ json: payload });

  const data = (await res.json()) as { available?: boolean; reason?: string; error?: string };
  return {
    status: data.available ? "available" : "unavailable",
    reason: data.reason ?? null,
  };
}

async function diagnoseHermes(values: ClientFormValues): Promise<HermesIntegrationResult> {
  const res = await api.integrations.hermes.diagnose.$post({
    json: {
      baseUrl: values.baseUrl,
      apiKey: values.apiKey || undefined,
      timeoutMs: Number(values.timeoutSeconds) * 1000,
    },
  });
  const data = (await res.json()) as HermesIntegrationResult & { error?: string };
  return data;
}

async function setupLocalHermes(values: ClientFormValues): Promise<HermesIntegrationResult> {
  const res = await api.integrations.hermes["setup-local"].$post({
    json: {
      baseUrl: values.baseUrl,
      apiKey: values.apiKey || undefined,
      timeoutMs: Number(values.timeoutSeconds) * 1000,
    },
  });
  const data = (await res.json()) as HermesIntegrationResult & { error?: string };
  return data;
}

async function restartLocalHermes(): Promise<{ ok: boolean; message: string; exitCode: number | null }> {
  const res = await api.integrations.hermes["restart-local"].$post();
  const data = (await res.json()) as { ok: boolean; message: string; exitCode: number | null; error?: string };
  return data;
}

function getStatusLabel(copy: Record<string, string>, status: TestStatus) {
  switch (status) {
    case "testing":
      return copy.testing;
    case "available":
      return copy.available;
    case "unavailable":
      return copy.unavailable;
    case "idle":
      return copy.statusUnknown;
    default:
      return copy.statusUnknown;
  }
}

function getStatusVariant(status: TestStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "available":
      return "default";
    case "unavailable":
      return "destructive";
    case "testing":
      return "secondary";
    case "idle":
    default:
      return "outline";
  }
}
const EXECUTION_CAPABILITY_CHECKS: ProviderCapabilityName[] = [
  "healthCheck",
  "startRun",
  "streamEvents",
  "cancelActiveRun",
  "toolTraces",
  "structuredOutput",
];
function providerMatrixEntry(type: AiClientType) {
  return providerCapabilityMatrix.find((entry) => entry.provider === type);
}

function recoveryReadiness(matrix: ProviderCapabilityMatrixEntry | undefined, copy: Record<string, string>): ReadinessItem {
  if (!matrix) {
    return {
      key: "recovery",
      label: copy.readinessRecovery,
      state: "warning",
      detail: copy.readinessCapabilityUnknown,
    };
  }

  const recovery = matrix.recovery;
  if (!recovery.sessionResume && !recovery.historyReplay) {
    return {
      key: "recovery",
      label: copy.readinessRecovery,
      state: "warning",
      detail: copy.recoveryUnavailable,
    };
  }
  if (recovery.streamReconnect) {
    return {
      key: "recovery",
      label: copy.readinessRecovery,
      state: "ready",
      detail: copy.recoveryFull,
    };
  }
  if (recovery.activeRunLookup) {
    return {
      key: "recovery",
      label: copy.readinessRecovery,
      state: "limited",
      detail: copy.recoverySnapshotOnly,
    };
  }
  return {
    key: "recovery",
    label: copy.readinessRecovery,
    state: "limited",
    detail: copy.recoverySessionHistory,
  };
}
function hasBasicConfig(type: AiClientType, values: Pick<ClientFormValues, "baseUrl" | "timeoutSeconds" | "hermesScope">) {
  if (type === "hermes" && values.hermesScope === "remote") return Boolean(values.baseUrl.trim());
  return Number(values.timeoutSeconds) > 0;
}

function readinessItems(input: {
  copy: Record<string, string>;
  type: AiClientType;
  configured: boolean;
  enabled: boolean;
  testStatus: TestStatus;
  testReason: string | null;
  bindings: string[];
}): ReadinessItem[] {
  const matrix = providerMatrixEntry(input.type);
  const missingExecution = matrix
    ? EXECUTION_CAPABILITY_CHECKS.filter((capability) => !matrix.capabilities[capability])
    : [];
  const canonical = deriveAutomationReadiness({
    providerId: input.configured ? input.type : null,
    providerConfigured: input.configured && input.enabled,
    providerTested: input.testStatus !== "idle",
    providerReachable: input.testStatus === "available",
    planningCapable: input.bindings.some((binding) => binding === "generate_plan" || binding === "generatePlan" || binding === "task.plan"),
    executionCapable: input.bindings.some((binding) => binding === "task.execution" || binding === "execute"),
    requiresPlanning: true,
    autoExecute: true,
    hasAcceptedPlan: true,
    scheduledStartAt: new Date(0),
  });
  return [
    {
      key: "overall",
      label: canonical.readiness === "ready" ? input.copy.ready : input.copy.needsAttention,
      state: canonical.readiness === "ready" ? "ready" : "pending",
      detail: canonical.disabledReason ?? input.copy.readinessCapabilityDetail,
    },
    {
      key: "configured",
      label: input.copy.readinessConfigured,
      state: input.configured && input.enabled ? "ready" : "pending",
      detail: input.enabled ? input.copy.readinessConfiguredDetail : input.copy.readinessDisabledDetail,
    },
    {
      key: "reachable",
      label: input.copy.readinessReachable,
      state: input.testStatus === "available" ? "ready" : input.testStatus === "unavailable" ? "warning" : "pending",
      detail: input.testStatus === "available" ? input.copy.readinessReachableDetail : input.testReason ?? input.copy.readinessRunHealthCheck,
    },
    {
      key: "execution",
      label: input.copy.readinessCapability,
      state: matrix && missingExecution.length === 0 ? "ready" : "warning",
      detail: matrix
        ? missingExecution.length === 0
          ? input.copy.readinessCapabilityDetail
          : `${input.copy.readinessCapabilityLimited}: ${missingExecution.join(", ")}`
        : input.copy.readinessCapabilityUnknown,
    },
    recoveryReadiness(matrix, input.copy),
  ];
}

function ReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/20 p-3" aria-label="Provider readiness">
      {items.map((item) => (
        <div key={item.key} className="flex items-start gap-2 text-xs">
          <Badge variant={item.state === "ready" ? "default" : item.state === "warning" ? "destructive" : item.state === "limited" ? "outline" : "secondary"}>{item.label}</Badge>
          <span className="min-w-0 text-muted-foreground">{item.detail}</span>
        </div>
      ))}
    </div>
  );
}


const FEATURE_COPY: Record<string, { label: string; description: string }> = {
  suggest: {
    label: "Smart Suggestions",
    description: "Generate task and schedule suggestions.",
  },
  generate_plan: {
    label: "Task Plan Generation",
    description: "Generate structured task plans.",
  },
  generatePlan: {
    label: "Task Plan Generation",
    description: "Generate structured task plans.",
  },
  conflicts: {
    label: "Conflict Analysis",
    description: "Analyze schedule conflicts.",
  },
  timeslots: {
    label: "Timeslot Recommendations",
    description: "Recommend scheduling windows.",
  },
  chat: {
    label: "Chat / Plan Generation",
    description: "Answer task planning chat prompts.",
  },
  "dashboard.brief": {
    label: "Dashboard Brief",
    description: "Generate dashboard summaries and focus recommendations.",
  },
  "task.plan": {
    label: "Task Planning",
    description: "Generate or refine task plans.",
  },
  "task.execution": {
    label: "Task Execution",
    description: "Execute approved task steps.",
  },
};

function getFeatureCopy(feature: string) {
  return FEATURE_COPY[feature] ?? { label: feature, description: feature };
}

function getProviderFeatures(providers: RuntimeProviderOption[], type: AiClientType) {
  return providers.find((provider) => provider.key === type)?.features ?? [];
}

const RECOMMENDED_FEATURE_ORDER = ["task.plan", "task.execution", "dashboard.brief"];

function recommendedFeatureBindings(features: string[]) {
  const available = new Set(features);
  return RECOMMENDED_FEATURE_ORDER.filter((feature) => available.has(feature));
}

function sameBindings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function getDefaultClientName(type: AiClientType, providers: RuntimeProviderOption[]) {
  if (type === "llm") return "My OpenAI Compatible Client";

  const label = providers.find((provider) => provider.key === type)?.label ?? type;
  return `My ${label} Client`;
}

async function updateClientBindings(clientId: string, features: string[]) {
  const res = await api.ai.clients[":clientId"].bindings.$put({
    param: { clientId },
    json: { features },
  });
  const data = (await res.json()) as { bindings?: string[] };
  return data.bindings ?? features;
}
const DEFAULTS: Record<string, string> = {
  title: "AI Clients",
  subtitle: "Connect an AI client so Chrona can plan tasks and safely execute approved work.",
  addClient: "+ Add Client",
  emptyState: "No AI client is connected yet. Connect one to unlock planning, suggestions, and execution previews.",
  emptyStateCta: "Connect AI Client",
  hermesIntro: "Hermes is Chrona's local AI runtime. It generates task plans, proposes schedule changes, and only executes after your approval.",
  loading: "Loading...",
  defaultBadge: "Default",
  enabled: "Enabled",
  edit: "Edit",
  delete: "Delete",
  nameLabel: "Name",
  typeLabel: "Type",
  llmCompatible: "LLM (OpenAI Compatible)",
  hermes: "Hermes",
  timeoutSeconds: "Timeout (seconds)",
  modelLabel: "Model",
  debug: "Debug Provider",
  debugProfileLabel: "Debug profile",
  debugProfileDeterministic: "Deterministic",
  debugProfileToolSubmit: "Tool submit",
  debugProfileHermesLike: "Hermes-like",
  hermesScopeLabel: "Hermes location",
  hermesScopeLocal: "Local Hermes",
  hermesScopeRemote: "Remote Hermes",
  hermesLocalDescription: "Local mode can install the Chrona Hermes plugin and enable the Hermes API server on this machine.",
  hermesRemoteDescription: "Remote mode will not touch local files. Configure the remote Hermes machine manually, then test availability here.",
  hermesRestartDescription: "Restart Hermes if you changed the plugin, enabled the API server, or updated the API key. Chrona can run hermes gateway restart, but it may not know your original gateway startup options; restart it yourself if that is clearer. Running tasks may pause briefly during restart.",
  remoteBaseUrlRequired: "Remote Hermes base URL is required",
  diagnoseHermes: "Diagnose Hermes",
  autoConfigureHermes: "Auto-configure local Hermes",
  restartHermes: "Restart Hermes gateway",
  restartHermesRequested: "Hermes restart requested.",
  hermesDiagnosticsTitle: "Hermes diagnostics",
  hermesPlanTitle: "Setup plan",
  hermesChangedTitle: "Changed",
  hermesRestartRequired: "Restart Hermes, then run diagnosis again.",
  setAsDefault: "Use as default AI client",
  setAsDefaultHelp: "Chrona uses the default client for planning, execution, and summaries unless a feature has its own client.",
  makeDefault: "Make default",
  save: "Save",
  cancel: "Cancel",
  testAvailability: "Test availability",
  testing: "Testing...",
  available: "Available",
  unavailable: "Unavailable",
  statusUnknown: "Not tested",
  reasonUnknown: "No details yet",
  ready: "Ready",
  needsAttention: "Needs attention",
  readinessConfigured: "Configured",
  readinessReachable: "Reachable",
  readinessCapability: "Can run tasks",
  readinessRecovery: "Interruption recovery",
  readinessConfiguredDetail: "Client is enabled and required settings are complete.",
  readinessDisabledDetail: "Client is disabled or required settings are missing.",
  readinessReachableDetail: "Provider health check passed.",
  readinessRunHealthCheck: "Click “Test availability” to confirm this provider is reachable.",
  readinessCapabilityDetail: "Supports task start, live progress, stop, tool use, and structured result validation.",
  readinessCapabilityLimited: "Provider execution support incomplete",
  readinessCapabilityUnknown: "Provider capability matrix is not registered.",
  recoveryFull: "Can reconnect to an active task and sync the final state.",
  recoverySnapshotOnly: "Can sync run state; live progress is not replayed after disconnect.",
  recoverySessionHistory: "Session context is saved; if execution is interrupted, retry this step to continue.",
  recoveryUnavailable: "Interrupted runs cannot be recovered automatically.",
  advancedSettings: "Advanced settings",
  advancedSettingsHelp: "Provider endpoints, model overrides, directories, timeouts, and capability assignment.",
};

function getCopy(messages: Record<string, unknown>): Record<string, string> {
  const section = (messages.pages as Record<string, Record<string, string>> | undefined)?.aiClientsPage ?? {};
  return { ...DEFAULTS, ...section };
}

function ClientForm({
  initial,
  onSave,
  onCancel,
  copy,
  providers,
  forceDefault = false,
}: {
  initial?: AiClientInfo;
  onSave: (data: { payload: ClientFormPayload; bindings: string[] }) => void;
  onCancel: () => void;
  copy: Record<string, string>;
  providers: RuntimeProviderOption[];
  forceDefault?: boolean;
}) {
  const fallbackType = providers.find((provider) => provider.key === "claude_code")?.key ?? providers[0]?.key ?? "claude_code";
  const initialConfig = initial?.config;
  const initialType = initial && providers.some((provider) => provider.key === initial.type) ? initial.type : fallbackType;
  const initialRecommendedBindings = useMemo(
    () => recommendedFeatureBindings(getProviderFeatures(providers, initialType)),
    [providers, initialType],
  );
  const defaultValues = useMemo<ClientFormValues>(() => ({
    name: initial?.name ?? "",
    type: initialType,
    isDefault: forceDefault || initial?.isDefault || false,
    timeoutSeconds: String(
      (initialConfig as { timeoutSeconds?: number; timeoutMs?: number } | undefined)?.timeoutSeconds
        ?? (((initialConfig as { timeoutMs?: number } | undefined)?.timeoutMs ?? DEFAULT_PROVIDER_RUN_TIMEOUT_MS) / 1000),
    ),
    baseUrl: (initialConfig as { baseUrl?: string; env?: Record<string, string> } | undefined)?.baseUrl
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.ANTHROPIC_BASE_URL
      ?? "",
    apiKey: (initialConfig as { apiKey?: string; env?: Record<string, string> } | undefined)?.apiKey
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.ANTHROPIC_AUTH_TOKEN
      ?? "",
    model: (initialConfig as { model?: string; env?: Record<string, string> } | undefined)?.model
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.ANTHROPIC_MODEL
      ?? "",
    configDirectory: (initialConfig as { configDirectory?: string; env?: Record<string, string> } | undefined)?.configDirectory
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.CLAUDE_CONFIG_DIR
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.CODEX_HOME
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.PI_CONFIG_DIR
      ?? "",
    homeDirectory: (initialConfig as { homeDirectory?: string; env?: Record<string, string> } | undefined)?.homeDirectory
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.HOME
      ?? "",
    codingAgentDirectory: (initialConfig as { codingAgentDirectory?: string; env?: Record<string, string> } | undefined)?.codingAgentDirectory
      ?? (initialConfig as { env?: Record<string, string> } | undefined)?.env?.PI_CODING_AGENT_DIR
      ?? "",
    profileName: (initialConfig as { profileName?: string } | undefined)?.profileName ?? "",
    hermesScope: (initialConfig as { scope?: HermesClientScope } | undefined)?.scope ?? "local",
    debugProfile: normalizeDebugProfile((initialConfig as { profile?: unknown } | undefined)?.profile),
    bindings: initial?.bindings ?? initialRecommendedBindings,
  }), [initialType, initial, initialConfig, initialRecommendedBindings, forceDefault]);
  const form = useForm<ClientFormValues>({
    defaultValues,
    mode: "onChange",
  });
  const values = form.watch();
  const isDebugClient = values.type === "debug";
  const isHermesClient = values.type === "hermes";
  const isClaudeCodeClient = values.type === "claude_code";
  const isCodexClient = values.type === "codex";
  const isOmpClient = values.type === "omp";
  const isLocalHermes = isHermesClient && values.hermesScope === "local";
  const availableFeatures = getProviderFeatures(providers, values.type);
  const namePlaceholder = getDefaultClientName(values.type, providers);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string | null>(null);
  const [hermesResult, setHermesResult] = useState<HermesIntegrationResult | null>(null);
  const [hermesBusy, setHermesBusy] = useState<"diagnose" | "setup" | "restart" | null>(null);
  const lastAutoBindings = useRef<string[]>(initialRecommendedBindings);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const payload = buildClientPayload(values);
  const formReadiness = readinessItems({
    copy,
    type: values.type,
    configured: hasBasicConfig(values.type, values),
    enabled: true,
    testStatus,
    testReason,
    bindings: values.bindings,
  });


  useEffect(() => {
    if (values.type === "hermes" && values.hermesScope === "local" && !values.baseUrl) {
      form.setValue("baseUrl", LOCAL_HERMES_BASE_URL, { shouldDirty: true });
    }
  }, [form, values.baseUrl, values.hermesScope, values.type]);

  useEffect(() => {
    if (initial) return;
    const recommended = recommendedFeatureBindings(availableFeatures);
    const current = form.getValues("bindings");
    if (current.length === 0 || sameBindings(current, lastAutoBindings.current)) {
      form.setValue("bindings", recommended, { shouldDirty: false });
      lastAutoBindings.current = recommended;
    }
  }, [availableFeatures, form, initial, values.type]);

  function handleSave(nextValues: ClientFormValues) {
    onSave({ payload: buildClientPayload({ ...nextValues, isDefault: forceDefault || nextValues.isDefault }), bindings: nextValues.bindings });
  }

  return (
    <Card size="sm">
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={(event) => void form.handleSubmit(handleSave)(event)}>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field data-invalid={Boolean(form.formState.errors.name)}>
                <FieldLabel htmlFor="ai-client-name">{copy.nameLabel}</FieldLabel>
                <Input
                  {...form.register("name", { required: copy.nameLabel })}
                  aria-invalid={Boolean(form.formState.errors.name)}
                  id="ai-client-name"
                  placeholder={namePlaceholder}
                />
                {form.formState.errors.name ? <FieldError errors={[form.formState.errors.name]} /> : null}
              </Field>
              <Field>
                <FieldLabel>{copy.typeLabel}</FieldLabel>
                <Controller
                  name="type"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full" aria-invalid={fieldState.invalid} aria-label={copy.typeLabel}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {providers.map((provider) => (
                            <SelectItem key={provider.key} value={provider.key}>
                              {provider.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>


            {isHermesClient && (
              <Card className="border-dashed bg-muted/25" size="sm">
                <CardContent className="flex flex-col gap-4">
                  <Field>
                    <FieldLabel>{copy.hermesScopeLabel}</FieldLabel>
                    <Controller
                      name="hermesScope"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Select
                          value={field.value}
                          onValueChange={(scope: HermesClientScope) => {
                            field.onChange(scope);
                            const currentBaseUrl = form.getValues("baseUrl");
                            if (scope === "remote" && currentBaseUrl === LOCAL_HERMES_BASE_URL) {
                              form.setValue("baseUrl", "", { shouldDirty: true, shouldValidate: true });
                            }
                            if (scope === "local" && !currentBaseUrl) {
                              form.setValue("baseUrl", LOCAL_HERMES_BASE_URL, { shouldDirty: true, shouldValidate: true });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full" aria-invalid={fieldState.invalid} aria-label={copy.hermesScopeLabel}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="local">{copy.hermesScopeLocal}</SelectItem>
                              <SelectItem value="remote">{copy.hermesScopeRemote}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <p className="text-sm text-muted-foreground">
                    {isLocalHermes ? copy.hermesLocalDescription : copy.hermesRemoteDescription}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={hermesBusy !== null}
                      onClick={async () => {
                        setHermesBusy("diagnose");
                        try {
                          setHermesResult(await diagnoseHermes(form.getValues()));
                        } catch (error) {
                          setHermesResult({
                            diagnostics: { mode: "unknown", restartRequired: false, checks: [] },
                            plan: {
                              summary: error instanceof Error ? error.message : copy.reasonUnknown,
                              canRunAutomatically: false,
                              actions: [],
                            },
                          });
                        } finally {
                          setHermesBusy(null);
                        }
                      }}
                    >
                      {hermesBusy === "diagnose" ? copy.testing : copy.diagnoseHermes}
                    </Button>
                    {isLocalHermes && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={hermesBusy !== null}
                        onClick={async () => {
                          setHermesBusy("setup");
                          try {
                            const result = await setupLocalHermes(form.getValues());
                            setHermesResult(result);
                            if (result.apiKey) form.setValue("apiKey", result.apiKey, { shouldDirty: true });
                          } catch (error) {
                            setHermesResult({
                              diagnostics: { mode: "unknown", restartRequired: false, checks: [] },
                              plan: {
                                summary: error instanceof Error ? error.message : copy.reasonUnknown,
                                canRunAutomatically: false,
                                actions: [],
                              },
                            });
                          } finally {
                            setHermesBusy(null);
                          }
                        }}
                      >
                        {hermesBusy === "setup" ? copy.testing : copy.autoConfigureHermes}
                      </Button>
                    )}
                    {isLocalHermes && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={hermesBusy !== null}
                        onClick={async () => {
                          setHermesBusy("restart");
                          try {
                            const restart = await restartLocalHermes();
                            setHermesResult((current) => ({
                              diagnostics: current?.diagnostics ?? { mode: "local", restartRequired: false, checks: [] },
                              plan: current?.plan ?? { summary: copy.restartHermesRequested, canRunAutomatically: false, actions: [] },
                              changed: current?.changed,
                              maskedApiKey: current?.maskedApiKey,
                              restart,
                            }));
                          } catch (error) {
                            setHermesResult((current) => ({
                              diagnostics: current?.diagnostics ?? { mode: "local", restartRequired: false, checks: [] },
                              plan: current?.plan ?? { summary: copy.reasonUnknown, canRunAutomatically: false, actions: [] },
                              changed: current?.changed,
                              maskedApiKey: current?.maskedApiKey,
                              restart: {
                                ok: false,
                                exitCode: null,
                                message: error instanceof Error ? error.message : copy.reasonUnknown,
                              },
                            }));
                          } finally {
                            setHermesBusy(null);
                          }
                        }}
                      >
                        {hermesBusy === "restart" ? copy.testing : copy.restartHermes}
                      </Button>
                    )}
                  </div>
                  {isLocalHermes ? <p className="text-xs text-muted-foreground">{copy.hermesRestartDescription}</p> : null}
                  {hermesResult && (
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="rounded-md border bg-background p-3">
                        <div className="mb-2 font-medium">{copy.hermesDiagnosticsTitle}</div>
                        <div className="flex flex-col gap-1">
                          {hermesResult.diagnostics.checks.slice(0, 6).map((check) => (
                            <div key={check.key} className="flex gap-2">
                              <Badge variant={check.status === "error" ? "destructive" : check.status === "ok" ? "default" : "secondary"}>{check.status}</Badge>
                              <span className="text-muted-foreground">{check.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-md border bg-background p-3">
                        <div className="mb-2 font-medium">{copy.hermesPlanTitle}</div>
                        <p className="text-muted-foreground">{hermesResult.plan.summary}</p>
                        {hermesResult.maskedApiKey ? <p className="mt-2 text-muted-foreground">API key: {hermesResult.maskedApiKey}</p> : null}
                        {hermesResult.changed && hermesResult.changed.length > 0 ? (
                          <p className="mt-2 text-muted-foreground">{copy.hermesChangedTitle}: {hermesResult.changed.join(", ")}</p>
                        ) : null}
                        {hermesResult.diagnostics.restartRequired ? <p className="mt-2 text-muted-foreground">{copy.hermesRestartRequired}</p> : null}
                        {hermesResult.restart ? <p className="mt-2 text-muted-foreground">{hermesResult.restart.message}</p> : null}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <details className="rounded-lg border border-border/70 bg-muted/15 p-3">
              <summary className="cursor-pointer font-medium text-foreground">{copy.advancedSettings}</summary>
              <p className="mt-1 text-xs text-muted-foreground">{copy.advancedSettingsHelp}</p>
              <div className="mt-4 grid gap-4">
            {!isDebugClient && !isClaudeCodeClient && !isCodexClient && !isOmpClient && (
              <>
                <Field>
                  <FieldLabel htmlFor="ai-client-base-url">Base URL</FieldLabel>
                  <Input
                    {...form.register("baseUrl", {
                      validate: (value) => values.type !== "hermes" || values.hermesScope !== "remote" || Boolean(value.trim()) || copy.remoteBaseUrlRequired,
                    })}
                    id="ai-client-base-url"
                    placeholder={isLocalHermes ? LOCAL_HERMES_BASE_URL : "http://hermes-host:8642"}
                  />
                  {form.formState.errors.baseUrl ? <FieldError errors={[form.formState.errors.baseUrl]} /> : null}
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ai-client-api-key">API Key</FieldLabel>
                    <Input
                      {...form.register("apiKey")}
                      id="ai-client-api-key"
                      type="password"
                      placeholder="optional for localhost"
                    />
                  </Field>
                  <Field data-invalid={Boolean(form.formState.errors.timeoutSeconds)}>
                    <FieldLabel htmlFor="ai-client-timeout">Timeout (seconds)</FieldLabel>
                    <Input
                      {...form.register("timeoutSeconds", {
                        required: copy.timeoutSeconds,
                        validate: (value) => Number(value) > 0 || copy.timeoutSeconds,
                      })}
                      aria-invalid={Boolean(form.formState.errors.timeoutSeconds)}
                      id="ai-client-timeout"
                      type="number"
                    />
                    {form.formState.errors.timeoutSeconds ? <FieldError errors={[form.formState.errors.timeoutSeconds]} /> : null}
                  </Field>
                </div>
              </>
            )}
            {isClaudeCodeClient && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ai-client-model">ANTHROPIC_MODEL</FieldLabel>
                    <Input
                      {...form.register("model")}
                      id="ai-client-model"
                      placeholder="optional model override"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-client-base-url">ANTHROPIC_BASE_URL</FieldLabel>
                    <Input
                      {...form.register("baseUrl")}
                      id="ai-client-base-url"
                      placeholder="optional custom Anthropic-compatible base URL"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="ai-client-api-key">ANTHROPIC_AUTH_TOKEN</FieldLabel>
                  <Input
                    {...form.register("apiKey")}
                    id="ai-client-api-key"
                    type="password"
                    placeholder="optional auth token"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ai-client-config-directory">Config directory</FieldLabel>
                  <Input
                    {...form.register("configDirectory")}
                    id="ai-client-config-directory"
                    placeholder="default user-level Claude Code config"
                  />
                </Field>
                <Field data-invalid={Boolean(form.formState.errors.timeoutSeconds)}>
                  <FieldLabel htmlFor="ai-client-timeout">Timeout (seconds)</FieldLabel>
                  <Input
                    {...form.register("timeoutSeconds", {
                      required: copy.timeoutSeconds,
                      validate: (value) => Number(value) > 0 || copy.timeoutSeconds,
                    })}
                    aria-invalid={Boolean(form.formState.errors.timeoutSeconds)}
                    id="ai-client-timeout"
                    type="number"
                  />
                  {form.formState.errors.timeoutSeconds ? <FieldError errors={[form.formState.errors.timeoutSeconds]} /> : null}
                </Field>
                <p className="text-xs text-muted-foreground">
                  MCP base URL is set automatically by the engine. Pass an
                  Anthropic API key for production usage to avoid the SDK
                  subscription quota (2026-06-15 onward).
                </p>
              </>
            )}
            {isCodexClient && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ai-client-model">Model</FieldLabel>
                    <Input
                      {...form.register("model")}
                      id="ai-client-model"
                      placeholder="optional model override"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-client-base-url">Base URL</FieldLabel>
                    <Input
                      {...form.register("baseUrl")}
                      id="ai-client-base-url"
                      placeholder="optional OpenAI-compatible base URL"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="ai-client-api-key">OPENAI_API_KEY</FieldLabel>
                  <Input
                    {...form.register("apiKey")}
                    id="ai-client-api-key"
                    type="password"
                    placeholder="optional API key"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ai-client-config-directory">CODEX_HOME</FieldLabel>
                  <Input
                    {...form.register("configDirectory")}
                    id="ai-client-config-directory"
                    placeholder="default user-level Codex home (~/.codex)"
                  />
                </Field>
                <Field data-invalid={Boolean(form.formState.errors.timeoutSeconds)}>
                  <FieldLabel htmlFor="ai-client-timeout">Timeout (seconds)</FieldLabel>
                  <Input
                    {...form.register("timeoutSeconds", {
                      required: copy.timeoutSeconds,
                      validate: (value) => Number(value) > 0 || copy.timeoutSeconds,
                    })}
                    aria-invalid={Boolean(form.formState.errors.timeoutSeconds)}
                    id="ai-client-timeout"
                    type="number"
                  />
                  {form.formState.errors.timeoutSeconds ? <FieldError errors={[form.formState.errors.timeoutSeconds]} /> : null}
                </Field>
                <p className="text-xs text-muted-foreground">
                  Uses the Codex provider adapter with scoped MCP control tools
                  passed at runtime.
                </p>
              </>
            )}

            {isOmpClient && (
              <>
                <Field>
                  <FieldLabel htmlFor="ai-client-model">Model</FieldLabel>
                  <Input
                    {...form.register("model")}
                    id="ai-client-model"
                    placeholder="optional OMP model override"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ai-client-base-url">OMP Base URL</FieldLabel>
                    <Input
                      {...form.register("baseUrl")}
                      id="ai-client-base-url"
                      placeholder="optional OMP provider base URL"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-client-api-key">OMP API Key</FieldLabel>
                    <Input
                      {...form.register("apiKey")}
                      id="ai-client-api-key"
                      type="password"
                      placeholder="fallback to OMP credentials if empty"
                    />
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ai-client-home-directory">HOME</FieldLabel>
                    <Input
                      {...form.register("homeDirectory")}
                      id="ai-client-home-directory"
                      placeholder="default process HOME"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ai-client-config-directory">PI_CONFIG_DIR</FieldLabel>
                    <Input
                      {...form.register("configDirectory")}
                      id="ai-client-config-directory"
                      placeholder="default .omp under HOME"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="ai-client-coding-agent-directory">PI_CODING_AGENT_DIR</FieldLabel>
                  <Input
                    {...form.register("codingAgentDirectory")}
                    id="ai-client-coding-agent-directory"
                    placeholder="default ~/.omp/agent"
                  />
                </Field>
                <Field data-invalid={Boolean(form.formState.errors.timeoutSeconds)}>
                  <FieldLabel htmlFor="ai-client-timeout">Timeout (seconds)</FieldLabel>
                  <Input
                    {...form.register("timeoutSeconds", {
                      required: copy.timeoutSeconds,
                      validate: (value) => Number(value) > 0 || copy.timeoutSeconds,
                    })}
                    aria-invalid={Boolean(form.formState.errors.timeoutSeconds)}
                    id="ai-client-timeout"
                    type="number"
                  />
                  {form.formState.errors.timeoutSeconds ? <FieldError errors={[form.formState.errors.timeoutSeconds]} /> : null}
                </Field>
                <p className="text-xs text-muted-foreground">
                  All OMP runs use the in-process SDK with the configured API key/base URL when present, then fall back to local OMP credentials under ~/.omp.
                </p>
              </>
            )}

            {isDebugClient && (
              <Field>
                <FieldLabel>{copy.debugProfileLabel}</FieldLabel>
                <Controller
                  name="debugProfile"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full" aria-invalid={fieldState.invalid} aria-label={copy.debugProfileLabel}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="deterministic">{copy.debugProfileDeterministic}</SelectItem>
                          <SelectItem value="tool-submit">{copy.debugProfileToolSubmit}</SelectItem>
                          <SelectItem value="hermes-like">{copy.debugProfileHermesLike}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}

            {availableFeatures.length > 0 && (
              <Field>
                <FieldLabel>Feature bindings</FieldLabel>
                <div className="grid gap-3 rounded-md border p-3">
                  {availableFeatures.map((feature) => {
                    const featureCopy = getFeatureCopy(feature);
                    return (
                      <Controller
                        key={feature}
                        name="bindings"
                        control={form.control}
                        render={({ field }) => (
                          <Field orientation="horizontal" className="items-start gap-3">
                            <Checkbox
                              checked={field.value.includes(feature)}
                              onCheckedChange={(checked) => {
                                field.onChange(
                                  checked === true
                                    ? [...new Set([...field.value, feature])]
                                    : field.value.filter((value) => value !== feature),
                                );
                              }}
                            />
                            <FieldContent>
                              <FieldLabel>{featureCopy.label}</FieldLabel>
                              <p className="text-xs text-muted-foreground">{featureCopy.description}</p>
                            </FieldContent>
                          </Field>
                        )}
                      />
                    );
                  })}
                </div>
              </Field>
            )}
              </div>
            </details>


            <ReadinessChecklist items={formReadiness} />

            <Controller
              name="isDefault"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal" className="items-start gap-3">
                  <Checkbox aria-label={copy.setAsDefault} checked={forceDefault || field.value} disabled={forceDefault} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  <FieldContent>
                    <FieldLabel>{copy.setAsDefault}</FieldLabel>
                    <p className="text-xs text-muted-foreground">{copy.setAsDefaultHelp}</p>
                  </FieldContent>
                </Field>
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setTestStatus("testing");
                  setTestReason(null);
                  try {
                    const result = await testClientAvailability(payload);
                    setTestStatus(result.status);
                    setTestReason(result.reason);
                  } catch (error) {
                    setTestStatus("unavailable");
                    setTestReason(error instanceof Error ? error.message : copy.reasonUnknown);
                  }
                }}
              >
                {copy.testAvailability}
              </Button>
              <Badge variant={getStatusVariant(testStatus)}>{getStatusLabel(copy, testStatus)}</Badge>
              <span className="text-xs text-muted-foreground">{testReason ?? copy.reasonUnknown}</span>
            </div>

            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t bg-background/95 px-1 pt-4 pb-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <Button type="submit">
                {copy.save}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                {copy.cancel}
              </Button>
            </div>

          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

export function AiClientsManager() {
  const { messages } = useI18n();
  const copy = getCopy(messages as Record<string, unknown>);
  const [clients, setClients] = useState<AiClientInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<RuntimeProviderOption[]>([]);
  const [cardTestStates, setCardTestStates] = useState<Record<string, TestResult>>({});

  const refreshAfterMutation = () => {
    notifyAiClientsChanged();
    void fetchClients();
  };

  const fetchClients = useCallback(async () => {
    const [clientsRes, providersRes] = await Promise.all([
      api.ai.clients.$get(),
      api.runtime.providers.$get(),
    ]);
    const clientsData = await clientsRes.json();
    const providersData = await providersRes.json();
    const availableProviders = normalizeRuntimeProviders(providersData).filter(
      (provider) => provider.key !== "debug" || isDebugProviderVisible(),
    );
    setProviders(availableProviders);
    setClients(
      "clients" in clientsData
        ? (clientsData.clients as AiClientInfo[]).filter((client) =>
            availableProviders.some((provider) => provider.key === client.type),
          )
        : [],
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const handleCreate = async (data: { payload: ClientFormPayload; bindings: string[] }) => {
    const res = await api.ai.clients.$post({ json: data.payload });
    const result = (await res.json()) as { client?: { id?: string } };
    if (result.client?.id) {
      await updateClientBindings(result.client.id, data.bindings);
    }
    setShowForm(false);
    refreshAfterMutation();
  };

  const handleUpdate = async (id: string, data: { payload: ClientFormPayload; bindings: string[] }) => {
    await api.ai.clients[":clientId"].$patch({
      param: { clientId: id },
      json: data.payload,
    });
    await updateClientBindings(id, data.bindings);
    setEditingId(null);
    refreshAfterMutation();
  };

  const handleDelete = async (id: string) => {
    await api.ai.clients[":clientId"].$delete({ param: { clientId: id } });
    refreshAfterMutation();
  };

  const handleMakeDefault = async (id: string) => {
    await api.ai.clients[":clientId"].$patch({
      param: { clientId: id },
      json: { isDefault: true },
    });
    refreshAfterMutation();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await api.ai.clients[":clientId"].$patch({
      param: { clientId: id },
      json: { enabled },
    });
    refreshAfterMutation();
  };

  const handleTestExistingClient = async (client: AiClientInfo) => {
    setCardTestStates((current) => ({
      ...current,
      [client.id]: { status: "testing", reason: null },
    }));

    try {
      const result = await testClientAvailability({
        name: client.name,
        type: client.type,
        config: client.config,
        isDefault: client.isDefault,
      });
      setCardTestStates((current) => ({
        ...current,
        [client.id]: result,
      }));
    } catch (error) {
      setCardTestStates((current) => ({
        ...current,
        [client.id]: {
          status: "unavailable",
          reason: error instanceof Error ? error.message : copy.reasonUnknown,
        },
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-1" aria-label={copy.loading}>
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
          <p className="text-sm text-muted-foreground">{copy.hermesIntro}</p>
        </div>
        <Button type="button" onClick={() => setShowForm(true)}>
          {copy.addClient}
        </Button>
      </div>

      {showForm && <ClientForm onSave={handleCreate} onCancel={() => setShowForm(false)} copy={copy} providers={providers} forceDefault={clients.length === 0} />}

      {clients.length === 0 && !showForm && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
            <p className="max-w-md">{copy.emptyState}</p>
            <Button type="button" onClick={() => setShowForm(true)}>
              {copy.emptyStateCta}
            </Button>
          </CardContent>
        </Card>
      )}

      {clients.map((client) => {
        const cardTestState = cardTestStates[client.id] ?? { status: "idle", reason: null };
        const clientReadiness = readinessItems({
          copy,
          type: client.type,
          configured: true,
          enabled: client.enabled,
          testStatus: cardTestState.status,
          testReason: cardTestState.reason,
          bindings: client.bindings,
        });


        return (
          <Card key={client.id} size="sm">
          {editingId === client.id ? (
            <ClientForm initial={client} onSave={(data) => handleUpdate(client.id, data)} onCancel={() => setEditingId(null)} copy={copy} providers={providers} />
          ) : (
            <>
              <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{client.name}</CardTitle>
                    <Badge variant="secondary">{client.type}</Badge>
                    {client.isDefault && <Badge variant="default">{copy.defaultBadge}</Badge>}
                  </div>
                  <CardDescription>
                    {client.type === "debug" ? (
                      <span>Local debug provider: {normalizeDebugProfile((client.config as { profile?: unknown }).profile)}</span>
                    ) : client.type === "hermes" ? (
                      <span>Hermes: {(client.config as { baseUrl?: string }).baseUrl ?? "http://127.0.0.1:8642"}</span>
                    ) : (
                      <span>
                        {(client.config as { baseUrl?: string }).baseUrl ?? "—"} · {(client.config as { model?: string }).model ?? "default"}
                      </span>
                    )}
                  {client.bindings.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {client.bindings.map((feature) => (
                        <Badge key={feature} variant="outline">{getFeatureCopy(feature).label}</Badge>
                      ))}
                    </div>
                  )}
                  </CardDescription>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void handleTestExistingClient(client)}
                    >
                      {copy.testAvailability}
                    </Button>
                    <Badge variant={getStatusVariant(cardTestState.status)}>{getStatusLabel(copy, cardTestState.status)}</Badge>
                    <span className="text-muted-foreground">{cardTestState.reason ?? copy.reasonUnknown}</span>
                  </div>
                  <ReadinessChecklist items={clientReadiness} />
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <Checkbox checked={client.enabled} onCheckedChange={(checked) => handleToggleEnabled(client.id, checked === true)} />
                    <FieldLabel className="text-xs text-muted-foreground">{copy.enabled}</FieldLabel>
                  </Field>
                  {!client.isDefault && client.enabled && (
                    <Button type="button" variant="outline" size="xs" onClick={() => void handleMakeDefault(client.id)}>
                      {copy.makeDefault}
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="xs" onClick={() => setEditingId(client.id)}>
                    {copy.edit}
                  </Button>
                  <Button type="button" variant="destructive" size="xs" onClick={() => handleDelete(client.id)}>
                    {copy.delete}
                  </Button>
                </div>
              </CardHeader>
            </>
          )}
        </Card>
        );
      })}
    </div>
  );
}
