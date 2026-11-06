import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createStewardService, StewardError, CallError, type StewardPorts, type StewardService } from "@chrona/engine";
import { createLogger } from "@chrona/logging";

import { hasLoopbackPeer, type ServerBindings } from "../request-peer";

const log = createLogger("apps.server.steward-agent");

const failure = (code: string, message = code) => ({ ok: false as const, error: { code, message } });
export function createStewardAgentRoutes(ports: StewardPorts, service: StewardService = createStewardService(ports)) {
  const endpoint = service.tools;
  const router = new Hono<{ Bindings: ServerBindings; Variables: { token: string; catalog: Awaited<ReturnType<typeof endpoint.catalog>> } }>();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (["x-forwarded-for", "x-real-ip", "forwarded"].some(header => c.req.header(header) !== undefined)) return c.json(failure("FORBIDDEN"), 403);
    if (!hasLoopbackPeer(c.env, c.req.raw)) return c.json(failure("FORBIDDEN"), 403);
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return c.json(failure("UNAUTHORIZED"), 401);
    try { c.set("catalog", await endpoint.catalog(token)); }
    catch (error) { if (error instanceof StewardError && error.code === "forbidden") return c.json(failure("UNAUTHORIZED"), 401); throw error; }
    c.set("token", token);
    await next();
  });
  router.use("*", bodyLimit({ maxSize: 128 * 1024, onError: c => c.json(failure("BODY_TOO_LARGE"), 413) }));
  router.get("/catalog", c => c.json({ tools: c.get("catalog").map(({ inputSchema, ...tool }) => ({ ...tool, description: inputSchema.description ?? tool.name, parameters: inputSchema })) }));
  router.post("/tools/:name", async c => {
    // v2-13: the caller says how long this call may take; Chrona caps it (and at the run's deadline).
    const asked = Number(c.req.header("x-chrona-timeout-seconds")), timeoutSeconds = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, 600) : undefined;
    if (timeoutSeconds) (c.env as ServerBindings | undefined)?.server?.timeout?.(c.req.raw, timeoutSeconds + 10);
    return c.json({ ok: true, data: await endpoint.call(c.get("token"), c.req.param("name"), await c.req.json(), { timeoutSeconds }) });
  });
  router.onError((error, c) => {
    if (error instanceof SyntaxError) return c.json(failure("INVALID_JSON"), 400);
    if (error instanceof StewardError) return c.json(failure(error.code, error.message), { forbidden: 403, invalid: 400, not_found: 404, conflict: 409 }[error.code] as 400 | 403 | 404 | 409);
    if (error instanceof CallError) return c.json(failure(error.code, error.message), error.code === "unavailable" ? 503 : 409);
    // The Provider only sees INTERNAL_ERROR; keep the cause (redacted) in the service log so it can be diagnosed.
    log.error("tool.internal_error", { path: c.req.path, error: error instanceof Error ? (error.stack ?? error.message).slice(0, 4000) : String(error).slice(0, 4000) });
    return c.json(failure("INTERNAL_ERROR"), 500);
  });
  return router;
}
