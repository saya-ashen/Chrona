import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createStewardService, StewardError, type StewardService } from "@chrona/engine";
import type { StewardRoutePorts } from "./steward.routes";

const failure = (code: string) => ({ ok: false as const, error: { code, message: code } });

/** Local child capabilities only. Share the service with chat: concierge tokens are in-memory. */
export function createStewardAgentRoutes(ports: StewardRoutePorts, service: StewardService = createStewardService(ports)) {
  const router = new Hono<{ Variables: { token: string; catalog: Awaited<ReturnType<StewardService["agentEndpoint"]["catalog"]>> } }>();
  const endpoint = service.agentEndpoint;
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (["x-forwarded-for", "x-real-ip", "forwarded"].some(header => c.req.header(header) !== undefined)) return c.json(failure("FORBIDDEN"), 403);
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json(failure("UNAUTHORIZED"), 401);
    try {
      c.set("catalog", await endpoint.catalog(token));
    } catch (error) {
      if (error instanceof StewardError && error.code === "forbidden") return c.json(failure("UNAUTHORIZED"), 401);
      throw error;
    }
    c.set("token", token);
    await next();
  });
  router.use("*", bodyLimit({ maxSize: 64 * 1024, onError: c => c.json(failure("BODY_TOO_LARGE"), 413) }));
  router.get("/catalog", c => c.json({ tools: c.get("catalog").map(({ inputSchema, ...tool }) => ({ ...tool, parameters: inputSchema })) }));
  // No transport queue: affair writes are transactional; concierge serializes its own effects.
  router.post("/tools/:name", async c => {
    const result = await endpoint.callTool(c.get("token"), c.req.param("name"), await c.req.json());
    return c.json(result, !result.ok && result.error.code === "forbidden" ? 401 : 200);
  });
  router.post("/web/preflight", async c => {
    const result = await endpoint.webPreflight(c.get("token"), await c.req.json());
    return c.json(result, !result.allow && result.reason === "forbidden" ? 401 : 200);
  });
  router.post("/web/observed", async c => {
    const raw: unknown = await c.req.json();
    // Current extension sends obsolete titles; discard only that field, retaining strict engine validation.
    if (raw && typeof raw === "object" && !Array.isArray(raw)) delete (raw as Record<string, unknown>).titles;
    const result = await endpoint.webObserved(c.get("token"), raw);
    return c.json(result, !result.ok && result.error.code === "forbidden" ? 401 : 200);
  });
  // Never echo capabilities, tool inputs or model text through error logging.
  router.onError((error, c) => c.json(failure(error instanceof SyntaxError ? "INVALID_JSON" : "INTERNAL_ERROR"), error instanceof SyntaxError ? 400 : 500));
  return router;
}
