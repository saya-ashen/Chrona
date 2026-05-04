export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function safeParseJsonArguments(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
  return parseJsonObject(value);
}
