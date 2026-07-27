import { aiClientRegistry } from "./client-registry";
import { db } from "@chrona/db";
import type { AiFeature } from "@chrona/contracts";
import type { EngineAiClient } from "./client-registry";

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
  purpose:
    | "task.plan"
    | "task.execution"
    | "task.result_finalization"
    | "goal.asset_ownership"
    | "goal.review";
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
