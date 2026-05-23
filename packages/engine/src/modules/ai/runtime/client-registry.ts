import { HermesProviderClient } from "@chrona/hermes";
import {
  CHRONA_DEBUG_PROVIDER_TYPE,
  ChronaDebugProviderClient,
} from "@chrona/providers-debug";
import { db } from "@/lib/db";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type {
  AgentProviderClientConfig,
  AiClientRecord,
  AiClientType,
  HermesClientConfig,
  LLMClientConfig,
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

export type EngineAiClient = {
  record: AiClientRecord;
  providerClient: AgentProviderClient | null;
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
  record: AiClientRecord & { type: "debug"; config: Record<string, never> };
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

  if (record.type === CHRONA_DEBUG_PROVIDER_TYPE) {
    return new ChronaDebugProviderClient();
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
