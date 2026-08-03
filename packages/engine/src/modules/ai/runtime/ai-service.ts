/**
 * AI runtime entry points.
 * Resolves the current engine AI client, then delegates to provider adapters.
 */

import type {
  ChatRequest,
  ChatResponse,
} from "@chrona/contracts";

import { chat } from "@/modules/ai/feature-normalizers";
import { getAiClient } from "./client-resolution";

export async function aiChat(
  request: ChatRequest,
): Promise<ChatResponse | null> {
  const client = await getAiClient();
  if (!client) return null;
  return chat(client, request);
}
