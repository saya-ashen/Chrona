import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getApiMessages, getPreferredLocale } from "@chrona/i18n";
import { readEnv } from "../config/env";

const SKIP_PATHS = ["/api/health", "/health"];

type ApiKeyAuthOptions = {
  /**
   * Exempts an endpoint that owns a distinct, narrower authentication contract.
   * The caller must mount its endpoint-specific authentication after this middleware.
   */
  isExempt?: (path: string, method: string) => boolean;
};

function matchesApiKey(providedKey: string | null, expectedKey: string) {
  if (!providedKey) return false;
  const provided = Buffer.from(providedKey);
  const expected = Buffer.from(expectedKey);
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

export function apiKeyAuth(
  options: ApiKeyAuthOptions = {},
): MiddlewareHandler {
  const expectedKey = readEnv().API_KEY;

  if (!expectedKey) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    if (
      SKIP_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(p))
      || options.isExempt?.(c.req.path, c.req.method)
    ) {
      return next();
    }

    if (c.req.method === "OPTIONS") {
      return next();
    }

    const authHeader = c.req.header("authorization");
    const providedKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (matchesApiKey(providedKey, expectedKey)) return next();

    const messages = getApiMessages(getPreferredLocale(c.req.header("accept-language")));
    return c.json({ error: messages.unauthorized }, 401);
  };
}
