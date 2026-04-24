import { LOG_LEVEL_ORDER } from "../shared/constants";
import type { BridgeLogEntry, BridgeLogger, LogLevel } from "../shared/types";

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
      data,
    });
  };

  return {
    debug: (event, data) => emit("debug", event, data),
    info: (event, data) => emit("info", event, data),
    warn: (event, data) => emit("warn", event, data),
    error: (event, data) => emit("error", event, data),
  };
}
