import type { StewardRuntime } from "./steward-runtime";
import { createLogger } from "./logger";
import { createServerApp } from "./app";
import { isUnsafePublicBindOverride, readEnv, resolveAllowedOrigins, resolvePort } from "./config/env";

const log = createLogger("apps.server");

export async function startBunHttp(steward: StewardRuntime, env: ReturnType<typeof readEnv>) {
  const host = env.HOST, port = resolvePort(env);
  const app = await createServerApp({ steward });
  let stopping = false;
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
      if (stopping) {
        return new Response(JSON.stringify({ error: "Server is shutting down" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      // Routes that wait longer than idleTimeout widen it per request (v2-13).
      return app.fetch(request, { server });
    },
  });

  log.info("listening", { host, port });
  return { server, stop() { stopping = true; server.stop(true); } };
}
