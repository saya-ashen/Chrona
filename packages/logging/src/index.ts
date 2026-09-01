import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";

import {
  REDACTED,
  redactSensitiveText,
  redactSensitiveValue,
  serializeSafeError,
  truncateSafeText,
  type RedactionOptions,
} from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogData = Record<string, unknown>;
export type LogBindings = Record<string, unknown>;
export type ChronaLogger = {
  child(bindings: LogBindings): ChronaLogger;
  isLevelEnabled(level: LogLevel): boolean;
  debug(event: string, data?: LogData): void;
  info(event: string, data?: LogData): void;
  warn(event: string, data?: LogData): void;
  error(event: string, data?: LogData): void;
};

export {
  REDACTED,
  redactSensitiveText,
  redactSensitiveValue,
  serializeSafeError,
  truncateSafeText,
  type RedactionOptions,
};

const DEFAULT_LOG_LEVEL = "info";
const REDACTION_PATHS = [
  "authorization",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "token",
  "apiKey",
  "api_key",
  "mcpRunToken",
  "password",
  "secret",
  "sourceUrl",
  "privateUrl",
  "prompt",
  "tool_input",
  "tool_response",
  "data.authorization",
  "data.Authorization",
  "data.headers.authorization",
  "data.headers.Authorization",
  "data.token",
  "data.apiKey",
  "data.api_key",
  "data.mcpRunToken",
  "data.password",
  "data.secret",
  "data.sourceUrl",
  "data.privateUrl",
  "data.prompt",
  "data.tool_input",
  "data.tool_response",
  "data.*.token",
  "data.*.apiKey",
  "data.*.api_key",
  "data.*.secret",
] as const;

function readLogLevel(): string {
  const value = process.env["CHRONA_LOG_LEVEL"]?.trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error" || value === "fatal" || value === "silent") return value;
  if (process.env["NODE_ENV"] === "test") return "silent";
  return DEFAULT_LOG_LEVEL;
}

function normalizeLogData(data: LogData | undefined): LogData | undefined {
  return data ? redactSensitiveValue(data) as LogData : undefined;
}

function createPinoLogger(): PinoLogger {
  const options: LoggerOptions = {
    base: undefined,
    level: readLogLevel(),
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: { level(label) { return { level: label }; } },
    redact: { paths: [...REDACTION_PATHS], censor: REDACTED },
  };
  return pino(options);
}

const rootLogger = createPinoLogger();
function wrapLogger(scope: string, logger: PinoLogger): ChronaLogger {
  const emit = (level: LogLevel, event: string, data?: LogData) => logger[level]({ scope, event, data: normalizeLogData(data) });
  return {
    child(bindings) { return wrapLogger(scope, logger.child(normalizeLogData(bindings) ?? {})); },
    isLevelEnabled(level) { return logger.isLevelEnabled(level); },
    debug(event, data) { emit("debug", event, data); },
    info(event, data) { emit("info", event, data); },
    warn(event, data) { emit("warn", event, data); },
    error(event, data) { emit("error", event, data); },
  };
}

export function createLogger(scope: string): ChronaLogger { return wrapLogger(scope, rootLogger); }
export const createChronaLogger = createLogger;
export function summarizeText(value: string | null | undefined, maxLength = 120) { return value == null ? null : redactSensitiveText(value.trim(), maxLength); }
