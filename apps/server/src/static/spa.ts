import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import * as path from "node:path";

import type { MiddlewareHandler } from "hono";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getSpaDistPath() {
  return path.resolve(process.cwd(), process.env.CHROMA_WEB_DIST ?? "apps/web/dist");
}

export function createSpaStaticMiddleware(): MiddlewareHandler {
  const root = getSpaDistPath();

  return async (c) => {
    const urlPath = new URL(c.req.url).pathname;
    const safeName = urlPath.replace(/\.\./g, "").replace(/\/\//g, "/");
    const filePath = path.resolve(root, safeName.replace(/^\/+/, "") || "index.html");

    let body: Buffer;
    let servedPath: string;
    try {
      await stat(filePath);
      body = await readFile(filePath);
      servedPath = filePath;
    } catch {
      servedPath = path.resolve(root, "index.html");
      try {
        body = await readFile(servedPath);
      } catch {
        return c.notFound();
      }
    }

    const ext = path.extname(servedPath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  };
}

export async function hasSpaDist() {
  try {
    return Boolean(await stat(path.resolve(getSpaDistPath(), "index.html")));
  } catch {
    return false;
  }
}
