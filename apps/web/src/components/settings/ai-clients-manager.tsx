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

type AiClientType = "openclaw" | "llm" | "hermes";

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

type ClientFormValues = {
  name: string;
  type: AiClientType;
  isDefault: boolean;
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
};

type TestStatus = "idle" | "testing" | "available" | "unavailable";

type TestResult = {
  status: TestStatus;
  reason: string | null;
};

type RuntimeProviderOption = {
  key: AiClientType;
  label: string;
};

function buildClientPayload(input: {
  name: string;
  type: AiClientType;
  isDefault: boolean;
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
}): ClientFormPayload {
  return {
    name: input.name,
    type: input.type,
    config: {
      baseUrl: input.baseUrl || "http://127.0.0.1:8642",
      apiKey: input.apiKey,
      timeoutMs: Number(input.timeoutSeconds) * 1000,
    },
    isDefault: input.isDefault,
  };
}

function normalizeRuntimeProviders(input: unknown): RuntimeProviderOption[] {
  const providers = (input as { providers?: unknown[] }).providers ?? [];
  return providers
    .filter((provider): provider is { key: AiClientType; label?: string } => {
      const key = (provider as { key?: unknown }).key;
      return key === "hermes" || key === "openclaw" || key === "llm";
    })
    .map((provider) => ({
      key: provider.key,
      label: provider.label ?? provider.key,
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

function getStatusLabel(copy: Record<string, string>, status: TestStatus) {
  switch (status) {
    case "testing":
      return copy.testing;
    case "available":
      return copy.available;
    case "unavailable":
      return copy.unavailable;
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
    default:
      return "outline";
  }
}

const DEFAULTS: Record<string, string> = {
  title: "AI Clients",
  subtitle: "Manage AI clients and configure which client each feature uses",
  addClient: "+ Add Client",
  emptyState: "No AI Clients configured yet. Click the button above to add one.",
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
    baseUrl: (initial?.config as { baseUrl?: string })?.baseUrl ?? "http://127.0.0.1:8642",
    apiKey: (initial?.config as { apiKey?: string })?.apiKey ?? "",
  }), [fallbackType, initial, providers]);
  const form = useForm<ClientFormValues>({
    defaultValues,
    mode: "onChange",
  });
  const values = form.watch();
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string | null>(null);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const payload = buildClientPayload(values);

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

          <Field>
            <FieldLabel htmlFor="ai-client-base-url">Base URL</FieldLabel>
            <Input
              {...form.register("baseUrl")}
              id="ai-client-base-url"
              placeholder="http://127.0.0.1:8642"
            />
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
    const availableProviders = normalizeRuntimeProviders(providersData);
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
        </div>
        <Button type="button" onClick={() => setShowForm(true)}>
          {copy.addClient}
        </Button>
      </div>

      {showForm && <ClientForm onSave={handleCreate} onCancel={() => setShowForm(false)} copy={copy} providers={providers} />}

      {clients.length === 0 && !showForm && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{copy.emptyState}</CardContent>
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
                    {client.type === "openclaw" ? (
                      <span>Bridge: {(client.config as { bridgeUrl?: string }).bridgeUrl ?? "—"}</span>
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
