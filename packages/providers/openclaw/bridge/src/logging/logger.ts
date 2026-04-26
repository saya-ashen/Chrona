import { LOG_LEVEL_ORDER } from "../shared/constants";
import type { BridgeLogEntry, BridgeLogger, LogLevel } from "../shared/types";

const MAX_STRING_LENGTH = 800;
const SENSITIVE_KEY_PATTERN = /(authorization|token|secret|password|api[-_]?key|cookie|set-cookie)/i;

function parseLogLevel(value: string | undefined): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "info";
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey),
    ]),
  );
}

export function sanitizeForLog(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return sanitizeValue(data) as Record<string, unknown>;
}

export function createBridgeLogger(options?: {
  minLevel?: LogLevel;
  sink?: (entry: BridgeLogEntry) => void;
}): BridgeLogger {
  const minLevel =
    options?.minLevel ?? parseLogLevel(process.env.OPENCLAW_BRIDGE_LOG_LEVEL);
  const sink =
    options?.sink ??
    ((entry: BridgeLogEntry) => console.log(JSON.stringify(entry)));

  const shouldLog = (level: LogLevel) =>
    LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];

  const emit = (
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ) => {
    if (!shouldLog(level)) return;
    sink({
      ts: new Date().toISOString(),
      level,
      event,
      data: sanitizeForLog(data),
    });
  };

  return {
    debug: (event, data) => emit("debug", event, data),
    info: (event, data) => emit("info", event, data),
    warn: (event, data) => emit("warn", event, data),
    error: (event, data) => emit("error", event, data),
  };
}
