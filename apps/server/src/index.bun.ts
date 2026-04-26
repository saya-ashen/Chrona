import { bootstrapServerRuntime } from "./bootstrap";
import { createServerApp } from "./app";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3101", 10);

export async function startBunServer() {
  bootstrapServerRuntime();

  const app = await createServerApp();
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: app.fetch,
  });

  console.log(`[apps/server] listening on http://${host}:${port}`);
  return server;
}

if (process.argv[1]?.endsWith("apps/server/src/index.bun.ts")) {
  void startBunServer();
}
