type LogLevel = "debug" | "info" | "warn" | "error";
type LogData = Record<string, unknown>;

type WebLogger = {
  debug(event: string, data?: LogData): void;
  info(event: string, data?: LogData): void;
  warn(event: string, data?: LogData): void;
  error(event: string, data?: LogData): void;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function readLogLevel(): LogLevel | "silent" {
  const raw = import.meta.env.VITE_CHRONA_LOG_LEVEL?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error" || raw === "silent") {
    return raw;
  }
  return "info";
}

function isEnabled(level: LogLevel) {
  const configured = readLogLevel();
  return configured !== "silent" && LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)`
    : value;
}

function normalizeLogValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncateString(value.stack, 400) : undefined,
    };
  }
  if (typeof value === "string") return truncateString(value, 400);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => normalizeLogValue(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeLogValue(nested, seen)]),
  );
}

function normalizeLogData(data: LogData | undefined): LogData | undefined {
  if (!data) return undefined;
  return normalizeLogValue(data, new WeakSet()) as LogData;
}

function emit(level: LogLevel, scope: string, event: string, data?: LogData) {
  if (!isEnabled(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    data: normalizeLogData(data),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "info") {
    console.info(line);
    return;
  }
  console.debug(line);
}

export function createLogger(scope: string): WebLogger {
  return {
    debug(event, data) {
      emit("debug", scope, event, data);
    },
    info(event, data) {
      emit("info", scope, event, data);
    },
    warn(event, data) {
      emit("warn", scope, event, data);
    },
    error(event, data) {
      emit("error", scope, event, data);
    },
  };
}

export function summarizeText(value: string | null | undefined, maxLength = 120) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return truncateString(trimmed, maxLength);
}
