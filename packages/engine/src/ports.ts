export interface ChronaEngineLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface ChronaEnginePorts {
  db?: unknown;
  logger?: ChronaEngineLogger;
  runtimeRegistry?: unknown;
  aiClients?: unknown;
}
