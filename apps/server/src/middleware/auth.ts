import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getApiMessages, getPreferredLocale } from "@chrona/i18n";
import { readEnv } from "../config/env";

const SKIP_PATHS = ["/api/health", "/health"];

function matchesApiKey(providedKey: string | null, expectedKey: string) {
  if (!providedKey) return false;
  const provided = Buffer.from(providedKey);
  const expected = Buffer.from(expectedKey);
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

export function apiKeyAuth(): MiddlewareHandler {
  const expectedKey = readEnv().API_KEY;

  if (!expectedKey) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    if (SKIP_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(p))) {
      return next();
    }

    if (c.req.method === "OPTIONS") {
      return next();
    }

    const authHeader = c.req.header("authorization");
    const providedKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!matchesApiKey(providedKey, expectedKey)) {
      const messages = getApiMessages(getPreferredLocale(c.req.header("accept-language")));
      return c.json({ error: messages.unauthorized }, 401);
    }

    return next();
  };
}
