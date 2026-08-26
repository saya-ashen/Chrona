import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";

// GET /api/runtime/providers — execution runtime catalog.
// Coverage audit gap: zero L1 coverage. The route returns the
// list of registered runtimes (Hermes, optionally Debug) with
// display labels. Pinned cases:
//   - hermes is always exposed
//   - debug is hidden unless CHRONA_ENABLE_DEBUG_PROVIDER or
//     NODE_ENV=development
//   - shape: { providers: [{ key, label }] }

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("GET /api/runtime/providers", () => {
  it("always exposes the hermes runtime with a human label", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ key: string; label: string }> };
    expect(Array.isArray(body.providers)).toBe(true);

    const hermes = body.providers.find((p) => p.key === "hermes");
    expect(hermes).toBeDefined();
    expect(hermes?.label).toBe("Hermes");
  });

  it("exposes Codex runtime with a human label", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ key: string; label: string }> };
    const codex = body.providers.find((p) => p.key === "codex");
    expect(codex).toBeDefined();
    expect(codex?.label).toBe("Codex");
  });

  it("lists OMP first as the stable provider with its safe terminal-only bindings", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{ key: string; label: string; tier: string; features: string[] }>;
    };
    const omp = body.providers.find((p) => p.key === "omp");
    expect(body.providers[0]?.key).toBe("omp");
    expect(omp).toMatchObject({
      label: "Oh My Pi",
      tier: "stable",
      features: expect.arrayContaining(["task.plan", "task.execution", "dashboard.brief", "goal.review"]),
    });
  });

  it("hides planning and Goal review from providers without safe Feature Runtime recovery", async () => {
    const res = await app().request("http://local/api/runtime/providers");
    const body = (await res.json()) as { providers: Array<{ key: string; features: string[] }> };
    for (const provider of body.providers.filter((entry) => entry.key === "claude_code" || entry.key === "codex")) {
      expect(provider.features).not.toContain("task.plan");
      expect(provider.features).not.toContain("goal.review");
    }
  });

  it("hides the debug provider when no env flag is set", async () => {
    const previous = process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
    delete process.env.CHRONA_ENABLE_DEBUG_PROVIDER;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

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
