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

  it("requires a bearer token when API_KEY is set", async () => {
    resetEnvCache();
    process.env.API_KEY = "test-key";
    resetEnvCacheForTests();

    const missing = await app().request("http://local/api/protected");
    expect(missing.status).toBe(401);

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
