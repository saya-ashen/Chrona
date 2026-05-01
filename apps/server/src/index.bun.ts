import { bootstrapServerRuntime } from "./bootstrap";
import { createServerApp } from "./app";
import { createLogger } from "@chrona/db/logger";
import { readEnv, resolvePort } from "./config/env";

const env = readEnv();
const log = createLogger("apps.server");
const host = env.HOST;
const port = resolvePort(env);

let isShuttingDown = false;

export async function startBunServer() {
  bootstrapServerRuntime();

  const app = await createServerApp();
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: (request, server) => {
      if (isShuttingDown) {
        return new Response(JSON.stringify({ error: "Server is shutting down" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
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
