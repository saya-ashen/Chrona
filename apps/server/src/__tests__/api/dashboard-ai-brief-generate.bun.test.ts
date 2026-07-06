import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import { createDashboardRoutes } from "../../routes/pages/dashboard.routes";

type DashboardBriefState = Awaited<ReturnType<ChronaEngine["pages"]["generateDashboardBrief"]>>;

function app(pages: Partial<ChronaEngine["pages"]>) {
  const server = new Hono();
  server.route("/api", createDashboardRoutes({ pages } as ChronaEngine));
  return server;
}

function postGenerate(pages: Partial<ChronaEngine["pages"]>, workspaceId = "workspace-1", body: unknown = {}) {
  return app(pages).request(`http://local/api/pages/dashboard/ai-brief/generate?workspaceId=${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pages/dashboard/ai-brief/generate", () => {
  it("passes workspace and force through to the engine", async () => {
    const calls: unknown[] = [];
    const responseBody: DashboardBriefState = {
      status: "ready",
      spec: { root: "root", elements: { root: { type: "Text", props: { text: "Brief" } } } },
      generatedAt: "2030-01-01T00:00:00.000Z",
      providerClientId: "client-1",
      canGenerate: true,
      errorMessage: null,
      inputFingerprint: "fingerprint-1",
    };

    const res = await postGenerate({
      generateDashboardBrief: async (input) => {
        calls.push(input);
        return responseBody;
      },
    }, "workspace-1", { force: true });

    expect(res.status).toBe(200);
    expect(calls).toEqual([{ workspaceId: "workspace-1", force: true }]);
    expect(await res.json()).toEqual(responseBody);
  });

  it("defaults force to undefined", async () => {
    const calls: unknown[] = [];
    const res = await postGenerate({
      generateDashboardBrief: async (input) => {
        calls.push(input);
        return { status: "dirty", spec: null, generatedAt: null, providerClientId: null, canGenerate: true, errorMessage: null, inputFingerprint: "fp" } satisfies DashboardBriefState;
      },
    });

    expect(res.status).toBe(200);
    expect(calls).toEqual([{ workspaceId: "workspace-1", force: undefined }]);
  });

  it("rejects invalid force values before calling the engine", async () => {
    const calls: unknown[] = [];
    const res = await postGenerate({
      generateDashboardBrief: async (input) => {
        calls.push(input);
        throw new Error("must not call");
      },
    }, "workspace-1", { force: "yes" });

    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("maps engine failures to a 500 response", async () => {
    const res = await postGenerate({
      generateDashboardBrief: async () => {
        throw new Error("provider failed");
      },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Failed to generate dashboard AI brief" });
  });
});
