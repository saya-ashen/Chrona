import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createBrowserAuth } from "./browser-auth";
import { createBrowserAuthStore, SESSION_MAX_AGE_SECONDS } from "./browser-auth-store";
import { resetEnvCacheForTests } from "./config/env";
import { apiKeyAuth } from "./middleware/auth";
import type { ServerBindings } from "./request-peer";

const password = "test password 12345", replacement = "replacement password 67890";
const origin = "http://localhost";
let root: string, previousKey: string | undefined;
beforeEach(async () => {
  previousKey = process.env.API_KEY;
  delete process.env.API_KEY;
  resetEnvCacheForTests();
  root = await mkdtemp(join(tmpdir(), "chrona-browser-auth-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (previousKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = previousKey;
  resetEnvCacheForTests();
});
function cookieOf(response: Response) { return response.headers.get("set-cookie")!.split(";", 1)[0]!; }
async function fixture(apiKey?: string, publicUrl?: string) {
  let time = 1_800_000_000_000;
  if (apiKey) process.env.API_KEY = apiKey;
  resetEnvCacheForTests();
  const make = async () => {
    const auth = await createBrowserAuth({ dataDir: root, apiKey, publicUrl, now: () => time });
    const app = new Hono<{ Bindings: ServerBindings }>();
    app.route("/api/auth", auth.router);
    app.use("/api/*", apiKeyAuth({ browserAuth: auth, isExempt: (path, method) => path === "/api/scoped" && method === "POST" }));
    app.all("/api/protected", c => c.json({ ok: true }));
    app.post("/api/scoped", c => c.json({ scoped: true }));
    return app;
  };
  let app = await make();
  return {
    advance: (ms: number) => { time += ms; },
    restart: async () => { app = await make(); },
    request: (path: string, init?: RequestInit, peer?: string, requestOrigin = origin) => app.request(`${requestOrigin}${path}`, init, peer ? { server: { requestIP: () => ({ address: peer }) } } : undefined),
    post: (operation: string, value: unknown, headers: Record<string, string> = {}, peer = "127.0.0.1") => app.request(`${origin}/api/auth/${operation}`, {
      method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(value),
    }, { server: { requestIP: () => ({ address: peer }) } }),
  };
}

describe("browser password setup", () => {
  test("requires the configured API key even from a loopback socket", async () => {
    const f = await fixture("existing-key");
    expect(await (await f.request("/api/auth/status", undefined, "127.0.0.1")).json()).toEqual({ passwordSet: false, authenticated: false, canSetup: false });
    for (const authorization of [undefined, "Bearer wrong"]) {
      expect((await f.post("setup", { password }, authorization ? { authorization } : {})).status).toBe(403);
    }
    const headers = { authorization: "Bearer existing-key" };
    expect(await (await f.request("/api/auth/status", { headers })).json()).toEqual({ passwordSet: false, authenticated: false, canSetup: true });
    const response = await f.post("setup", { password }, headers, "203.0.113.10");
    expect(response.status).toBe(200);
    expect((await f.request("/api/protected", { headers: { cookie: cookieOf(response) } })).status).toBe(200);
    expect((await f.post("setup", { password: replacement }, headers)).status).toBe(409);
  });

  test("without API_KEY requires a loopback socket and a local URL without proxy headers", async () => {
    const f = await fixture();
    for (const peer of [undefined, "203.0.113.2"]) {
      const headers = { "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1", "x-real-ip": "::1" };
      expect(await (await f.request("/api/auth/status", { headers }, peer)).json()).toEqual({ passwordSet: false, authenticated: false, canSetup: false });
      expect((await f.request("/api/auth/setup", { method: "POST", headers: { ...headers, "content-type": "application/json", origin }, body: JSON.stringify({ password }) }, peer)).status).toBe(403);
    }
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect((await (await f.request("/api/auth/status", undefined, peer)).json()).canSetup).toBe(true);
    }
    for (const requestOrigin of ["http://localhost", "http://127.0.0.1", "http://[::1]"]) {
      expect((await (await f.request("/api/auth/status", undefined, "127.0.0.1", requestOrigin)).json()).canSetup).toBe(true);
    }
    expect((await f.post("setup", { password })).status).toBe(200);
    expect((await (await f.request("/api/auth/status", undefined, "127.0.0.1")).json()).canSetup).toBe(false);
  });

  test("denies proxy headers and nonlocal hosts even with a loopback socket", async () => {
    const f = await fixture();
    for (const requestOrigin of ["http://chrona.test", "http://localhost.evil.test", origin]) {
      const candidates: Record<string, string>[] = requestOrigin === origin
        ? [{ forwarded: "for=127.0.0.1" }, { "x-forwarded-for": "127.0.0.1" }, { "x-real-ip": "::1" }, { forwarded: "" }]
        : [{}];
      for (const headers of candidates) {
        const response = await f.request("/api/auth/status", { headers }, "127.0.0.1", requestOrigin);
        expect((await response.json()).canSetup).toBe(false);
        const setup = await f.request("/api/auth/setup", {
          method: "POST", headers: { ...headers, origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify({ password }),
        }, "127.0.0.1", requestOrigin);
        expect(setup.status).toBe(403);
      }
    }
    expect((await f.post("setup", { password })).status).toBe(200);
  });

  test("serializes concurrent first setup so exactly one password wins", async () => {
    const f = await fixture();
    const responses = await Promise.all([f.post("setup", { password }), f.post("setup", { password: replacement })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winningPassword = responses[0]!.status === 200 ? password : replacement;
    const losingPassword = winningPassword === password ? replacement : password;
    expect((await f.post("login", { password: losingPassword })).status).toBe(401);
    expect((await f.post("login", { password: winningPassword })).status).toBe(200);
  });

  test("validates strict JSON and password length before hashing", async () => {
    const f = await fixture();
    for (const value of [{}, { password: 1234567890 }, { password: "x".repeat(9) }, { password: "x".repeat(257) }, { password, extra: true }, [], null]) {
      expect((await f.post("setup", value)).status).toBe(400);
    }
    expect((await f.post("setup", { password: "x".repeat(10) })).status).toBe(200);
    expect((await f.post("password", { currentPassword: "x".repeat(10), password: "y".repeat(256) }, { cookie: cookieOf(await f.post("login", { password: "x".repeat(10) })) })).status).toBe(200);
  });
});

describe("persistent browser sessions", () => {
  test("persists only hashes with private modes and survives reopening", async () => {
    const f = await fixture();
    const response = await f.post("setup", { password });
    const cookie = cookieOf(response), header = response.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/"); expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(header).not.toContain("Secure");
    const file = join(root, "secrets/browser-auth/state.json"), contents = await readFile(file, "utf8");
    expect(contents).not.toContain(password);
    expect(contents).not.toContain(cookie.split("=")[1]!);
    expect(JSON.parse(contents).passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.parse(contents).sessions[0].hash).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "secrets"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "secrets/browser-auth"))).mode & 0o777).toBe(0o700);
    }
    await f.restart();
    expect(await (await f.request("/api/auth/status", { headers: { cookie } })).json()).toEqual({ passwordSet: true, authenticated: true, canSetup: false });
    expect((await f.post("login", { password })).status).toBe(200);
    expect((await f.post("setup", { password: replacement })).status).toBe(409);
  });

  test("wrong password fails, expiry survives restart, logout persists revocation", async () => {
    const f = await fixture();
    const first = cookieOf(await f.post("setup", { password }));
    expect((await f.post("login", { password: "wrong password" })).status).toBe(401);
    const second = cookieOf(await f.post("login", { password }));
    const logout = await f.post("logout", {}, { cookie: first });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(logout.headers.get("set-cookie")).toContain("HttpOnly");
    await f.restart();
    expect((await f.request("/api/protected", { headers: { cookie: first } })).status).toBe(401);
    expect((await f.request("/api/protected", { headers: { cookie: second } })).status).toBe(200);
    f.advance(SESSION_MAX_AGE_SECONDS * 1000);
    await f.restart();
    expect((await f.request("/api/protected", { headers: { cookie: second } })).status).toBe(401);
    expect((await (await f.request("/api/auth/status", { headers: { cookie: second } })).json()).authenticated).toBe(false);
    expect((await f.post("logout", {})).status).toBe(200);
  });

  test("password change requires session plus current password and revokes every old session", async () => {
    const f = await fixture("owner-key");
    const first = cookieOf(await f.post("setup", { password }, { authorization: "Bearer owner-key" }));
    const second = cookieOf(await f.post("login", { password }));
    const value = { currentPassword: password, password: replacement };
    expect((await f.post("password", value, { authorization: "Bearer owner-key" })).status).toBe(401);
    expect((await f.post("password", { ...value, currentPassword: "wrong password" }, { cookie: first })).status).toBe(401);
    expect((await f.request("/api/protected", { headers: { cookie: first } })).status).toBe(200);
    const changed = await f.post("password", value, { cookie: first });
    expect(changed.status).toBe(200);
    const current = cookieOf(changed);
    expect(current).not.toBe(first);
    await f.restart();
    for (const cookie of [first, second]) expect((await f.request("/api/protected", { headers: { cookie } })).status).toBe(401);
    expect((await f.request("/api/protected", { headers: { cookie: current } })).status).toBe(200);
    expect((await f.post("login", { password })).status).toBe(401);
    expect((await f.post("login", { password: replacement })).status).toBe(200);
  });

  test("queued changes recheck revoked sessions", async () => {
    const f = await fixture();
    const cookie = cookieOf(await f.post("setup", { password }));
    const responses = await Promise.all([1, 2].map(() => f.post("password", { currentPassword: password, password: replacement }, { cookie })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
  });

  test("bounds concurrent password verification and recovers after failures", async () => {
    const store = await createBrowserAuthStore(root, Date.now);
    const original = await store.setup(password);
    const results = await Promise.allSettled(Array.from({ length: 24 }, () => store.login("incorrect password")));
    const statuses = results.map(result => result.status === "rejected" ? result.reason.status : 200);
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
    expect(statuses.every(status => status === 401 || status === 429)).toBe(true);
    expect(store.authenticated(original)).toBe(true);
    expect(store.authenticated(await store.login(password))).toBe(true);
  });

  test("session retention is bounded and evicts oldest sessions", async () => {
    const store = await createBrowserAuthStore(root, Date.now);
    const first = await store.setup(password);
    let last = first;
    for (let i = 0; i < 32; i++) last = await store.login(password);
    expect(store.authenticated(first)).toBe(false);
    expect(store.authenticated(last)).toBe(true);
    expect(JSON.parse(await readFile(join(root, "secrets/browser-auth/state.json"), "utf8")).sessions).toHaveLength(32);
  });

  test("corrupt persisted state fails closed instead of reopening setup", async () => {
    const f = await fixture();
    await f.post("setup", { password });
    await writeFile(join(root, "secrets/browser-auth/state.json"), JSON.stringify({ version: 1, passwordHash: "plaintext", sessions: [] }));
    await expect(f.restart()).rejects.toThrow("Invalid browser authentication state");
  });
});

describe("browser auth storage boundaries", () => {
  test.skipIf(process.platform === "win32")("rejects symlink data, secrets, and auth directories without changing the target", async () => {
    const target = join(root, "target");
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755);
    const alias = join(root, "alias");
    await symlink(target, alias, "dir");
    await expect(createBrowserAuthStore(alias, Date.now)).rejects.toThrow("Unsafe browser authentication data directory");
    for (const relative of ["secrets", "secrets/browser-auth"]) {
      const data = join(root, relative.replaceAll("/", "-"));
      await mkdir(join(data, "secrets"), { recursive: true });
      const path = join(data, relative);
      await rm(path, { recursive: true, force: true });
      await symlink(target, path, "dir");
      await expect(createBrowserAuthStore(data, Date.now)).rejects.toThrow("Unsafe browser authentication directory");
      expect((await stat(target)).mode & 0o777).toBe(0o755);
    }
  });

  test("rejects nonregular and oversized state before parsing", async () => {
    await createBrowserAuthStore(root, Date.now);
    const file = join(root, "secrets/browser-auth/state.json");
    await mkdir(file);
    await expect(createBrowserAuthStore(root, Date.now)).rejects.toThrow("Unsafe browser authentication state file");
    await rm(file, { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, passwordHash: null, sessions: [] }));
    await truncate(file, 16 * 1024 + 1);
    await expect(createBrowserAuthStore(root, Date.now)).rejects.toThrow("Unsafe browser authentication state file");
    if (process.platform !== "win32") {
      await rm(file);
      execFileSync("mkfifo", [file]);
      await expect(createBrowserAuthStore(root, Date.now)).rejects.toThrow("Unsafe browser authentication state file");
    }
  });

  test.skipIf(process.platform === "win32")("rejects symlink and hard-linked state at startup and before saving", async () => {
    const store = await createBrowserAuthStore(root, Date.now);
    const session = await store.setup(password);
    const file = join(root, "secrets/browser-auth/state.json"), target = join(root, "target.json");
    await writeFile(target, "untouched", { mode: 0o644 });
    await chmod(target, 0o644);
    await rm(file);
    await symlink(target, file);
    await expect(createBrowserAuthStore(root, Date.now)).rejects.toThrow("Unsafe browser authentication state file");
    await expect(store.login(password)).rejects.toThrow("Unsafe browser authentication state file");
    expect(store.authenticated(session)).toBe(true);
    expect(await readFile(target, "utf8")).toBe("untouched");
    expect((await stat(target)).mode & 0o777).toBe(0o644);
    await rm(file);
    await link(target, file);
    await expect(createBrowserAuthStore(root, Date.now)).rejects.toThrow("Unsafe browser authentication state file");
    await expect(store.login(password)).rejects.toThrow("Unsafe browser authentication state file");
  });

  test.skipIf(process.platform === "win32")("rechecks auth directory safety before mutations", async () => {
    const store = await createBrowserAuthStore(root, Date.now);
    await store.setup(password);
    const target = join(root, "target"), directory = join(root, "secrets/browser-auth");
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755);
    await rm(directory, { recursive: true });
    await symlink(target, directory, "dir");
    await expect(store.login(password)).rejects.toThrow("Unsafe browser authentication directory");
    expect((await stat(target)).mode & 0o777).toBe(0o755);
  });
});

