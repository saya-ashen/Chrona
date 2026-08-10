import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createServerApp } from "./app";
import { resetEnvCacheForTests } from "./config/env";

function resetEnv() {
  delete process.env.API_KEY;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.CHRONA_UNSAFE_CORS;
  delete process.env.CHRONA_CONFIG_FILE;
  delete process.env.CHRONA_WEB_DIST;
  resetEnvCacheForTests();
}

describe("server API origin policy", () => {
  beforeEach(() => {
    resetEnv();
    process.env.ALLOWED_ORIGINS = "https://trusted.example";
    resetEnvCacheForTests();
  });

  afterEach(resetEnv);

  it("rejects untrusted preflight and mutation requests before they reach API routes", async () => {
    const app = await createServerApp();
    const headers = {
      Origin: "https://attacker.example",
      "Access-Control-Request-Method": "POST",
    };

    const preflight = await app.request("http://local/api/ai/clients", {
      method: "OPTIONS",
      headers,
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

    const mutation = await app.request("http://local/api/ai/clients", {
      method: "POST",
      headers: { Origin: headers.Origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "must-not-create", type: "hermes" }),
    });
    expect(mutation.status).toBe(403);
    expect(mutation.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows configured-origin preflight and does not treat an API mutation as cross-origin", async () => {
    const app = await createServerApp();

    const preflight = await app.request("http://local/api/ai/clients", {
      method: "OPTIONS",
      headers: {
        Origin: "https://trusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://trusted.example");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("vary")).toBe("Origin");

    const sameOriginMutation = await app.request("http://local/api/ai/clients", {
      method: "POST",
      headers: { Origin: "http://local", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(sameOriginMutation.status).toBe(400);
    expect(sameOriginMutation.headers.get("access-control-allow-origin")).toBeNull();
  });
});
