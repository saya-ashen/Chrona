import { aiClientRegistry } from "./client-registry";
import type { EngineAiClient } from "./client-registry";

export async function getAiClient(
  clientId?: string | null,
): Promise<EngineAiClient | null> {
  return aiClientRegistry.get(clientId);
}

export async function requireAiClient(
  clientId?: string | null,
  message = "AI client is required",
): Promise<EngineAiClient> {
  const client = await getAiClient(clientId);
  if (!client) {
    throw new Error(message);
  }
  return client;
}
