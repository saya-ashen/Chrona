import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { parse } from "hono/utils/cookie";
import { z } from "zod";
import { BrowserAuthError, createBrowserAuthStore, SESSION_MAX_AGE_SECONDS } from "./browser-auth-store";
import { hasLoopbackPeer, isLoopbackPeer, type ServerBindings } from "./request-peer";

const COOKIE_NAME = "chrona_session";
const MAX_BODY_BYTES = 4096;
const passwordSchema = z.string().min(10).max(256);
const passwordInput = z.object({ password: passwordSchema }).strict();
const changeInput = passwordInput.extend({ currentPassword: passwordSchema }).strict();
const operationSchemas = { setup: passwordInput, login: passwordInput, password: changeInput };
type AuthContext = Context<{ Bindings: ServerBindings }>;

/** Cookie authority uses the direct request URL, never CORS configuration or forwarding headers. */
export function isBrowserAuthSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin"), expected = new URL(request.url).origin;
  if (origin !== null && origin !== expected) return false;
  const referer = request.headers.get("referer");
  if (!referer) return true; // Non-browser clients may omit browser provenance headers.
  try { return new URL(referer).origin === expected; } catch { return false; }
}
function setupAuthorized(c: AuthContext, apiKey: string | undefined) {
  if (!apiKey) {
    if (["forwarded", "x-forwarded-for", "x-real-ip"].some(header => c.req.raw.headers.has(header))) return false;
    const hostname = new URL(c.req.url).hostname.replace(/^\[|\]$/g, "");
    return (hostname === "localhost" || isLoopbackPeer(hostname)) && hasLoopbackPeer(c.env, c.req.raw);
  }
  const provided = Buffer.from(c.req.header("authorization") ?? ""), expected = Buffer.from(`Bearer ${apiKey}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
function sessionToken(c: AuthContext) { return getCookie(c, COOKIE_NAME); }
function cookie(c: AuthContext, token: string, clear = false) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, sameSite: "Strict", path: "/", secure: new URL(c.req.url).protocol === "https:",
    maxAge: clear ? 0 : SESSION_MAX_AGE_SECONDS,
    ...(clear ? { expires: new Date(0) } : {}),
  });
}
/** Count the stream too: Content-Length alone is not a trustworthy input bound. */
async function input(c: AuthContext) {
  if (c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return "too_large"; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return null; }
}
/** Fixed-size counters bound hashing globally and per endpoint without attacker-controlled peer maps. */
function createAttemptLimiter(now: () => number) {
  let start = now(), total = 0;
  const attempts = new Map<string, number>();
  return (path: string) => {
    if (now() - start >= 5 * 60_000) { start = now(); total = 0; attempts.clear(); }
    const count = attempts.get(path) ?? 0;
    if (total >= 30 || count >= 10) return false;
    total++; attempts.set(path, count + 1);
    return true;
  };
}

/**
 * Mount router at /api/auth BEFORE apiKeyAuth. Pass this object as apiKeyAuth({ browserAuth }).
 * State lives in <dataDir>/secrets/browser-auth/state.json, included in the private secrets backup.
 * apiKey is used only for first setup; now is an optional clock for isolated expiry/rate-limit tests.
 * Mutations return {ok:true}; errors return {error:string} with 400/401/403/409/413/429.
 */
export async function createBrowserAuth(options: { dataDir: string; apiKey?: string; now?: () => number }) {
  const now = options.now ?? Date.now, store = await createBrowserAuthStore(options.dataDir, now);
  const router = new Hono<{ Bindings: ServerBindings }>(), allowAttempt = createAttemptLimiter(now);
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isBrowserAuthSameOrigin(c.req.raw)) return c.json({ error: "Same-origin request required" }, 403);
    await next();
  });
  router.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: c => c.json({ error: "Authentication request is too large" }, 413) }));
  router.get("/status", c => c.json({
    passwordSet: store.passwordSet(), authenticated: store.authenticated(sessionToken(c)),
    canSetup: !store.passwordSet() && setupAuthorized(c, options.apiKey),
  }));
  router.post("/logout", async c => {
    try { await store.logout(sessionToken(c)); }
    catch (error) { if (error instanceof BrowserAuthError) return c.json({ error: error.message }, error.status); throw error; }
    cookie(c, "", true);
    return c.json({ ok: true });
  });
  for (const operation of ["setup", "login", "password"] as const) router.post(`/${operation}`, async c => {
    if (operation === "setup" && !setupAuthorized(c, options.apiKey)) return c.json({ error: "Owner setup authorization required" }, 403);
    if (!allowAttempt(operation)) { c.header("Retry-After", "300"); return c.json({ error: "Too many authentication attempts; try again later" }, 429); }
    if (operation === "password" && !store.authenticated(sessionToken(c))) return c.json({ error: "Password session required" }, 401);
    const value = await input(c);
    if (value === "too_large") return c.json({ error: "Authentication request is too large" }, 413);
    const parsed = operationSchemas[operation].safeParse(value);
    if (!parsed.success) return c.json({ error: "Expected a JSON password between 10 and 256 characters" }, 400);
    try {
      let token: string;
      if (operation === "setup") token = await store.setup(parsed.data.password);
      else if (operation === "login") token = await store.login(parsed.data.password);
      else token = await store.change(sessionToken(c), (parsed.data as z.infer<typeof changeInput>).currentPassword, parsed.data.password);
      cookie(c, token);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof BrowserAuthError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  return {
    router,
    passwordSet: store.passwordSet,
    authenticate: (request: Request) => store.authenticated(parse(request.headers.get("cookie") ?? "", COOKIE_NAME)[COOKIE_NAME]),
  };
}
