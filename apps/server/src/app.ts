import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createChronaEngine } from "@chrona/engine";

import { defaultLocale, getApiMessages, getPreferredLocale, hasLocale } from "@chrona/i18n";

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
const MAX_HTTP_BODY_BYTES = 1_048_576;


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

/**
 * Creates the Hono server app with all middleware and routes mounted.
 *
 * Returns a fresh app instance (factory pattern). The returned type is used
 * by the frontend hono/client RPC — import via:
 *   import type { AppType } from "@chrona/server/app";
 *   import { hc } from "hono/client";
 *   const client = hc<AppType>("/api");
 */
export async function createServerApp() {
  const app = new Hono();
  const engine = createChronaEngine({ logger: log });
  const api = createApiRouter(engine);
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
  app.use("/api/*", apiKeyAuth());
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_HTTP_BODY_BYTES,
      onError: (context) => {
        log.warn("request.body_too_large", {
          method: context.req.method,
          path: new URL(context.req.url).pathname,
        });
        return context.json({ error: "Request body exceeds the 1 MiB limit." }, 413);
      },
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok", server: "chrona-hono" }));
  app.get("/ready", async (c) => {
    const readiness = await engine.runtime.getReadiness();
    return c.json(readiness, readiness.status === "ready" ? 200 : 503);
  });

  app.route("/api", api);

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
        const locale = defaultLocale;

        return c.redirect(
          `/${locale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`,
          302,
        );
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
