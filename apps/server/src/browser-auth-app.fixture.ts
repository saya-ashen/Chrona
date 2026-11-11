// Runs in a child process so the DB module mock cannot leak into another Bun test file.
import { mock, expect } from "bun:test";
import * as client from "../../../packages/db/src/generated/prisma/client";
import type { StewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
mock.module("@chrona/db", () => ({ ...client, db: new Proxy({}, { get() { throw new Error("Unexpected database access"); } }) }));
const { createServerApp } = await import("./app");
const origin = "http://localhost", password = "test password 12345";
const rootBase = process.argv[2]!;
let root: string;
function cookieOf(response: Response) { return response.headers.get("set-cookie")!.split(";", 1)[0]!; }
{
  function runtime() {
    // Only construction/listener ports are used. Any database access would fail this fixture.
    return { ports: { dataDir: root }, service: { tools: {} }, initialize: async () => {}, listener: async () => null } as unknown as StewardRuntime;
  }
  root = join(rootBase, "with-key"); await mkdir(root);
  await (async () => {
    process.env.API_KEY = "existing-key";
    resetEnvCacheForTests();
    const app = await createServerApp({ steward: runtime() });
    expect((await app.request(`${origin}/api/auth/status`)).status).toBe(200);
    expect((await app.request(`${origin}/api/private`)).status).toBe(401);
    const setup = await app.request(`${origin}/api/auth/setup`, { method: "POST", headers: { origin, authorization: "Bearer existing-key", "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect(setup.status).toBe(200);
    const cookie = cookieOf(setup);
    expect((await app.request(`${origin}/api/private`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`${origin}/api/private`, { headers: { authorization: "Bearer existing-key" } })).status).toBe(404);
    for (const operation of ["pairing-create", "mapping-set", "device-revoke", "status", "authority", "cleanup"]) {
      const response = await app.request(`${origin}/api/remote-execution/owner/v1/${operation}`, { method: "POST", headers: { origin, cookie }, body: "{}" });
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("REMOTE_EXECUTION_FORBIDDEN");
    }
    // Method-scoped exemptions still reach their own narrow guards after password configuration.
    expect((await app.request(`${origin}/api/remote-execution/device/v1/poll`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await app.request(`${origin}/api/remote-execution/device/v1/poll`)).status).toBe(401);
    expect((await app.request(`${origin}/api/steward-agent/catalog`)).status).toBe(403);
    expect((await app.request(`${origin}/api/steward-agent/catalog/extra`)).status).toBe(401);
  })();

  root = join(rootBase, "no-key"); await mkdir(root); delete process.env.API_KEY; resetEnvCacheForTests();
  await (async () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://cors.example";
    resetEnvCacheForTests();
    try {
      const app = await createServerApp({ steward: runtime() });
      expect((await app.request(`${origin}/api/private`)).status).toBe(404);
      const headers = { origin, "content-type": "application/json" };
      const setup = await app.request(`${origin}/api/auth/setup`, { method: "POST", headers, body: JSON.stringify({ password }) }, { server: { requestIP: () => ({ address: "::1" }) } });
      expect(setup.status).toBe(200);
      const cookie = cookieOf(setup);
      expect((await app.request(`${origin}/api/private`)).status).toBe(401);
      expect((await app.request(`${origin}/api/private`, { headers: { cookie } })).status).toBe(404);
      const crossOrigin = { origin: "https://cors.example", cookie };
      expect((await app.request(`${origin}/api/private`, { method: "OPTIONS", headers: crossOrigin })).status).toBe(204);
      expect((await app.request(`${origin}/api/private`, { headers: crossOrigin })).status).toBe(403);
      expect((await app.request(`${origin}/api/auth/status`, { headers: crossOrigin })).status).toBe(403);
      expect((await app.request(`${origin}/api/auth/logout`, { method: "POST", headers: crossOrigin })).status).toBe(403);
      expect((await app.request(`${origin}/api/remote-execution/owner/v1/status`, { method: "POST", headers: { cookie }, body: "{}" })).status).toBe(503);
      const restarted = await createServerApp({ steward: runtime() });
      expect((await restarted.request(`${origin}/api/private`)).status).toBe(401);
      expect((await restarted.request(`${origin}/api/private`, { headers: { cookie } })).status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previous;
      resetEnvCacheForTests();
    }
  })();
}
