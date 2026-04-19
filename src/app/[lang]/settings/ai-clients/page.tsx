"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ──

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

const ALL_FEATURES = [
  "suggest",
  "decompose",
  "conflicts",
  "timeslots",
  "chat",
] as const;
const FEATURE_LABELS: Record<string, string> = {
  suggest: "智能建议",
  decompose: "任务分解",
  conflicts: "冲突分析",
  timeslots: "时间段推荐",
  chat: "对话 / 计划生成",
};

// ── Client Form ──

function ClientForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AiClientInfo;
  onSave: (data: {
    name: string;
    type: "openclaw" | "llm";
    config: Record<string, unknown>;
    isDefault: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"openclaw" | "llm">(
    initial?.type ?? "openclaw",
  );
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);

  // OpenClaw fields
  const [bridgeUrl, setBridgeUrl] = useState(
    (initial?.config as { bridgeUrl?: string })?.bridgeUrl ??
      "http://localhost:7677",
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(
      (initial?.config as { timeoutSeconds?: number })?.timeoutSeconds ?? 120,
    ),
  );

  // LLM fields
  const [baseUrl, setBaseUrl] = useState(
    (initial?.config as { baseUrl?: string })?.baseUrl ?? "",
  );
  const [apiKey, setApiKey] = useState(
    (initial?.config as { apiKey?: string })?.apiKey ?? "",
  );
  const [model, setModel] = useState(
    (initial?.config as { model?: string })?.model ?? "gpt-4o-mini",
  );

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">名称</span>
          <input
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My OpenClaw Client"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">类型</span>
          <select
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "openclaw" | "llm")}
          >
            <option value="openclaw">OpenClaw (CLI Bridge)</option>
            <option value="llm">LLM (OpenAI 兼容)</option>
          </select>
        </label>
      </div>

      {type === "openclaw" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Bridge URL</span>
            <input
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">超时 (秒)</span>
            <input
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              type="number"
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Base URL</span>
            <input
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">API Key</span>
              <input
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">模型</span>
              <input
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        设为默认 Client
      </label>

      <div className="flex gap-2">
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={() => {
            const config =
              type === "openclaw"
                ? { bridgeUrl, timeoutSeconds: Number(timeoutSeconds) }
                : { baseUrl, apiKey, model };
            onSave({ name, type, config, isDefault });
          }}
        >
          保存
        </button>
        <button
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function AiClientsPage() {
  const [clients, setClients] = useState<AiClientInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    const res = await fetch("/api/ai/clients");
    const data = await res.json();
    setClients(data.clients ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleCreate = async (data: {
    name: string;
    type: "openclaw" | "llm";
    config: Record<string, unknown>;
    isDefault: boolean;
  }) => {
    await fetch("/api/ai/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowForm(false);
    fetchClients();
  };

  const handleUpdate = async (
    id: string,
    data: {
      name: string;
      type: "openclaw" | "llm";
      config: Record<string, unknown>;
      isDefault: boolean;
    },
  ) => {
    await fetch(`/api/ai/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditingId(null);
    fetchClients();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/ai/clients/${id}`, { method: "DELETE" });
    fetchClients();
  };

  const handleToggleBinding = async (
    clientId: string,
    feature: string,
    currentlyBound: boolean,
  ) => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    let newFeatures: string[];
    if (currentlyBound) {
      newFeatures = client.bindings.filter((f) => f !== feature);
    } else {
      newFeatures = [...client.bindings, feature];
    }

    await fetch(`/api/ai/clients/${clientId}/bindings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: newFeatures }),
    });
    fetchClients();
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    await fetch(`/api/ai/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchClients();
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-sm text-muted-foreground">
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI Clients</h1>
          <p className="text-sm text-muted-foreground">
            管理 AI 客户端并配置各功能使用的客户端
          </p>
        </div>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => setShowForm(true)}
        >
          + 添加 Client
        </button>
      </div>

      {showForm && (
        <ClientForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {clients.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有配置 AI Client。点击上方按钮添加一个。
        </div>
      )}

      {clients.map((client) => (
        <div
          key={client.id}
          className="rounded-xl border bg-card p-4 space-y-3"
        >
          {editingId === client.id ? (
            <ClientForm
              initial={client}
              onSave={(data) => handleUpdate(client.id, data)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-medium">{client.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {client.type}
                    </span>
                    {client.isDefault && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        默认
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={client.enabled}
                      onChange={(e) =>
                        handleToggleEnabled(client.id, e.target.checked)
                      }
                    />
                    启用
                  </label>
                  <button
                    className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => setEditingId(client.id)}
                  >
                    编辑
                  </button>
                  <button
                    className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(client.id)}
                  >
                    删除
                  </button>
                </div>
              </div>

              {/* Feature bindings */}
              <div className="flex flex-wrap gap-2">
                {ALL_FEATURES.map((feature) => {
                  const isBound = client.bindings.includes(feature);
                  return (
                    <button
                      key={feature}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        isBound
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted text-muted-foreground hover:border-primary/50"
                      }`}
                      onClick={() =>
                        handleToggleBinding(client.id, feature, isBound)
                      }
                    >
                      {FEATURE_LABELS[feature] ?? feature}
                    </button>
                  );
                })}
              </div>

              {/* Config summary */}
              <div className="text-xs text-muted-foreground">
                {client.type === "openclaw" ? (
                  <span>
                    Bridge:{" "}
                    {(client.config as { bridgeUrl?: string }).bridgeUrl ?? "—"}
                  </span>
                ) : (
                  <span>
                    {(client.config as { baseUrl?: string }).baseUrl ?? "—"} ·{" "}
                    {(client.config as { model?: string }).model ?? "default"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
