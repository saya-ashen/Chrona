import { error, internalServerError, toHttpError } from "../lib/http";

export function routeFailure(c: Parameters<typeof error>[0], route: string, cause: unknown, fallback: string) {
  const httpError = toHttpError(cause);
  if (httpError) return error(c, httpError.message, httpError.status);
  return internalServerError(c, route, cause, fallback);
}
