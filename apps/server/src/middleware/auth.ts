import type { MiddlewareHandler } from "hono";

const SKIP_PATHS = ["/api/health", "/health"];

export function apiKeyAuth(): MiddlewareHandler {
  const expectedKey = process.env.API_KEY;

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

    if (providedKey !== expectedKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}
