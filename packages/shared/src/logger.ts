type LogLevel = "debug" | "info" | "warn" | "error";

type LogData = Record<string, unknown>;

function truncateValue(value: unknown, maxLength = 400): unknown {
  if (typeof value === "string") {
    return value.length > maxLength
      ? `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)`
      : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => truncateValue(item, maxLength));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        truncateValue(nested, maxLength),
      ]),
    );
  }

  return value;
}

function emit(level: LogLevel, scope: string, event: string, data?: LogData) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    data: data ? truncateValue(data) : undefined,
  };

  if (level === "error") {
    console.error(JSON.stringify(entry));
    return;
  }
  if (level === "warn") {
    console.warn(JSON.stringify(entry));
    return;
  }
  if (level === "info") {
    console.info(JSON.stringify(entry));
    return;
  }
  console.debug(JSON.stringify(entry));
}

export function createLogger(scope: string) {
  return {
    debug(event: string, data?: LogData) {
      emit("debug", scope, event, data);
    },
    info(event: string, data?: LogData) {
      emit("info", scope, event, data);
    },
    warn(event: string, data?: LogData) {
      emit("warn", scope, event, data);
    },
    error(event: string, data?: LogData) {
      emit("error", scope, event, data);
    },
  };
}

export function summarizeText(value: string | null | undefined, maxLength = 120) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}…(${trimmed.length - maxLength} more chars)`
    : trimmed;
}
