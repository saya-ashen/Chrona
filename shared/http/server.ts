import type { Context } from "hono";
import { ENGINE_ERROR_CODES, EngineError } from "@chrona/engine";
import { createLogger } from "@chrona/logging";

const logger = createLogger("shared.http.server");

export function json<T>(c: Context, payload: T, status: number = 200) {
  return c.json(payload, status as never);
}

export function error(c: Context, message: string, status: number = 400) {
  return json(c, { error: message }, status);
}

export function internalServerError(
  c: Context,
  route: string,
  cause: unknown,
  fallback: string,
) {
  logger.error("route.internal_error", { route, error: cause });
  return error(c, fallback, 500);
}


export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function toHttpError(errorValue: unknown) {
  if (errorValue instanceof HttpError) {
    return errorValue;
  }
  if (errorValue instanceof EngineError) {
    return new HttpError(engineErrorStatus(errorValue.code), errorValue.message);
  }
  if (isPrismaNotFoundError(errorValue)) {
    return new HttpError(404, "Record not found");
  }
  return null;
}

function isPrismaNotFoundError(errorValue: unknown) {
  return (
    typeof errorValue === "object" &&
    errorValue !== null &&
    "code" in errorValue &&
    errorValue.code === "P2025"
  );
}

function engineErrorStatus(code: string) {
  switch (code) {
    case ENGINE_ERROR_CODES.TASK_NOT_FOUND:
    case ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND:
    case ENGINE_ERROR_CODES.PLAN_NOT_FOUND:
    case ENGINE_ERROR_CODES.AI_CLIENT_NOT_FOUND:
      return 404;
    case ENGINE_ERROR_CODES.VALIDATION_FAILED:
    case ENGINE_ERROR_CODES.INVALID_TASK_STATE:
      return 400;
    case ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT:
    case ENGINE_ERROR_CODES.CONFLICT:
      return 409;
    default:
      return 500;
  }
}
