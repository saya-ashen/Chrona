import { AiClientError } from "./types";

export function parseTextJsonWithFallback<T>(
  raw: string,
  clientType: string,
): T {
  const jsonMatch =
    raw.match(/```(?:json|tool)?\s*\n?([\s\S]*?)```/) ??
    raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? raw;
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new AiClientError(
      `Failed to parse JSON: ${raw.slice(0, 200)}`,
      clientType,
      "invalid_response",
    );
  }
}
