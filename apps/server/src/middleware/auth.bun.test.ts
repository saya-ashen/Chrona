import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { apiKeyAuth } from "./auth";
import { resetEnvCacheForTests } from "../config/env";

function resetEnvCache() {
  delete process.env.API_KEY;
  delete process.env.HOST;
  delete process.env.CHRONA_UNSAFE_PUBLIC_BIND;
  resetEnvCacheForTests();
}

function app() {
  const server = new Hono();
  server.use("/api/*", apiKeyAuth());
  server.get("/api/protected", (c) => c.json({ ok: true }));
  return server;
}

describe("apiKeyAuth", () => {
  afterEach(() => {
    resetEnvCache();
  });

  const credentials: { name: string; headers: Record<string, string>; authorized: boolean }[] = [
    { name: "missing", headers: {}, authorized: false },
    { name: "wrong", headers: { Authorization: "Bearer wrong" }, authorized: false },
    { name: "correct", headers: { Authorization: "Bearer test-key" }, authorized: true },
  ];

  for (const path of [
    "/health", "/api/health",
    "/healthy", "/health-foo", "/health/", "/health/status",
    "/api/healthy", "/api/health-foo", "/api/health/", "/api/health/status",
  ]) {
    for (const credential of credentials) {
      it(`${path} with ${credential.name} auth only bypasses auth for an exact health endpoint`, async () => {
        resetEnvCache();
        process.env.API_KEY = "test-key";
        resetEnvCacheForTests();

        const server = new Hono();
        // Include /health in the middleware so its exemption is exercised too.
        server.use("*", apiKeyAuth());
        server.get(path, (c) => c.json({ path: c.req.path }));

        const response = await server.request(`http://local${path}`, { headers: credential.headers });
        const isHealth = path === "/health" || path === "/api/health";
        expect(response.status).toBe(isHealth || credential.authorized ? 200 : 401);
        if (response.status === 200) expect(await response.json()).toEqual({ path });
      });
    }
  }

  for (const credential of credentials) {
    it(`preserves explicit method-scoped exemptions with ${credential.name} auth`, async () => {
      resetEnvCache();
      process.env.API_KEY = "test-key";
      resetEnvCacheForTests();

      const server = new Hono();
      server.use("*", apiKeyAuth({
        isExempt: (path, method) => path === "/oauth/callback" && method === "GET",
      }));
      server.all("*", (c) => c.json({ ok: true }));

      const exempt = await server.request("http://local/oauth/callback", { headers: credential.headers });
      expect(exempt.status).toBe(200);

      for (const [path, method] of [["/oauth/callback/extra", "GET"], ["/oauth/callback", "POST"]]) {
        const response = await server.request(`http://local${path}`, { method, headers: credential.headers });
        expect(response.status).toBe(credential.authorized ? 200 : 401);
      }
    });
  }

  it("requires a bearer token when API_KEY is set", async () => {
    resetEnvCache();
    process.env.API_KEY = "test-key";
    resetEnvCacheForTests();

    const missing = await app().request("http://local/api/protected", {
      headers: { "accept-language": "zh-CN,zh;q=0.9" },
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const invalid = await app().request("http://local/api/protected", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(invalid.status).toBe(401);

    const valid = await app().request("http://local/api/protected", {
      headers: { Authorization: "Bearer test-key" },
    });
    expect(valid.status).toBe(200);
  });
});
