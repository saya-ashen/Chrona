import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createStewardService, StewardError, type StewardService } from "@chrona/engine";
import type { StewardRoutePorts } from "./steward.routes";

const failure = (code: string) => ({ ok: false as const, error: { code, message: code } });
export function createStewardAgentRoutes(ports: StewardRoutePorts, service: StewardService = createStewardService(ports)) {
  const endpoint = service.tools;
  const router = new Hono<{ Variables: { token: string; catalog: Awaited<ReturnType<typeof endpoint.catalog>> } }>();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (["x-forwarded-for", "x-real-ip", "forwarded"].some(header => c.req.header(header) !== undefined)) return c.json(failure("FORBIDDEN"), 403);
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json(failure("UNAUTHORIZED"), 401);
    try { c.set("catalog", await endpoint.catalog(token)); }
    catch (error) { if (error instanceof StewardError && error.code === "forbidden") return c.json(failure("UNAUTHORIZED"), 401); throw error; }
    c.set("token", token);
    await next();
  });
  router.use("*", bodyLimit({ maxSize: 128 * 1024, onError: c => c.json(failure("BODY_TOO_LARGE"), 413) }));
  router.get("/catalog", c => c.json({ tools: c.get("catalog").map(({ inputSchema, ...tool }) => ({ ...tool, description: tool.name, parameters: inputSchema })) }));
  router.post("/tools/:name", async c => c.json({ ok: true, data: await endpoint.call(c.get("token"), c.req.param("name"), await c.req.json()) }));
  router.onError((error, c) => {
    if (error instanceof SyntaxError) return c.json(failure("INVALID_JSON"), 400);
    if (error instanceof StewardError) return c.json(failure(error.code), { forbidden: 403, invalid: 400, not_found: 404, conflict: 409 }[error.code] as 400 | 403 | 404 | 409);
    return c.json(failure("INTERNAL_ERROR"), 500);
  });
  return router;
}
