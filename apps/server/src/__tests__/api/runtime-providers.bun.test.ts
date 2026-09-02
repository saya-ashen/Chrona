import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";

// GET /api/runtime/providers — execution runtime catalog.
// Coverage audit gap: zero L1 coverage. The route returns the
// list of released runtimes (optionally Debug) with display labels.
// Pinned cases:
//   - Hermes remains implemented but is hidden until certified
//   - debug is hidden unless CHRONA_ENABLE_DEBUG_PROVIDER=true
//   - shape: { providers: [{ key, label }] }

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("GET /api/runtime/providers", () => {
  it("hides Hermes until its runtime is release-certified", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ key: string; label: string }> };
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.some((provider) => provider.key === "hermes")).toBe(false);
  });

  it("exposes Codex runtime with a human label", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ key: string; label: string }> };
    const codex = body.providers.find((p) => p.key === "codex");
    expect(codex).toBeDefined();
    expect(codex?.label).toBe("Codex");
  });

  it("lists Codex first and gives every released provider stable full-feature support", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{
        key: string;
        label: string;
        tier: string;
        recommended: boolean;
        features: string[];
      }>;
    };
    expect(body.providers[0]).toMatchObject({
      key: "codex",
      label: "Codex",
      tier: "stable",
      recommended: true,
    });
    for (const provider of body.providers.filter((entry) => entry.key !== "debug")) {
      expect(provider.tier).toBe("stable");
      expect(provider.features).toEqual(expect.arrayContaining([
        "task.plan",
        "task.execution",
        "dashboard.brief",
        "goal.review",
      ]));
    }
    expect(body.providers.filter((provider) => provider.recommended)).toHaveLength(1);
  });

  it("hides the debug provider when no env flag is set", async () => {
    const previous = process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
    delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      const res = await app().request("http://local/api/runtime/providers");
      const body = (await res.json()) as { providers: Array<{ key: string }> };
      expect(body.providers.some((p) => p.key === "debug")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
      else process.env.CHRONA_ENABLE_DEBUG_PROVIDER = previous;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("exposes the debug provider when CHRONA_ENABLE_DEBUG_PROVIDER=true", async () => {
    const previous = process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
    process.env.CHRONA_ENABLE_DEBUG_PROVIDER = "true";

    try {
      const res = await app().request("http://local/api/runtime/providers");
      const body = (await res.json()) as { providers: Array<{ key: string; label: string }> };
      const debug = body.providers.find((p) => p.key === "debug");
      expect(debug).toBeDefined();
      expect(debug?.label).toBe("Debug Provider");
    } finally {
      if (previous === undefined) delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
      else process.env.CHRONA_ENABLE_DEBUG_PROVIDER = previous;
    }
  });
});
