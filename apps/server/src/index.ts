import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

import { createServerApp } from "./app";
import { bootstrapServerRuntime } from "./bootstrap";
import { createLogger } from "@chrona/db/logger";

const log = createLogger("apps.server");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3101", 10);

let isShuttingDown = false;

async function toWebRequest(request: IncomingMessage) {
  const protocol = (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const authority = request.headers.host ?? `${host}:${port}`;
  const url = `${protocol}://${authority}${request.url ?? "/"}`;
  const method = request.method ?? "GET";

  if (method === "GET" || method === "HEAD") {
    return new Request(url, {
      method,
      headers: request.headers as HeadersInit,
    });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Request(url, {
    method,
    headers: request.headers as HeadersInit,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

export async function startNodeServer() {
  bootstrapServerRuntime();

  const app = await createServerApp();
  const server = createServer((request, response) => {
    if (isShuttingDown) {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "Server is shutting down" }));
      return;
    }

    toWebRequest(request)
      .then((webRequest) => app.fetch(webRequest))
      .then(async (appResponse) => {
        response.statusCode = appResponse.status;
        appResponse.headers.forEach((value, key) => {
          response.setHeader(key, value);
        });

        if (!appResponse.body) {
          response.end();
          return;
        }

        const buffer = Buffer.from(await appResponse.arrayBuffer());
        response.end(buffer);
      })
      .catch((error) => {
        log.error("request failed", { error: String(error) });
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "Internal server error" }));
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  log.info("listening", { host, port });

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info("shutdown started", { signal });

    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));

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

if (process.argv[1]?.endsWith("apps/server/src/index.ts")) {
  void startNodeServer();
}
