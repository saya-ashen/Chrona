import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import {
  extractAssistantContent,
  type ExecutionProviderRequest,
} from "./ai-runtime-request";

export function isTerminalProviderSnapshot(response: ProviderRunSnapshot): boolean {
  return ["completed", "failed", "cancelled"].includes(response.status) || Boolean(response.error);
}

export function assistantMessage(
  response: ProviderRunSnapshot,
): Array<{ role: string; content: string }> {
  const content = extractAssistantContent(response);
  return content ? [{ role: "assistant", content }] : [];
}

export function extractUserText(request: ExecutionProviderRequest): string {
  try {
    return [request.instructions, JSON.stringify(request.input, null, 2)]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return [request.instructions, String(request.input)]
      .filter(Boolean)
      .join("\n\n");
  }
}
