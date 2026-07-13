import { HermesProviderClient } from "@chrona/hermes";
import {
  CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
  ClaudeCodeProviderClient,
} from "@chrona/claude-code";
import { CHRONA_CODEX_PROVIDER_TYPE, CodexProviderClient } from "@chrona/codex";
import { CHRONA_OMP_PROVIDER_TYPE, OmpProviderClient } from "@chrona/omp";
import {
  CHRONA_DEBUG_PROVIDER_TYPE,
  ChronaDebugProviderClient,
  normalizeDebugProviderProfile,
} from "@chrona/providers-debug";
import { db } from "@chrona/db";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type {
  AgentProviderClientConfig,
  AiClientRecord,
  AiFeature,
  AiClientType,
  ClaudeCodeClientConfig,
  CodexClientConfig,
  OmpClientConfig,
  HermesClientConfig,
  LLMClientConfig,
  DebugClientConfig,
  DebugProviderProfile,
} from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";

type StoredAiClient = {
  id: string;
  name: string;
  type: string;
  config: unknown;
  isDefault: boolean;
  enabled: boolean;
};

export type DebugProfiledProviderClient = AgentProviderClient & {
  debugProfile?: DebugProviderProfile;
};

export type EngineAiClient = {
  record: AiClientRecord;
  providerClient: DebugProfiledProviderClient | null;
};

export type EngineProviderClient = EngineAiClient & {
  record: AiClientRecord & { config: AgentProviderClientConfig };
  providerClient: AgentProviderClient;
};

export type EngineLlmClient = EngineAiClient & {
  record: AiClientRecord & { type: "llm"; config: LLMClientConfig };
  providerClient: null;
};

export type EngineHermesClient = EngineAiClient & {
  record: AiClientRecord & { type: "hermes"; config: HermesClientConfig };
  providerClient: AgentProviderClient;
};

export type EngineDebugClient = EngineAiClient & {
  record: AiClientRecord & { type: "debug"; config: DebugClientConfig };
  providerClient: AgentProviderClient;
};

export type EngineClaudeCodeClient = EngineAiClient & {
  record: AiClientRecord & { type: "claude_code"; config: ClaudeCodeClientConfig };
  providerClient: AgentProviderClient;
};

export type EngineCodexClient = EngineAiClient & {
  record: AiClientRecord & { type: "codex"; config: CodexClientConfig };
  providerClient: AgentProviderClient;
};

export type EngineOmpClient = EngineAiClient & {
  record: AiClientRecord & { type: "omp"; config: OmpClientConfig };
  providerClient: AgentProviderClient;
};

const clients = new Map<string, EngineAiClient>();
const featureClientIds = new Map<AiFeature, string>();
let defaultClientId: string | null = null;
let loaded = false;

function toAiClientRecord(client: StoredAiClient): AiClientRecord {
  return {
    id: client.id,
    name: client.name,
    type: client.type as AiClientType,
    config: client.config as AiClientRecord["config"],
    isDefault: client.isDefault,
    enabled: client.enabled,
  };
}