describe("browser auth request boundaries", () => {
  test("uses the configured HTTPS origin behind a proxy without weakening owner setup or cookie checks", async () => {
    const publicUrl = "https://chrona.example";
    const f = await fixture("existing-key", publicUrl);
    const headers = { origin: publicUrl, referer: `${publicUrl}/`, "sec-fetch-site": "same-origin" };
    const status = await f.request("/api/auth/status", { headers });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ passwordSet: false, authenticated: false, canSetup: false });
    expect((await f.post("setup", { password }, headers)).status).toBe(403);
    const setup = await f.post("setup", { password }, { ...headers, authorization: "Bearer existing-key" });
    expect(setup.status).toBe(200);
    expect(setup.headers.get("set-cookie")).toContain("Secure");
    const cookie = cookieOf(setup);
    expect((await f.request("/api/protected", { headers: { ...headers, cookie } })).status).toBe(200);
    for (const spoof of [
      { origin: "https://evil.example", referer: "https://evil.example/", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { referer: "https://evil.example/" },
      { "sec-fetch-site": "cross-site" },
      { origin },
    ] as Record<string, string>[]) {
      expect((await f.request("/api/protected", { headers: { ...headers, ...spoof, cookie } })).status).toBe(403);
      expect((await f.post("logout", {}, { ...headers, ...spoof, cookie })).status).toBe(403);
    }
    const logout = await f.post("logout", {}, { ...headers, cookie });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Secure");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  test("blocks cross-origin auth and cookie requests including same-site and fetch metadata", async () => {
    const f = await fixture("existing-key");
    for (const headers of [
      { origin: "https://allowed-cors.example" },
      { origin: "null" },
      { origin, "sec-fetch-site": "cross-site" },
      { origin, "sec-fetch-site": "same-site" },
    ] as Record<string, string>[]) {
      expect((await f.post("setup", { password }, { ...headers, authorization: "Bearer existing-key" })).status).toBe(403);
      expect((await f.request("/api/auth/status", { headers })).status).toBe(403);
    }
    const cookie = cookieOf(await f.post("setup", { password }, { authorization: "Bearer existing-key" }));
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { referer: "https://evil.example/page" }] as Record<string, string>[]) {
      expect((await f.request("/api/protected", { method: "POST", headers: { ...headers, cookie } })).status).toBe(403);
      expect((await f.post("login", { password }, headers)).status).toBe(403);
      expect((await f.post("logout", {}, headers)).status).toBe(403);
      expect((await f.post("password", { currentPassword: password, password: replacement }, { ...headers, cookie })).status).toBe(403);
    }
    // Separate bearer authority retains its existing automation behavior.
    expect((await f.request("/api/protected", { headers: { authorization: "Bearer existing-key", origin: "https://allowed-cors.example" } })).status).toBe(200);
  });

  test("sets Secure only for the direct HTTPS URL, ignoring forwarding headers", async () => {
    const auth = await createBrowserAuth({ dataDir: root, apiKey: "key" });
    const app = new Hono<{ Bindings: ServerBindings }>().route("/api/auth", auth.router);
    const setup = await app.request("https://chrona.test/api/auth/setup", { method: "POST", headers: { authorization: "Bearer key", origin: "https://chrona.test", "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect(setup.status).toBe(200); expect(setup.headers.get("set-cookie")).toContain("Secure");
    const login = await app.request(`${origin}/api/auth/login`, { method: "POST", headers: { origin, "x-forwarded-proto": "https", "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect(login.status).toBe(200); expect(login.headers.get("set-cookie")).not.toContain("Secure");
    expect((await app.request("http://chrona.test/api/auth/login", { method: "POST", headers: { origin: "https://chrona.test", "x-forwarded-proto": "https", "content-type": "application/json" }, body: JSON.stringify({ password }) })).status).toBe(403);
  });

  test("caps JSON bytes even with a false Content-Length and rejects malformed/simple forms", async () => {
    const f = await fixture();
    for (const headers of [{}, { "content-length": "1" }] as Record<string, string>[]) {
      expect((await f.post("setup", { password, padding: "x".repeat(5000) }, headers)).status).toBe(413);
    }
    for (const [body, type] of [["{", "application/json"], [JSON.stringify({ password }), "text/plain"], ["password=abcd", "application/x-www-form-urlencoded"]]) {
      expect((await f.request("/api/auth/setup", { method: "POST", headers: { origin, "content-type": type! }, body }, "127.0.0.1")).status).toBe(400);
    }
  });

  test("bounds bad attempts globally and per endpoint, then recovers after the window", async () => {
    const f = await fixture("key");
    for (let i = 0; i < 10; i++) expect((await f.post("setup", { password: "short" }, { authorization: "Bearer key" })).status).toBe(400);
    const limited = await f.post("setup", { password }, { authorization: "Bearer key" });
    expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("300");
    f.advance(5 * 60_000);
    expect((await f.post("setup", { password }, { authorization: "Bearer key" })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await f.post("login", { password: "wrong password" })).status).toBe(401);
    expect((await f.post("login", { password })).status).toBe(429);
    f.advance(5 * 60_000);
    expect((await f.post("login", { password })).status).toBe(200);
  });

  test("unauthorized setup attempts do not consume the login limit", async () => {
    const f = await fixture("key");
    expect((await f.post("setup", { password }, { authorization: "Bearer key" })).status).toBe(200);
    for (let i = 0; i < 40; i++) expect((await f.post("setup", { password })).status).toBe(403);
    expect((await f.post("login", { password })).status).toBe(200);
  });

  test("protects anonymous API access only after password configuration while preserving exemptions", async () => {
    const f = await fixture();
    expect((await f.request("/api/protected")).status).toBe(200);
    const cookie = cookieOf(await f.post("setup", { password }));
    expect((await f.request("/api/protected")).status).toBe(401);
    expect((await f.request("/api/protected", { headers: { cookie } })).status).toBe(200);
    expect((await f.request("/api/scoped", { method: "POST" })).status).toBe(200);
    expect((await f.request("/api/scoped")).status).toBe(401);
  });
});

test("server app integration keeps browser auth, CORS, and owner-key boundaries without a database", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "browser-auth-app.fixture.ts"), root], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "test" },
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
});
