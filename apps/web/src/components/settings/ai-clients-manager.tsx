"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

interface AiClientInfo {
  id: string;
  name: string;
  type: "openclaw" | "llm";
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
  bindings: string[];
  createdAt: string;
}

type ClientFormPayload = {
  name: string;
  type: "openclaw" | "llm";
  config: Record<string, unknown>;
  isDefault: boolean;
};

type TestStatus = "idle" | "testing" | "available" | "unavailable";

type TestResult = {
  status: TestStatus;
  reason: string | null;
};

function buildClientPayload(input: {
  name: string;
  type: "openclaw" | "llm";
  isDefault: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  timeoutSeconds: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): ClientFormPayload {
  const config = input.type === "openclaw"
    ? {
        gatewayUrl: input.gatewayUrl,
        gatewayToken: input.gatewayToken,
        timeoutSeconds: Number(input.timeoutSeconds),
      }
    : { baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model };

  return {
    name: input.name,
    type: input.type,
    config,
    isDefault: input.isDefault,
  };
}

async function testClientAvailability(payload: ClientFormPayload): Promise<TestResult> {
  const res = await fetch("/api/ai/clients/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

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

function getStatusClasses(status: TestStatus) {
  switch (status) {
    case "available":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "unavailable":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "testing":
      return "border-primary/40 bg-primary/10 text-primary";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
}

const ALL_FEATURES = ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] as const;

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
  featureSuggest: "Smart Suggestions",
  featureGeneratePlan: "Task Plan Generation",
  featureConflicts: "Conflict Analysis",
  featureTimeslots: "Timeslot Recommendations",
  featureChat: "Chat / Plan Generation",
};

function getCopy(messages: Record<string, unknown>): Record<string, string> {
  const section = (messages.pages as Record<string, Record<string, string>> | undefined)?.aiClientsPage ?? {};
  return { ...DEFAULTS, ...section };
}

function getFeatureLabels(copy: Record<string, string>): Record<string, string> {
  return {
    suggest: copy.featureSuggest,
    generate_plan: copy.featureGeneratePlan,
    conflicts: copy.featureConflicts,
    timeslots: copy.featureTimeslots,
    chat: copy.featureChat,
  };
}

function ClientForm({
  initial,
  onSave,
  onCancel,
  copy,
}: {
  initial?: AiClientInfo;
  onSave: (data: ClientFormPayload) => void;
  onCancel: () => void;
  copy: Record<string, string>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"openclaw" | "llm">(initial?.type ?? "openclaw");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [gatewayUrl, setGatewayUrl] = useState((initial?.config as { gatewayUrl?: string })?.gatewayUrl ?? "http://localhost:7677");
  const [gatewayToken, setGatewayToken] = useState((initial?.config as { gatewayToken?: string })?.gatewayToken ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(String((initial?.config as { timeoutSeconds?: number })?.timeoutSeconds ?? 120));
  const [baseUrl, setBaseUrl] = useState((initial?.config as { baseUrl?: string })?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState((initial?.config as { apiKey?: string })?.apiKey ?? "");
  const [model, setModel] = useState((initial?.config as { model?: string })?.model ?? "gpt-4o-mini");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testReason, setTestReason] = useState<string | null>(null);

  const payload = buildClientPayload({
    name,
    type,
    isDefault,
    gatewayUrl,
    gatewayToken,
    timeoutSeconds,
    baseUrl,
    apiKey,
    model,
  });

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">{copy.nameLabel}</span>
          <input
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My OpenClaw Client"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">{copy.typeLabel}</span>
          <select
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "openclaw" | "llm")}
          >
            <option value="openclaw">OpenClaw</option>
            <option value="llm">{copy.llmCompatible}</option>
          </select>
        </label>
      </div>

      {type === "openclaw" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Gateway URL</span>
            <input
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Gateway Token</span>
            <input
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              type="password"
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder="token"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">{copy.timeoutSeconds}</span>
            <input
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              type="number"
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Base URL</span>
            <input
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-muted-foreground">API Key</span>
              <input
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-muted-foreground">{copy.modelLabel}</span>
              <input
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        {copy.setAsDefault}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-muted"
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
        </button>
        <span className={`rounded-full border px-2.5 py-1 text-xs ${getStatusClasses(testStatus)}`}>
          {getStatusLabel(copy, testStatus)}
        </span>
        <span className="text-xs text-muted-foreground">{testReason ?? copy.reasonUnknown}</span>
      </div>

      <div className="flex gap-2">
        <button
          className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => {
            onSave(payload);
          }}
        >
          {copy.save}
        </button>
        <button className="rounded-xl border border-border/60 px-3 py-2 text-sm" onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}

export function AiClientsManager() {
  const { messages } = useI18n();
  const copy = getCopy(messages as Record<string, unknown>);
  const featureLabels = getFeatureLabels(copy);
  const [clients, setClients] = useState<AiClientInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardTestStates, setCardTestStates] = useState<Record<string, TestResult>>({});

  const fetchClients = useCallback(async () => {
    const res = await fetch("/api/ai/clients");
    const data = await res.json();
    setClients(data.clients ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const handleCreate = async (data: ClientFormPayload) => {
    await fetch("/api/ai/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowForm(false);
    void fetchClients();
  };

  const handleUpdate = async (id: string, data: ClientFormPayload) => {
    await fetch(`/api/ai/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditingId(null);
    void fetchClients();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/ai/clients/${id}`, { method: "DELETE" });
    void fetchClients();
  };

  const handleToggleBinding = async (clientId: string, feature: string, currentlyBound: boolean) => {
    const client = clients.find((entry) => entry.id === clientId);
    if (!client) return;

    const newFeatures = currentlyBound ? client.bindings.filter((item) => item !== feature) : [...client.bindings, feature];

    await fetch(`/api/ai/clients/${clientId}/bindings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: newFeatures }),
    });
    void fetchClients();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await fetch(`/api/ai/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
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
      <div className="p-1">
        <div className="animate-pulse text-sm text-muted-foreground">{copy.loading}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <button className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => setShowForm(true)}>
          {copy.addClient}
        </button>
      </div>

      {showForm && <ClientForm onSave={handleCreate} onCancel={() => setShowForm(false)} copy={copy} />}

      {clients.length === 0 && !showForm && (
        <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">{copy.emptyState}</div>
      )}

      {clients.map((client) => {
        const cardTestState = cardTestStates[client.id] ?? { status: "idle", reason: null };

        return (
          <div key={client.id} className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
          {editingId === client.id ? (
            <ClientForm initial={client} onSave={(data) => handleUpdate(client.id, data)} onCancel={() => setEditingId(null)} copy={copy} />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium text-foreground">{client.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{client.type}</span>
                    {client.isDefault && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{copy.defaultBadge}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {client.type === "openclaw" ? (
                      <span>Gateway: {(client.config as { gatewayUrl?: string }).gatewayUrl ?? "—"}</span>
                    ) : (
                      <span>
                        {(client.config as { baseUrl?: string }).baseUrl ?? "—"} · {(client.config as { model?: string }).model ?? "default"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      className="rounded-xl border border-border/60 px-2.5 py-1.5 text-xs hover:bg-muted"
                      onClick={() => void handleTestExistingClient(client)}
                    >
                      {copy.testAvailability}
                    </button>
                    <span className={`rounded-full border px-2.5 py-1 ${getStatusClasses(cardTestState.status)}`}>
                      {getStatusLabel(copy, cardTestState.status)}
                    </span>
                    <span className="text-muted-foreground">{cardTestState.reason ?? copy.reasonUnknown}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={client.enabled} onChange={(e) => handleToggleEnabled(client.id, e.target.checked)} />
                    {copy.enabled}
                  </label>
                  <button className="rounded-xl border border-border/60 px-2.5 py-1.5 text-xs hover:bg-muted" onClick={() => setEditingId(client.id)}>
                    {copy.edit}
                  </button>
                  <button className="rounded-xl border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10" onClick={() => handleDelete(client.id)}>
                    {copy.delete}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {ALL_FEATURES.map((feature) => {
                  const isBound = client.bindings.includes(feature);
                  return (
                    <button
                      key={feature}
                      className={isBound ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary transition-colors" : "rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"}
                      onClick={() => handleToggleBinding(client.id, feature, isBound)}
                    >
                      {featureLabels[feature] ?? feature}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        );
      })}
    </div>
  );
}