function engineBaseUrl(): string {
  // The Chrona server publishes itself on CHRONA_PUBLIC_URL when set, then
  // falls back to the port the HTTP server actually binds. That port comes
  // from `PORT` (apps/server/src/config/env.ts, default 3101) — NOT
  // `CHRONA_PORT`, which the server never reads. Using the wrong env name
  // here defaulted the MCP base URL to :3000 and made every in-process MCP
  // probe hit an unrelated service (HTTP 405). `CHRONA_PORT` is kept only as
  // a legacy fallback for older deployments that set it.
  const explicit = readEnv("CHRONA_PUBLIC_URL");
  if (explicit) return stripTrailingSlash(explicit);
  const port = readEnv("PORT") ?? readEnv("CHRONA_PORT") ?? "3101";
  return `http://localhost:${port}`;
}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function getProviderBaseUrl(
  config: AgentProviderClientConfig,
): string | undefined {
  const url = config.baseUrl;
  if (!url) return undefined;

  const trimmed = url.trim().replace(/\/$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function createProviderClient(
  record: AiClientRecord,
): EngineAiClient["providerClient"] {
  if (record.type === "hermes") {
    const config = record.config as HermesClientConfig;
    return new HermesProviderClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
    });
  }

  if (record.type === CHRONA_CLAUDE_CODE_PROVIDER_TYPE) {
    const config = record.config as ClaudeCodeClientConfig;
    return new ClaudeCodeProviderClient({
      config: {
        ...config,
        // Default the MCP base URL to the engine's own server when the
        // user did not configure one explicitly. The provider package's
        // own fallback (localhost:3000) is still consulted inside the
        // client for `runner` tests; production paths go through here.
        mcpBaseUrl: config.mcpBaseUrl ?? engineBaseUrl(),
      },
    });
  }

  if (record.type === CHRONA_CODEX_PROVIDER_TYPE) {
    const config = record.config as CodexClientConfig;
    return new CodexProviderClient({
      config: {
        ...config,
        mcpBaseUrl: engineBaseUrl(),
      },
    });
  }

  if (record.type === CHRONA_OMP_PROVIDER_TYPE) {
    const config = record.config as OmpClientConfig;
    return new OmpProviderClient({ config });
  }

  if (record.type === CHRONA_DEBUG_PROVIDER_TYPE) {
    const config = record.config as DebugClientConfig;
    const client = new ChronaDebugProviderClient({
      profile: normalizeDebugProviderProfile(config.profile),
    });
    return Object.assign(client, { debugProfile: client.profile });
  }

  return null;
}

async function refreshAiClientRegistry() {
  const records = await db.aiClient.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });

  clients.clear();
  defaultClientId = null;
  featureClientIds.clear();

  for (const client of records) {
    const record = toAiClientRecord(client);
    clients.set(record.id, {
      record,
      providerClient: createProviderClient(record),
    });
    if (record.isDefault && !defaultClientId) {
      defaultClientId = record.id;
    }
  }

  if (!defaultClientId && records[0]) {
    defaultClientId = records[0].id;
  }

  const bindings = await db.aiFeatureBinding.findMany({
    where: { clientId: { in: [...clients.keys()] } },
    orderBy: { createdAt: "asc" },
  });

  for (const binding of bindings) {
    featureClientIds.set(binding.feature as AiFeature, binding.clientId);
  }

  loaded = true;
}

async function ensureAiClientRegistryLoaded() {
  if (!loaded) {
    await refreshAiClientRegistry();
  }
}

async function getAiClient(
  clientId?: string | null,
): Promise<EngineAiClient | null> {
  await ensureAiClientRegistryLoaded();

  if (clientId) {
    return clients.get(clientId) ?? null;
  }

  return defaultClientId ? (clients.get(defaultClientId) ?? null) : null;
}

async function getAiClientForFeature(feature: AiFeature): Promise<EngineAiClient | null> {
  await ensureAiClientRegistryLoaded();
  const clientId = featureClientIds.get(feature);
  return clientId ? (clients.get(clientId) ?? getAiClient()) : getAiClient();
}

function requireProviderClient(client: EngineAiClient): EngineProviderClient {
  if (!client.providerClient) {
    throw new AiClientError(
      "Provider client is required",
      client.record.type,
      "internal",
    );
  }

  return client as EngineProviderClient;
}

function requireLlmClient(client: EngineAiClient): EngineLlmClient {
  if (client.record.type !== "llm") {
    throw new AiClientError(
      "LLM client is required",
      client.record.type,
      "internal",
    );
  }

  return client as EngineLlmClient;
}

async function listRegisteredAiClients(): Promise<AiClientRecord[]> {
  await ensureAiClientRegistryLoaded();
  return [...clients.values()].map((client) => client.record);
}

export class AiClientRegistry {
  refresh() {
    return refreshAiClientRegistry();
  }

  get(clientId?: string | null) {
    return getAiClient(clientId);
  }

  getForFeature(feature: AiFeature) {
    return getAiClientForFeature(feature);
  }

  requireProviderClient(client: EngineAiClient) {
    return requireProviderClient(client);
  }

  requireLlmClient(client: EngineAiClient) {
    return requireLlmClient(client);
  }

  list() {
    return listRegisteredAiClients();
  }
}

export const aiClientRegistry = new AiClientRegistry();
