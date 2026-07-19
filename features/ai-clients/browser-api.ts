import { apiJson } from "@shared/http";

export type AiClientPayload = {
  name: string;
  type: string;
  config: Record<string, unknown>;
  isDefault: boolean;
};

export type AiClientMutationPayload = Partial<AiClientPayload> & {
  enabled?: boolean;
};

type HermesPayload = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
};

export type AiClientTestResponse = {
  available?: boolean;
  reason?: string;
  error?: string;
};

export type HermesIntegrationResponse = {
  diagnostics: {
    mode: "local" | "remote" | "unknown";
    restartRequired: boolean;
    checks: Array<{
      key: string;
      status: "ok" | "warning" | "error" | "unknown" | "skipped";
      message: string;
    }>;
  };
  plan: {
    summary: string;
    canRunAutomatically: boolean;
    actions: Array<{
      key: string;
      kind: "automatic" | "manual";
      reason: string;
      blocked?: boolean;
    }>;
  };
  apiKey?: string;
  maskedApiKey?: string;
  changed?: string[];
  restart?: { ok: boolean; message: string; exitCode: number | null };
};

export type AiClientsListResponse = {
  clients?: Array<{
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    isDefault: boolean;
    enabled: boolean;
    bindings: string[];
    createdAt: string;
  }>;
};

export type RuntimeProvidersResponse = {
  providers?: unknown[];
};

export type AiClientDiagnosticsResponse = {
  diagnostics: null | {
    provider: string;
    model: string | null;
    contextWindow: number | null;
    contextStrategy: string;
    workingDirectory: string;
    configDirectory: string | null;
    agentDirectory: string | null;
    configurationCapabilities: {
      tooling: {
        mcp: { supported: boolean; enabled: boolean };
        lsp: { supported: boolean; enabled: boolean };
        subagents: { supported: boolean; enabled: boolean };
        enabledTools: string[];
      };
    };
    sources: {
      model: "provider_default" | "provider_override" | "task_override" | "runtime";
      context: "provider_default" | "provider_override" | "task_override" | "runtime";
      configDirectory: "provider_default" | "provider_override" | "task_override" | "runtime";
      agentDirectory: "provider_default" | "provider_override" | "task_override" | "runtime";
      tools: "provider_default" | "provider_override" | "task_override" | "runtime";
    };
  };
};

export const aiClientsApi = {
  list: () => apiJson<AiClientsListResponse>("/api/ai/clients"),
  listRuntimeProviders: () => apiJson<RuntimeProvidersResponse>("/api/runtime/providers"),
  diagnostics: (clientId: string) => apiJson<AiClientDiagnosticsResponse>(
    `/api/ai/clients/${clientId}/diagnostics`,
  ),
  create: (payload: AiClientPayload) => apiJson<{ client?: { id?: string } }>(
    "/api/ai/clients",
    { method: "POST", body: JSON.stringify(payload) },
  ),
  update: (clientId: string, payload: AiClientMutationPayload) => apiJson<unknown>(
    `/api/ai/clients/${clientId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  ),
  delete: (clientId: string) => apiJson<unknown>(`/api/ai/clients/${clientId}`, {
    method: "DELETE",
  }),
  updateBindings: (clientId: string, features: string[]) => apiJson<{ bindings: string[] }>(
    `/api/ai/clients/${clientId}/bindings`,
    { method: "PUT", body: JSON.stringify({ features }) },
  ),
  test: (payload: AiClientPayload) => apiJson<AiClientTestResponse>("/api/ai/clients/test", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  diagnoseHermes: (payload: HermesPayload) => apiJson<HermesIntegrationResponse>(
    "/api/integrations/hermes/diagnose",
    { method: "POST", body: JSON.stringify(payload) },
  ),
  setupLocalHermes: (payload: HermesPayload) => apiJson<HermesIntegrationResponse>(
    "/api/integrations/hermes/setup-local",
    { method: "POST", body: JSON.stringify(payload) },
  ),
  restartLocalHermes: () => apiJson<{ ok: boolean; message: string; exitCode: number | null }>(
    "/api/integrations/hermes/restart-local",
    { method: "POST" },
  ),
};
