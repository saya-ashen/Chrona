export const REDACTED = "[Redacted]";

const MAX_STRING_LENGTH = 400;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 50;
const SENSITIVE_KEY = /(?:api.?key|token|password|passphrase|secret|credential|authorization|bearer|cookie|mcp.?run.?token)/i;
const SENSITIVE_CONTAINER_KEY = /^(?:request|response|body|bodyExcerpt|headers|prompt|tool[_-]?(?:input|response|output)|raw)$/i;
const SENSITIVE_QUERY_KEY = /^(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|token|password|secret|authorization|auth|key|signature|sig)$/i;

export function truncateSafeText(value: string, maxLength = MAX_STRING_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)` : value;
}

function redactUrl(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s"']+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      let changed = false;
      if (url.username || url.password) {
        url.username = "";
        url.password = "";
        changed = true;
      }
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEY.test(key)) {
          url.searchParams.set(key, REDACTED);
          changed = true;
        }
      }
      return changed ? url.toString() : candidate;
    } catch {
      return candidate;
    }
  });
}

/** Browser- and server-safe credential redaction for text sent to logs. */
export function redactSensitiveText(value: string, maxLength = MAX_STRING_LENGTH): string {
  const redacted = redactUrl(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/(?:\b|["'])(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?(?:secret|token|key)|token|password|passphrase|secret|authorization)(?:\b|["'])\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, (_match, separator: string) => `credential${separator}${REDACTED}`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, REDACTED);
  return truncateSafeText(redacted, maxLength);
}

function isSensitiveKey(key: string): boolean {
  return key.trim().toLowerCase() === "key" || SENSITIVE_KEY.test(key);
}

function safeError(error: Error, maxLength: number, seen: WeakSet<object>): Record<string, unknown> {
  const record = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
  const result: Record<string, unknown> = {
    name: redactSensitiveText(error.name, maxLength),
    message: redactSensitiveText(error.message, maxLength),
  };
  if (typeof record.code === "string" || typeof record.code === "number") result.code = record.code;
  if (typeof record.status === "number") result.status = record.status;
  if (error.stack) result.stack = redactSensitiveText(error.stack, maxLength);
  if (record.cause !== undefined) result.cause = redactSensitiveValue(record.cause, { maxLength, seen });
  return result;
}

export type RedactionOptions = { maxLength?: number; seen?: WeakSet<object> };

/** Key-aware, bounded, recursive serializer that excludes credential-bearing containers. */
export function redactSensitiveValue(value: unknown, options: RedactionOptions = {}): unknown {
  const maxLength = options.maxLength ?? MAX_STRING_LENGTH;
  const seen = options.seen ?? new WeakSet<object>();
  if (value instanceof Error) return safeError(value, maxLength, seen);
  if (typeof value === "string") return redactSensitiveText(value, maxLength);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactSensitiveValue(item, { maxLength, seen }));

  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  return Object.fromEntries(entries.map(([key, nested]) => {
    if (isSensitiveKey(key) || SENSITIVE_CONTAINER_KEY.test(key)) return [key, REDACTED];
    return [key, redactSensitiveValue(nested, { maxLength, seen })];
  }));
}

export function serializeSafeError(error: unknown, maxLength = MAX_STRING_LENGTH): Record<string, unknown> {
  const serialized = redactSensitiveValue(error, { maxLength });
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized as Record<string, unknown>
    : { name: "Error", message: typeof serialized === "string" ? serialized : "Unknown error" };
}
