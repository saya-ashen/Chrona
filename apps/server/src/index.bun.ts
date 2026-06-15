import { bootstrapServerRuntime } from "./bootstrap";
import { createServerApp } from "./app";
import { resolve } from "node:path";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createLogger } from "@chrona/logging";
import { assertSafeBind, isUnsafePublicBindOverride, readEnv, resolveAllowedOrigins, resolvePort } from "./config/env";

const log = createLogger("apps.server");
const SSE_REQUEST_TIMEOUT_SECONDS = 120;

let isShuttingDown = false;

export async function startBunServer() {
  const env = readEnv();
  const host = env.HOST;
  const port = resolvePort(env);

  assertSafeBind(env);
  ensureSqliteDatabase({
    databaseUrl: env.DATABASE_URL,
    migrationsDir: process.env.CHRONA_MIGRATIONS_DIR ?? resolve("prisma", "migrations"),
  });
  bootstrapServerRuntime();

  const app = await createServerApp();
  if (isUnsafePublicBindOverride(env)) {
    log.warn("unsafe public bind enabled", {
      host,
      port,
      warning: "HOST=0.0.0.0 without API_KEY exposes Chrona to your network.",
    });
  }
  if (!env.API_KEY) {
    log.warn("api authentication disabled", {
      host,
      port,
      warning: "Set API_KEY before exposing Chrona beyond localhost.",
    });
  }
  if (resolveAllowedOrigins(env).includes("*")) {
    log.warn("cors wildcard enabled", {
      warning: "ALLOWED_ORIGINS=* allows browser requests from any origin.",
    });
  }
  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 120,
    fetch: (request, server) => {
      if (isShuttingDown) {
        return new Response(JSON.stringify({ error: "Server is shutting down" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      if (new URL(request.url).pathname.endsWith("/events")) {
        server.timeout(request, SSE_REQUEST_TIMEOUT_SECONDS);
      }
      return app.fetch(request);
    },
  });

  log.info("listening", { host, port });

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info("shutdown started", { signal });

    server.stop(true);

    try {
      const { db } = await import("@chrona/db/db");
      await db.$disconnect();
    } catch (err) {
      log.error("db disconnect failed", { error: String(err) });
    }

    log.info("shutdown complete", { signal });
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (process.argv[1]?.endsWith("apps/server/src/index.bun.ts")) {
  void startBunServer();
}
