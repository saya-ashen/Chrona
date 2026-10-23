import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { resolveApprovalSchema } from "@chrona/contracts/steward";
import { StewardError, type StewardPorts, type StewardService } from "@chrona/engine";

/** No main-app middleware, cookies, CORS, or module routing on this origin. */
export function createRescueApp(ports: StewardPorts, service: StewardService, key: string, html: string) {
  const app = new Hono();
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = digest(`Bearer ${key}`);
  const hashes = (tag: string) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map(m => `'sha256-${digest(m[1]!).toString("base64")}'`).join(" ");
  const csp = `default-src 'none'; script-src ${hashes("script")}; style-src ${hashes("style")}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  app.use("*", async (c, next) => {
    c.header("Content-Security-Policy", csp);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (!key || !timingSafeEqual(expected, digest(c.req.header("authorization") ?? ""))) {
      // The static sign-in form contains no data. Even the page returns 401 without a bearer key.
      return c.req.path === "/" && c.req.method === "GET" ? c.html(html, 401) : c.json({ code: "UNAUTHORIZED" }, 401);
    }
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.onError((error, c) => {
    if (error instanceof StewardError) return c.json({ code: error.code, message: error.message }, { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 }[error.code] as 400 | 403 | 404 | 409);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ code: "INVALID_REQUEST" }, 400);
    return c.json({ code: "INTERNAL_ERROR" }, 500);
  });
  const api = () => service.forWorkspace("ws_default");
  app.get("/", c => c.html(html));
  app.get("/api/messages", async c => {
    const session = await ports.db.session.findFirst({ where: { workspaceId: "ws_default", key: "rescue", status: "active" } });
    return c.json({ items: session ? await api().chat.messages(200, session.id) : [] });
  });
  app.post("/api/chat", async c => {
    const { text } = z.object({ text: z.string().trim().min(1).max(20000) }).strict().parse(await c.req.json());
    const reply = await api().chat.handleMessage({ channel: "in_app", key: "rescue", text });
    const run = reply.runId ? await ports.db.run.findUnique({ where: { id: reply.runId }, select: { status: true } }) : null;
    if (!ports.provider || run?.status === "provider_unavailable" || run?.status === "failed") {
      for (const message of reply.messages) message.text = "Provider unavailable. Use chrona admin on the host to repair Chrona; approvals remain available here.";
    }
    return c.json(reply);
  });
  app.get("/api/approvals", async c => c.json({ items: await api().approvals.list("open") }));
  app.post("/api/approvals/:id/resolve", async c => c.json((await api().approvals.resolve(c.req.param("id"), resolveApprovalSchema.parse(await c.req.json()), "rescue")).approval));
  return app;
}

export function startRescueListener(ports: StewardPorts, service: StewardService, htmlPath: string, env = process.env, log: (message: string) => void = console.error) {
  if (!env.CHRONA_RESCUE_PORT) return;
  if (!env.RESCUE_KEY) { log("Rescue listener not started: RESCUE_KEY is required"); return; }
  const port = Number(env.CHRONA_RESCUE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { log("Rescue listener not started: invalid CHRONA_RESCUE_PORT"); return; }
  try {
    const app = createRescueApp(ports, service, env.RESCUE_KEY, readFileSync(htmlPath, "utf8"));
    return Bun.serve({ hostname: env.CHRONA_RESCUE_HOST ?? "127.0.0.1", port, idleTimeout: 120, fetch: app.fetch });
  } catch { log("Rescue listener could not start"); return; }
}
