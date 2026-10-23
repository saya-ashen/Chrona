// @ts-expect-error Chrona supplies the SDK package at run time.
import { chrona } from "chrona";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Static files only: the page holds no data; the browser calls /api/steward with the user's key.
const files: Record<string, string> = { "/app.js": "text/javascript; charset=utf-8", "/style.css": "text/css; charset=utf-8" };
const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
chrona.serve(async (request: Request) => {
  const path = new URL(request.url).pathname;
  const name = files[path] ? path.slice(1) : "index.html";
  const body = await readFile(join(chrona.paths.module, name));
  return new Response(request.method === "HEAD" ? null : body, { headers: { ...headers, "content-type": files[path] ?? "text/html; charset=utf-8" } });
});
