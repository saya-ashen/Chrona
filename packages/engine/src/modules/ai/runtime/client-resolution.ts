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
  // Planning and final result composition are durable Feature Runtime
  // operations. Their providers are selected independently from the task's
  // execution client. This lets a task execute with Claude Code or Codex while
  // OMP produces the reviewable plan and validated result presentation, and it
  // prevents execution-only clients from being invoked for unsupported roles.
  if (input.purpose === "task.plan" || input.purpose === "task.result_finalization") {
    return getAiClientForFeature(input.purpose);
  }

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
