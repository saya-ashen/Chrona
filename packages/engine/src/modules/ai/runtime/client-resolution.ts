import { aiClientRegistry } from "../../../../../../features/ai-clients/server";
import { db } from "@/lib/db";
import type { AiFeature, EngineAiClient } from "../../../../../../features/ai-clients/server";

export async function getAiClient(
  clientId?: string | null,
): Promise<EngineAiClient | null> {
  return aiClientRegistry.get(clientId);
}

export async function getAiClientForFeature(feature: AiFeature): Promise<EngineAiClient | null> {
  return aiClientRegistry.getForFeature(feature);
}

export async function getAiClientForTask(input: {
  taskId: string;
  purpose: "task.plan" | "task.execution";
}): Promise<EngineAiClient | null> {
  const task = await db.task.findUnique({ where: { id: input.taskId }, select: { aiClientId: true } });
  return task?.aiClientId ? getAiClient(task.aiClientId) : getAiClientForFeature(input.purpose);
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
