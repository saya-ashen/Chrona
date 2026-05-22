import { HermesProviderClient } from "@chrona/hermes";
import { OpenClawClient } from "@chrona/openclaw";
import { db } from "@/lib/db";
import { ChronaDebugProviderClient, isChronaDebugProviderConfig } from "./debug-provider-client";
import type { AgentProviderClient } from "@chrona/providers-foundation";
import type {
  AiClientRecord,
  AiClientType,
  HermesClientConfig,
  LLMClientConfig,
  OpenClawClientConfig,
} from "@chrona/contracts";
import { AiClientError, OPENCLAW_DEFAULT_MODEL } from "@chrona/contracts";

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

export type EngineOpenClawClient = EngineAiClient & {
  record: AiClientRecord & { type: "openclaw"; config: OpenClawClientConfig };
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

export function getOpenClawGatewayUrl(
  config: OpenClawClientConfig & { baseUrl?: string },
): string | undefined {
  const url = config.gatewayUrl || config.bridgeUrl || config.baseUrl;
  if (!url) return undefined;

  const trimmed = url.trim().replace(/\/$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function createProviderClient(
  record: AiClientRecord,
): EngineAiClient["providerClient"] {
  if (record.type === "hermes") {
    const config = record.config as HermesClientConfig;
    if (isChronaDebugProviderConfig(config)) {
      return new ChronaDebugProviderClient();
    }

    return new HermesProviderClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
    });
  }

  if (record.type !== "openclaw") return null;

  const config = record.config as OpenClawClientConfig;
  if (isChronaDebugProviderConfig(config)) {
    return new ChronaDebugProviderClient();
  }

  return new OpenClawClient({
    gatewayUrl: getOpenClawGatewayUrl(config) ?? "",
    gatewayToken: config.gatewayToken ?? config.bridgeToken ?? "",
    model: config.model?.trim() || OPENCLAW_DEFAULT_MODEL,
    timeoutSeconds: config.timeoutSeconds,
  });
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

function requireOpenClawClient(client: EngineAiClient): EngineOpenClawClient {
  const isDebugProvider = isChronaDebugProviderConfig(
    client.record.config as { baseUrl?: string; bridgeUrl?: string; gatewayUrl?: string },
  );
  if ((!isDebugProvider && client.record.type !== "openclaw") || !client.providerClient) {
    throw new AiClientError(
      "OpenClaw client is required",
      client.record.type,
      "internal",
    );
  }

  return client as EngineOpenClawClient;
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

  requireOpenClawClient(client: EngineAiClient) {
    return requireOpenClawClient(client);
  }

  requireLlmClient(client: EngineAiClient) {
    return requireLlmClient(client);
  }

  list() {
    return listRegisteredAiClients();
  }
}

export const aiClientRegistry = new AiClientRegistry();
