"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useI18n } from "@chrona/i18n/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/rpc-client";

type AiClientType = "llm" | "hermes" | "debug" | (string & {});

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
};

type ClientFormValues = {
  name: string;
  type: AiClientType;
  isDefault: boolean;
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  binaryPath: string;
  hermesScope: HermesClientScope;
  debugProfile: DebugProviderProfile;
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

type RuntimeProviderOption = {
  key: AiClientType;
  label: string;
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
  binaryPath: string;
}): Record<string, unknown> {
  const model = nonEmptyEnvValue(input.model);
  const baseUrl = nonEmptyEnvValue(input.baseUrl);
  const authToken = nonEmptyEnvValue(input.apiKey);
  const binaryPath = nonEmptyEnvValue(input.binaryPath);
  const env: Record<string, string> = {};

  if (model) env.ANTHROPIC_MODEL = model;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;

  return {
    model,
    binaryPath,
    timeoutMs: Number(input.timeoutSeconds) * 1000,
    env: Object.keys(env).length > 0 ? env : undefined,
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
  binaryPath: string;
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
    }));
}

async function testClientAvailability(payload: ClientFormPayload): Promise<TestResult> {
  const res = await api.ai.clients.test.$post({ json: payload });

  const data = (await res.json()) as { available?: boolean; reason?: string; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? data.reason ?? "Failed to test client availability");
  }

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
  if (!res.ok) throw new Error(data.error ?? "Failed to diagnose Hermes integration");
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
  if (!res.ok) throw new Error(data.error ?? "Failed to configure local Hermes");
  return data;
}

async function restartLocalHermes(): Promise<{ ok: boolean; message: string; exitCode: number | null }> {
  const res = await api.integrations.hermes["restart-local"].$post();
  const data = (await res.json()) as { ok: boolean; message: string; exitCode: number | null; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to restart Hermes gateway");
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

const DEFAULTS: Record<string, string> = {
  title: "AI Clients",
  subtitle: "Connect Hermes so Chrona can plan tasks and safely execute approved work.",
  addClient: "+ Add Client",
  emptyState: "No AI client is connected yet. Start with local Hermes to unlock planning, suggestions, and execution previews.",
  emptyStateCta: "Connect local Hermes",
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
  setAsDefault: "Set as default Client",
  save: "Save",
  cancel: "Cancel",
  testAvailability: "Test availability",
  testing: "Testing...",
  available: "Available",
  unavailable: "Unavailable",
  statusUnknown: "Not tested",
  reasonUnknown: "No details yet",
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
}: {
  initial?: AiClientInfo;
  onSave: (data: ClientFormPayload) => void;
  onCancel: () => void;
  copy: Record<string, string>;
  providers: RuntimeProviderOption[];
}) {
  const fallbackType = providers[0]?.key ?? "hermes";
  const defaultValues = useMemo<ClientFormValues>(() => ({
    name: initial?.name ?? "",
    type: initial && providers.some((provider) => provider.key === initial.type) ? initial.type : fallbackType,
    isDefault: initial?.isDefault ?? false,
    timeoutSeconds: String(
      (initial?.config as { timeoutSeconds?: number; timeoutMs?: number })?.timeoutSeconds
        ?? (((initial?.config as { timeoutMs?: number })?.timeoutMs ?? 120000) / 1000),
    ),
    baseUrl: (initial?.config as { baseUrl?: string; env?: Record<string, string> })?.baseUrl
      ?? (initial?.config as { env?: Record<string, string> })?.env?.ANTHROPIC_BASE_URL
      ?? "",
    apiKey: (initial?.config as { apiKey?: string; env?: Record<string, string> })?.apiKey
      ?? (initial?.config as { env?: Record<string, string> })?.env?.ANTHROPIC_AUTH_TOKEN
      ?? "",
    model: (initial?.config as { model?: string; env?: Record<string, string> })?.model
      ?? (initial?.config as { env?: Record<string, string> })?.env?.ANTHROPIC_MODEL
      ?? "",
    binaryPath: (initial?.config as { binaryPath?: string })?.binaryPath ?? "",
    hermesScope: (initial?.config as { scope?: HermesClientScope })?.scope ?? "local",
    debugProfile: normalizeDebugProfile((initial?.config as { profile?: unknown })?.profile),
  }), [fallbackType, initial, providers]);
  const form = useForm<ClientFormValues>({
    defaultValues,
    mode: "onChange",
  });
  const values = form.watch();
  const isDebugClient = values.type === "debug";
  const isHermesClient = values.type === "hermes";
  const isClaudeCodeClient = values.type === "claude_code";
  const isLocalHermes = isHermesClient && values.hermesScope === "local";
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string | null>(null);
  const [hermesResult, setHermesResult] = useState<HermesIntegrationResult | null>(null);
  const [hermesBusy, setHermesBusy] = useState<"diagnose" | "setup" | "restart" | null>(null);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const payload = buildClientPayload(values);

  useEffect(() => {
    if (values.type === "hermes" && values.hermesScope === "local" && !values.baseUrl) {
      form.setValue("baseUrl", LOCAL_HERMES_BASE_URL, { shouldDirty: true });
    }
  }, [form, values.baseUrl, values.hermesScope, values.type]);

  function handleSave(nextValues: ClientFormValues) {
    onSave(buildClientPayload(nextValues));
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
                  placeholder="My Hermes Client"
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

            {!isDebugClient && !isClaudeCodeClient && (
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
                <div className="grid gap-4 md:grid-cols-2">
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
                    <FieldLabel htmlFor="ai-client-binary-path">Binary path</FieldLabel>
                    <Input
                      {...form.register("binaryPath")}
                      id="ai-client-binary-path"
                      placeholder="claude"
                    />
                  </Field>
                </div>
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

            <Controller
              name="isDefault"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                  <FieldContent>
                    <FieldLabel>{copy.setAsDefault}</FieldLabel>
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

            <div className="flex gap-2">
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

  const handleCreate = async (data: ClientFormPayload) => {
    await api.ai.clients.$post({ json: data });
    setShowForm(false);
    void fetchClients();
  };

  const handleUpdate = async (id: string, data: ClientFormPayload) => {
    await api.ai.clients[":clientId"].$patch({
      param: { clientId: id },
      json: data,
    });
    setEditingId(null);
    void fetchClients();
  };

  const handleDelete = async (id: string) => {
    await api.ai.clients[":clientId"].$delete({ param: { clientId: id } });
    void fetchClients();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await api.ai.clients[":clientId"].$patch({
      param: { clientId: id },
      json: { enabled },
    });
    void fetchClients();
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

      {showForm && <ClientForm onSave={handleCreate} onCancel={() => setShowForm(false)} copy={copy} providers={providers} />}

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
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <Checkbox checked={client.enabled} onCheckedChange={(checked) => handleToggleEnabled(client.id, checked === true)} />
                    <FieldLabel className="text-xs text-muted-foreground">{copy.enabled}</FieldLabel>
                  </Field>
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
