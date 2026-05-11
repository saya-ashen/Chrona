import { OpenClawClient } from "@chrona/openclaw";
import { db } from "@/lib/db";
import type {
  AiClientRecord,
  AiClientType,
  LLMClientConfig,
  OpenClawClientConfig,
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

export type EngineAiClient =
  | { record: AiClientRecord; providerClient: OpenClawClient }
  | { record: AiClientRecord; providerClient: null };

export type EngineOpenClawClient = EngineAiClient & {
  record: AiClientRecord & { type: "openclaw"; config: OpenClawClientConfig };
  providerClient: OpenClawClient;
};

export type EngineLlmClient = EngineAiClient & {
  record: AiClientRecord & { type: "llm"; config: LLMClientConfig };
  providerClient: null;
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

function getOpenClawGatewayUrl(config: OpenClawClientConfig): string | undefined {
  return typeof config.gatewayUrl === "string" && config.gatewayUrl
    ? config.gatewayUrl
    : config.bridgeUrl;
}

function createProviderClient(record: AiClientRecord): EngineAiClient["providerClient"] {
  if (record.type !== "openclaw") return null;

  const config = record.config as OpenClawClientConfig;
  return new OpenClawClient({
    gatewayUrl: getOpenClawGatewayUrl(config) ?? "",
    gatewayToken: config.gatewayToken ?? config.bridgeToken ?? "",
    model: config.model,
    timeoutSeconds: config.timeoutSeconds,
  });
}

export async function refreshAiClientRegistry() {
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

export async function getAiClient(
  clientId?: string | null,
): Promise<EngineAiClient | null> {
  await ensureAiClientRegistryLoaded();

  if (clientId) {
    return clients.get(clientId) ?? null;
  }

  return defaultClientId ? clients.get(defaultClientId) ?? null : null;
}

export function requireOpenClawClient(
  client: EngineAiClient,
): EngineOpenClawClient {
  if (client.record.type !== "openclaw" || !client.providerClient) {
    throw new AiClientError("OpenClaw client is required", client.record.type, "internal");
  }

  return client as EngineOpenClawClient;
}

export function requireLlmClient(client: EngineAiClient): EngineLlmClient {
  if (client.record.type !== "llm") {
    throw new AiClientError("LLM client is required", client.record.type, "internal");
  }

  return client as EngineLlmClient;
}

export async function listRegisteredAiClients(): Promise<AiClientRecord[]> {
  await ensureAiClientRegistryLoaded();
  return [...clients.values()].map((client) => client.record);
}
