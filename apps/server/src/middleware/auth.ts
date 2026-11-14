import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getApiMessages, getPreferredLocale } from "@chrona/i18n";
import { readEnv } from "../config/env";
import type { createBrowserAuth } from "../browser-auth";

const SKIP_PATHS = ["/api/health", "/health"];

type ApiKeyAuthOptions = {
  browserAuth?: Pick<Awaited<ReturnType<typeof createBrowserAuth>>, "passwordSet" | "authenticate" | "isSameOrigin">;
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

/** New owner-only surfaces must not reinterpret a scoped bearer as anonymous
 * local authority when API_KEY is unset. The ordinary API middleware is unchanged. */
export function isLocalOwnerAuthorized(authorization: string | undefined) {
  const expected = readEnv().API_KEY;
  if (!expected) return authorization === undefined;
  return matchesApiKey(authorization?.startsWith("Bearer ") ? authorization.slice(7) : null, expected);
}

function skipsOwnerAuth(path: string, method: string, options: ApiKeyAuthOptions) {
  return method === "OPTIONS" || SKIP_PATHS.includes(path) || options.isExempt?.(path, method);
}
function matchesBearer(authorization: string | undefined, expectedKey: string | undefined) {
  return Boolean(expectedKey && matchesApiKey(authorization?.startsWith("Bearer ") ? authorization.slice(7) : null, expectedKey));
}

export function apiKeyAuth(
  options: ApiKeyAuthOptions = {},
): MiddlewareHandler {
  const expectedKey = readEnv().API_KEY;

  if (!expectedKey && !options.browserAuth) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    if (skipsOwnerAuth(c.req.path, c.req.method, options)) return next();
    if (matchesBearer(c.req.header("authorization"), expectedKey)) return next();

    if (options.browserAuth?.authenticate(c.req.raw)) {
      if (!options.browserAuth.isSameOrigin(c.req.raw)) return c.json({ error: "Same-origin request required" }, 403);
      return next();
    }
    if (!expectedKey && !options.browserAuth?.passwordSet()) return next();

    const messages = getApiMessages(getPreferredLocale(c.req.header("accept-language")));
    return c.json({ error: messages.unauthorized }, 401);
  };
}
