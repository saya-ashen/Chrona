import type { Context } from "hono";

export function json<T>(c: Context, payload: T, status: number = 200) {
  return c.json(payload, status as never);
}

export function error(c: Context, message: string, status: number = 400) {
  return json(c, { error: message }, status);
}

export function internalServerError(c: Context, route: string, cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  console.error(`${route} error:`, cause);
  return error(c, message, 500);
}

export function requireQuery(c: Context, key: string) {
  const value = c.req.query(key);
  if (!value) {
    throw new HttpError(400, `${key} is required`);
  }
  return value;
}

export function parseLimit(value: string | undefined, defaultValue: number, max: number) {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "limit must be a valid integer");
  }

  return Math.min(Math.max(parsed, 1), max);
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
  return null;
}
