import * as path from "node:path";

import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { readEnv } from "../config/env";

function getSpaDistPath() {
  const envDist = readEnv().CHRONA_WEB_DIST;
  if (envDist) return path.resolve(envDist);
  return path.resolve(process.cwd(), "apps/web/dist");
}

export async function hasSpaDist() {
  const indexPath = path.resolve(getSpaDistPath(), "index.html");
  return await Bun.file(indexPath).exists();
}

export function createSpaAssetMiddleware(): MiddlewareHandler {
  return serveStatic({
    root: getSpaDistPath(),
    precompressed: true,
  });
}

export function createSpaIndexMiddleware(): MiddlewareHandler {
  return serveStatic({
    root: getSpaDistPath(),
    path: "index.html",
    precompressed: true,
  });
}

export function isSpaAssetPath(pathname: string) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/favicon.") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/apple-touch-icon.png"
  );
}
