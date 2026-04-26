import { readFile } from "node:fs/promises";
import * as path from "node:path";

import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/serve-static";

function getSpaDistPath() {
  return path.resolve(process.cwd(), process.env.CHROMA_WEB_DIST ?? "apps/web/dist");
}

async function tryRead(filePath: string) {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

export function createSpaStaticMiddleware(): MiddlewareHandler {
  const root = getSpaDistPath();

  return serveStatic({
    root,
    getContent: async (assetPath) => {
      const normalized = assetPath.replace(/^\/+/, "");
      const explicitFile = path.resolve(root, normalized);
      const direct = await tryRead(explicitFile);
      if (direct) {
        return direct;
      }

      const fallback = await tryRead(path.resolve(root, "index.html"));
      return fallback;
    },
  });
}

export async function hasSpaDist() {
  return Boolean(await tryRead(path.resolve(getSpaDistPath(), "index.html")));
}
