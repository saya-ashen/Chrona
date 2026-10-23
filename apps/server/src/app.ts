import { Hono } from "hono";
import { createStewardRuntime, type StewardRuntime } from "./steward-runtime";
import { bodyLimit } from "hono/body-limit";

import { getApiMessages, getPreferredLocale, hasLocale } from "@chrona/i18n";

import { createApiRouter } from "./routes/api";
import {
  createSpaAssetMiddleware,
  createSpaIndexMiddleware,
  hasSpaDist,
  isSpaAssetPath,
} from "./static/spa";
import { createLogger } from "@chrona/logging";
import { apiKeyAuth } from "./middleware/auth";
import { isTrustedRequestOrigin, readEnv, resolveAllowedOrigins } from "./config/env";

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

function wantsHtml(acceptHeader: string | undefined) {
  return typeof acceptHeader === "string" && acceptHeader.includes("text/html");
}

function mountHealthRoutes(app: Hono, steward: StewardRuntime) {
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
  const app = new Hono();
  const steward = options.steward ?? createStewardRuntime((await import("@chrona/db")).db);
  const api = createApiRouter({ steward });
  const spaAvailable = await hasSpaDist();
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
  app.use("/api/*", apiKeyAuth({ isExempt: isStewardAgentPath }));
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

  app.route("/api", api);
  // Paths no kernel route claimed go to the module declaring `listen` for them (v2-4).
  app.all("/api/:name/*", async (c) => {
    const socket = await steward.listener(`/api/${c.req.param("name")}`);
    if (!socket) return c.json({ code: "NOT_FOUND" }, 404);
    const url = new URL(c.req.url), headers = new Headers(c.req.raw.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    try {
      const response = await fetch(`http://module${url.pathname}${url.search}`, { unix: socket, method: c.req.method, headers, body: c.req.raw.body, redirect: "manual" });
      const out = new Headers(response.headers);
      out.delete("set-cookie");
      return new Response(response.body, { status: response.status, headers: out });
    } catch {
      return c.json({ code: "MODULE_UNAVAILABLE" }, 503);
    }
  });
  if (spaAvailable) {
    const serveSpaAsset = createSpaAssetMiddleware();
    const serveSpaIndex = createSpaIndexMiddleware();

    app.get("/", (c) => {
      const preferredLocale = getPreferredLocale(
        c.req.header("accept-language"),
      );
      return c.redirect(`/${preferredLocale}`, 302);
    });

    app.get("/*", async (c, next) => {
      const pathname = new URL(c.req.url).pathname;

      if (pathname.startsWith("/api/")) {
        return next();
      }

      if (pathname === "/") {
        return next();
      }

      // Real static assets emitted by the Vite build.
      // For example: /assets/index-xxx.js, /assets/index-xxx.css, /favicon.ico.
      if (isSpaAssetPath(pathname)) {
        return serveSpaAsset(c, next);
      }

      const firstSegment = pathname.split("/").filter(Boolean)[0];

      if (!firstSegment || !hasLocale(firstSegment)) {
        // Links Chrona sends out (QQ, notifications) carry no locale: keep the query (e.g. ?path=) and the reader's language.
        const locale = getPreferredLocale(c.req.header("accept-language"));
        const query = new URL(c.req.url).search;
        return c.redirect(`/${locale}${pathname.startsWith("/") ? pathname : `/${pathname}`}${query}`, 302);
      }

      // For example: /en, /en/settings, /zh/projects/123.
      // React Router owns these paths, so return index.html.
      return serveSpaIndex(c, next);
    });
  }

  app.notFound((c) => {
    if (spaAvailable && wantsHtml(c.req.header("accept"))) {
      const locale = getPreferredLocale(c.req.header("accept-language"));
      return c.redirect(`/${locale}`, 302);
    }

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
