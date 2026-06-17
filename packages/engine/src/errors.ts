export const ENGINE_ERROR_CODES = {
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  WORKSPACE_NOT_FOUND: "WORKSPACE_NOT_FOUND",
  PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
  INVALID_TASK_STATE: "INVALID_TASK_STATE",
  PLAN_GENERATION_IN_FLIGHT: "PLAN_GENERATION_IN_FLIGHT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
  AI_CLIENT_NOT_FOUND: "AI_CLIENT_NOT_FOUND",
} as const;

export type EngineErrorCode =
  (typeof ENGINE_ERROR_CODES)[keyof typeof ENGINE_ERROR_CODES];

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EngineError";
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}

export function engineErrorFromUnknown(
  cause: unknown,
  fallbackCode: EngineErrorCode,
  fallbackMessage: string,
): EngineError {
  if (cause instanceof EngineError) {
    return cause;
  }

  const message = cause instanceof Error ? cause.message : fallbackMessage;
  const normalized = message.toLowerCase();

  if (
    normalized.includes("workspace not found") ||
    normalized.includes("no 'workspace' record")
  ) {
    return new EngineError(ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Workspace not found", {
      cause,
    });
  }

  if (
    normalized.includes("task not found") ||
    normalized.includes("no 'task' record") ||
    normalized.includes("no record was found for a query") ||
    normalized.includes("record to update not found")
  ) {
    return new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found", {
      cause,
    });
  }

  if (
    normalized.includes("plan not found") ||
    normalized.includes("no plan found") ||
    normalized.includes("task plan graph not found")
  ) {
    return new EngineError(ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Plan not found", {
      cause,
    });
  }

  if (normalized.includes("client not found")) {
    return new EngineError(ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND, "Client not found", {
      cause,
    });
  }

  return new EngineError(fallbackCode, message, { cause });
}
