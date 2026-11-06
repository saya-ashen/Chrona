import { Hono } from "hono";
import { createStewardRuntime, type StewardRuntime } from "./steward-runtime";
import { bodyLimit } from "hono/body-limit";

import { getApiMessages, getPreferredLocale } from "@chrona/i18n";

import { createApiRouter } from "./routes/api";
import { createExecutorRouter, isExecutorPath, isExecutorOwnerPath } from "./executor-router";
import { completeOAuth, OAUTH_CALLBACK_PATH } from "@chrona/engine";
import { createLogger } from "@chrona/logging";
import { apiKeyAuth } from "./middleware/auth";
import { isTrustedRequestOrigin, readEnv, resolveAllowedOrigins } from "./config/env";

import type { ServerBindings } from "./request-peer";

const log = createLogger("apps.server");
const MAX_HTTP_BODY_BYTES = 21 * 1024 * 1024;

function isStewardAgentPath(path: string, method: string) {
  // These exact endpoints validate their own narrower credentials. Prefixes stay API-key protected.
  return (method === "GET" && path === "/api/steward-agent/catalog")
    || (method === "POST" && /^\/api\/steward-agent\/tools\/[^/]+$/.test(path));
}

function getAllowedOrigins() {
  return resolveAllowedOrigins(readEnv());
}

function resolveOrigin(origin: string | undefined, allowed: string[]) {
  if (!origin) return null;
  if (allowed.includes("*")) return "*";
  return allowed.includes(origin) ? origin : null;
}

/** Forwards a request to a module's HTTP socket without the user's credentials (v2-4 `listen`). */
async function proxy(socket: string, request: Request) {
  const url = new URL(request.url), headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  try {
    const response = await fetch(`http://module${url.pathname}${url.search}`, { unix: socket, method: request.method, headers, body: request.body, redirect: "manual", signal: request.signal });
    const out = new Headers(response.headers);
    out.delete("set-cookie");
    return new Response(response.body, { status: response.status, headers: out });
  } catch {
    return Response.json({ code: "MODULE_UNAVAILABLE" }, { status: 503 });
  }
}

function mountHealthRoutes(app: Hono<{ Bindings: ServerBindings }>,  steward: StewardRuntime) {
  app.get("/health", async (c) => c.json({ status: "ok", server: "chrona-hono", ...await steward.health() }));
  app.get("/ready", async (c) => {
    try {
      await steward.ports.db.$queryRawUnsafe("SELECT 1");
      return c.json({ status: "ready" });
    } catch {
      return c.json({ status: "not_ready" }, 503);
    }
  });
}

/**
 * Creates the Hono server app with all middleware and routes mounted.
 *
 * Returns a fresh app instance (factory pattern). The returned type is used
 * by the frontend hono/client RPC — import via:
 *   import type { AppType } from "@chrona/server/app";
 *   import { hc } from "hono/client";
 *   const client = hc<AppType>("/api");
 */
export async function createServerApp(options: { steward?: StewardRuntime } = {}) {
  const app = new Hono<{ Bindings: ServerBindings }>();
  const steward = options.steward ?? createStewardRuntime((await import("@chrona/db")).db);
  await steward.initialize();
  const api = createApiRouter({ steward });
  const allowedOrigins = getAllowedOrigins();

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!isTrustedRequestOrigin(c.req.url, origin, allowedOrigins)) {
      return c.json({ error: "Cross-origin API requests are not allowed" }, 403);
    }

    const corsOrigin = resolveOrigin(origin, allowedOrigins);
    if (corsOrigin) {
      c.header("Access-Control-Allow-Origin", corsOrigin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    }

    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });
  app.use("/api/editor/*", async (c, next) => {
    if (!readEnv().API_KEY?.trim()) return c.json({ code: "EDITOR_AUTH_UNCONFIGURED" }, 503);
    await next();
  });
  app.use("/api/*", async (c, next) => {
    if (isExecutorOwnerPath(c.req.path, c.req.method)) {
      c.header("Cache-Control", "no-store");
      if (!readEnv().API_KEY?.trim()) return c.json({ code: "EXECUTOR_OWNER_AUTH_UNCONFIGURED" }, 503);
    }
    await next();
  });
  app.use("/api/*", apiKeyAuth({ isExempt: (path, method) => isStewardAgentPath(path, method) || isExecutorPath(path, method) }));
  app.route("/", createExecutorRouter(steward.ports));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_HTTP_BODY_BYTES,
      onError: (context) => {
        log.warn("request.body_too_large", {
          method: context.req.method,
          path: new URL(context.req.url).pathname,
        });
        return context.json({ error: "Request body exceeds the 21 MiB limit." }, 413);
      },
    }),
  );

  mountHealthRoutes(app, steward);
  // The provider's browser redirect carries no API key: the one-time state from secrets.authorize identifies it (v2-30 §4).
  app.get(OAUTH_CALLBACK_PATH, async (c) => {
    const { ok, message } = await completeOAuth(steward.ports, c.req.query());
    const escaped = message.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chrona</title><p style="font:16px system-ui;margin:3em auto;max-width:30em">${escaped}</p>`, ok ? 200 : 400);
  });

  app.route("/api", api);
  // Paths no kernel route claimed go to the module declaring `listen` for them (v2-4).
  app.all("/api/:name/*", async (c) => {
    const socket = await steward.listener(`/api/${c.req.param("name")}`);
    return socket ? proxy(socket, c.req.raw) : c.json({ code: "NOT_FOUND" }, 404);
  });
  // Everything else is the web page, served by the module declaring `listen: "/"`; pages carry no user data.
  app.on(["GET", "HEAD"], "/*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    const socket = await steward.listener("/");
    return socket ? proxy(socket, c.req.raw) : next();
  });

  app.notFound((c) => {
    const messages = getApiMessages(getPreferredLocale(c.req.header("accept-language")));
    return c.json({ error: messages.notFound }, 404);
  });

  app.onError((error, c) => {
    const messages = getApiMessages(getPreferredLocale(c.req.header("accept-language")));

    // A malformed JSON request body surfaces as a SyntaxError thrown by
    // `c.req.json()`. That is a client mistake (400), not a server fault
    // (500) — mapping it here keeps a bad payload from masquerading as an
    // outage and from polluting error logs at the `error` level.
    if (error instanceof SyntaxError) {
      log.warn("malformed request body", { error: error.message });
      return c.json({ error: messages.malformedJson }, 400);
    }

    log.error("unhandled error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      {
        error: messages.internalServerError,
      },
      500,
    );
  });

  return app;
}
