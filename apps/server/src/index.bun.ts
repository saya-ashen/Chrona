import { bootstrapServerRuntime } from "./bootstrap";
import { createServerApp } from "./app";
import { resolve } from "node:path";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { recoverInterruptedSqliteRestore } from "@chrona/db/sqlite-backup";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { createLogger } from "@chrona/logging";
import { assertSafeBind, isUnsafePublicBindOverride, readEnv, resolveAllowedOrigins, resolvePort } from "./config/env";

const log = createLogger("apps.server");
const SSE_REQUEST_TIMEOUT_SECONDS = 120;

let isShuttingDown = false;

export async function startBunServer() {
  const env = readEnv();
  const host = env.HOST;
  const port = resolvePort(env);

  await assertSafeBind(env);
  const databaseLock = acquireSqliteRuntimeLock(env.DATABASE_URL);
  // Covers normal process exits that do not arrive through SIGINT/SIGTERM.
  process.once("exit", () => databaseLock.release());
  try {
    recoverInterruptedSqliteRestore(env.DATABASE_URL);
    ensureSqliteDatabase({
      databaseUrl: env.DATABASE_URL,
      migrationsDir: process.env.CHRONA_MIGRATIONS_DIR ?? resolve("prisma", "migrations"),
      log: (message) => log.info("database migration", { message }),
    });
  } catch (error) {
    databaseLock.release();
    throw error;
  }
  const runtimeLifecycle = bootstrapServerRuntime();
  let app: Awaited<ReturnType<typeof createServerApp>>;
  try {
    app = await createServerApp();
  } catch (error) {
    await runtimeLifecycle.stop().catch(() => undefined);
    databaseLock.release();
    throw error;
  }
  if (await isUnsafePublicBindOverride(env)) {
    log.warn("unsafe public bind enabled", {
      host,
      port,
      warning: "A non-loopback HOST without API_KEY exposes Chrona to your network.",
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
    log.warn("unsafe cors wildcard enabled", {
      warning: "ALLOWED_ORIGINS=* with CHRONA_UNSAFE_CORS=1 allows browser requests from any origin.",
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
      await runtimeLifecycle.stop();
    } catch (err) {
      log.error("runtime shutdown failed", { error: String(err) });
    }

    try {
      const { db } = await import("@chrona/db/db");
      await db.$disconnect();
    } catch (err) {
      log.error("db disconnect failed", { error: String(err) });
    } finally {
      databaseLock.release();
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
