/**
 * AI runtime entry points.
 * Resolves the current engine AI client, then delegates to provider adapters.
 */

import type {
  ChatRequest,
  ChatResponse,
  GenerateTaskPlanRequest,
  StreamEvent,
} from "@chrona/contracts";

import { chat } from "@/modules/ai/feature-normalizers";
import { generatePlanStream } from "@/modules/ai/features/generate-plan";
import { getAiClient } from "./client-resolution";

export async function aiChat(
  request: ChatRequest,
): Promise<ChatResponse | null> {
  const client = await getAiClient();
  if (!client) return null;
  return chat(client, request);
}

export async function* aiGeneratePlanStream(
  request: GenerateTaskPlanRequest,
): AsyncGenerator<StreamEvent> {
  const client = await getAiClient();
  if (!client) {
    yield {
      type: "error",
      message: "No AI client configured for task planning",
    };
    return;
  }

  for await (const event of generatePlanStream(client, request)) {
    yield event;
    if (request.signal?.aborted) {
      return;
    }
    if (event.type === "error" || event.type === "done") return;
  }
}
