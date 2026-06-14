import { HermesProviderClient } from "@chrona/hermes";
import {
  CHRONA_CLAUDE_CODE_PROVIDER_TYPE,
  ClaudeCodeProviderClient,
} from "@chrona/claude-code";
import {
  CHRONA_DEBUG_PROVIDER_TYPE,
  ChronaDebugProviderClient,
  normalizeDebugProviderProfile,
} from "@chrona/providers-debug";
import { db } from "@/lib/db";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type {
  AgentProviderClientConfig,
  AiClientRecord,
  AiClientType,
  ClaudeCodeClientConfig,
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

const clients = new Map<string, EngineAiClient>();
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
  // The Chrona server publishes itself on CHRONA_PUBLIC_URL when set, or
  // falls back to CHRONA_PORT / 3000 on the loopback interface. We avoid
  // introducing new env names; these are the same ones the server boot
  // path already consults.
  const explicit = readEnv("CHRONA_PUBLIC_URL");
  if (explicit) return stripTrailingSlash(explicit);
  const port = readEnv("CHRONA_PORT") ?? "3000";
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
