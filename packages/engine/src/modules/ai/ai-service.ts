/**
 * AI Service — Backend layer's entry point for all AI operations.
 *
 * Loads AI client configs from database. Routes each feature request
 * to the client bound to that feature (via AiFeatureBinding).
 * No fallback chain — each feature uses exactly one configured client.
 */

import { db } from "@/lib/db";

import {
  type AiClientRecord,
  type AiClientType,
  type AiFeature,
  type SmartSuggestRequest,
  type GenerateTaskPlanRequest,
  type AnalyzeConflictsRequest,
  type AnalyzeConflictsResponse,
  type SuggestTimeslotRequest,
  type SuggestTimeslotResponse,
  type ChatRequest,
  type ChatResponse,
  type DispatchTaskInput,
  type DispatchTaskOutput,
  type StreamEvent,
} from "@chrona/contracts";
import {
  analyzeConflicts,
  suggestTimeslots,
  chat,
  dispatchTask,
} from "@/modules/ai/feature-normalizers";
import { checkClientHealth } from "@/modules/ai/providers";
import { suggestStream, generatePlanStream } from "@/modules/ai/streaming";

// ────────────────────────────────────────────────────────────────────
// Client Resolution
// ────────────────────────────────────────────────────────────────────

/**
 * Get the client bound to a specific feature.
 * Falls back to the default client if no binding exists.
 * Returns null if no client is configured.
 */
async function getClientForFeature(
  feature: AiFeature,
): Promise<AiClientRecord | null> {
  // Check feature binding first
  const binding = await db.aiFeatureBinding.findUnique({
    where: { feature },
    include: { client: true },
  });

  if (binding?.client?.enabled) {
    return {
      id: binding.client.id,
      name: binding.client.name,
      type: binding.client.type as AiClientType,
      config: binding.client.config as unknown as AiClientRecord["config"],
      isDefault: binding.client.isDefault,
      enabled: binding.client.enabled,
    };
  }

  // Fall back to default client
  const defaultClient = await db.aiClient.findFirst({
    where: { isDefault: true, enabled: true },
  });

  if (defaultClient) {
    return {
      id: defaultClient.id,
      name: defaultClient.name,
      type: defaultClient.type as AiClientType,
      config: defaultClient.config as unknown as AiClientRecord["config"],
      isDefault: defaultClient.isDefault,
      enabled: defaultClient.enabled,
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export async function aiAnalyzeConflicts(
  request: AnalyzeConflictsRequest,
): Promise<AnalyzeConflictsResponse | null> {
  const client = await getClientForFeature("conflicts");
  if (!client) return null;
  return analyzeConflicts(client, request);
}

export async function aiSuggestTimeslots(
  request: SuggestTimeslotRequest,
): Promise<SuggestTimeslotResponse | null> {
  const client = await getClientForFeature("timeslots");
  if (!client) return null;
  return suggestTimeslots(client, request);
}

export async function aiChat(
  request: ChatRequest,
): Promise<ChatResponse | null> {
  const client = await getClientForFeature("chat");
  if (!client) return null;
  return chat(client, request);
}

export async function aiDispatchTask(
  request: DispatchTaskInput,
): Promise<DispatchTaskOutput | null> {
  const client = await getClientForFeature("dispatch_task");
  if (!client) return null;
  return dispatchTask(client, request);
}

export async function* aiSuggestStream(
  request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
  const client = await getClientForFeature("suggest");
  if (!client) {
    yield { type: "error", message: "No AI client configured for suggestions" };
    return;
  }
  yield* suggestStream(client, request);
}

export async function* aiGeneratePlanStream(
  request: GenerateTaskPlanRequest,
): AsyncGenerator<StreamEvent> {
  console.log("Starting AI plan generation stream with request:", request);
  throw new Error("Test error in aiGeneratePlanStream");
  const client = await getClientForFeature("generate_plan");
  if (!client) {
    yield {
      type: "error",
      message: "No AI client configured for task planning",
    };
    return;
  }

  for await (const event of generatePlanStream(client, request)) {
    yield event;
    if (event.type === "error" || event.type === "done") return;
  }
}

export async function isAIAvailable(): Promise<boolean> {
  const clients = await db.aiClient.findMany({ where: { enabled: true } });
  if (clients.length === 0) return false;
  // Check at least one is healthy
  for (const c of clients) {
    const record: AiClientRecord = {
      id: c.id,
      name: c.name,
      type: c.type as AiClientType,
      config: c.config as unknown as AiClientRecord["config"],
      isDefault: c.isDefault,
      enabled: c.enabled,
    };
    if (await checkClientHealth(record)) return true;
  }
  return false;
}

export async function getAIClientInfo(): Promise<
  Array<{
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    enabled: boolean;
    bindings: string[];
  }>
> {
  const clients = await db.aiClient.findMany({
    include: { bindings: true },
    orderBy: { createdAt: "asc" },
  });
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    isDefault: c.isDefault,
    enabled: c.enabled,
    bindings: c.bindings.map((b) => b.feature),
  }));
}

// Re-exports
export type { TaskSnapshot, ScheduleHealthSnapshot } from "@chrona/contracts";
