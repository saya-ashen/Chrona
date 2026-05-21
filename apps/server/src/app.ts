import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";

import { defaultLocale, getApiMessages, getPreferredLocale, hasLocale } from "@chrona/i18n";

import { createApiRouter } from "./routes/api";
import {
  createSpaAssetMiddleware,
  createSpaIndexMiddleware,
  hasSpaDist,
  isSpaAssetPath,
} from "./static/spa";
import { createLogger } from "@chrona/shared/logger";
import { apiKeyAuth } from "./middleware/auth";
import { readEnv, resolveAllowedOrigins } from "./config/env";

const log = createLogger("apps.server");

function getAllowedOrigins() {
  return resolveAllowedOrigins(readEnv());
}

function resolveOrigin(origin: string | undefined, allowed: string[]) {
  if (allowed.includes("*")) return "*";
  if (origin && allowed.includes(origin)) return origin;
  return null;
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

  app.use("/api/*", apiKeyAuth());

  app.use("*", async (c, next) => {
    const origin = resolveOrigin(c.req.header("origin"), allowedOrigins);
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
    }

    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    );

    await next();
  });

  app.options("*", (c) => c.body(null, 204));

  app.get("/health", (c) => c.json({ status: "ok", server: "chrona-hono" }));

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

      // Vite build 后的真实静态资源
      // 例如 /assets/index-xxx.js、/assets/index-xxx.css、/favicon.ico
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

      // 例如 /en、/en/settings、/zh/projects/123
      // 这些都交给 React Router，所以返回 index.html
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
    log.error("unhandled error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      {
        error: getApiMessages(getPreferredLocale(c.req.header("accept-language"))).internalServerError,
      },
      500,
    );
  });

  return app;
}
