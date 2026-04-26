import { Hono } from "hono";

import {
  defaultLocale,
  getPreferredLocale,
  hasLocale,
} from "../../../src/i18n/config";

import { createApiRouter } from "./routes/api";
import { createSpaStaticMiddleware, hasSpaDist } from "./static/spa";

function wantsHtml(acceptHeader: string | undefined) {
  return typeof acceptHeader === "string" && acceptHeader.includes("text/html");
}

export async function createServerApp() {
  const app = new Hono();
  const api = createApiRouter();
  const spaAvailable = await hasSpaDist();

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    await next();
  });

  app.options("*", (c) => c.body(null, 204));

  app.get("/health", (c) => c.json({ status: "ok", server: "chrona-hono" }));
  app.route("/api", api);

  if (spaAvailable) {
    const serveSpa = createSpaStaticMiddleware();

    app.get("/", (c) => {
      const preferredLocale = getPreferredLocale(c.req.header("accept-language"));
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

      const firstSegment = pathname.split("/").filter(Boolean)[0];
      if (!firstSegment || !hasLocale(firstSegment)) {
        const locale = defaultLocale;
        return c.redirect(`/${locale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`, 302);
      }

      return serveSpa(c, next);
    });
  }

  app.notFound((c) => {
    if (spaAvailable && wantsHtml(c.req.header("accept"))) {
      const locale = getPreferredLocale(c.req.header("accept-language"));
      return c.redirect(`/${locale}`, 302);
    }

    return c.json({ error: "Not found" }, 404);
  });

  app.onError((error, c) => {
    console.error("[apps/server] unhandled error", error);
    return c.json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  });

  return app;
}
