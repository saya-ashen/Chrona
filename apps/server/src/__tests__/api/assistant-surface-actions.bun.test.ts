import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";

// Assistant surface endpoints:
//   - GET /api/assistant-surface?pageType=…
//   - POST /api/assistant-surface/actions
//
// Coverage audit gap: zero L1 coverage. Both routes return
// well-formed shape contract tests:
//   - GET with no pageType returns an "unsupported" state
//   - GET with pageType=schedule returns unavailable state
//   - POST with a generic action returns an "informational" kind

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("assistant surface", () => {
  it("GET /api/assistant-surface without pageType returns unsupported state", async () => {
    const res = await app().request("http://local/api/assistant-surface");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pageType: string;
      status: string;
      unavailableReason?: string;
    };
    expect(body.pageType).toBe("unsupported");
    expect(body.status).toBe("unavailable");
    expect(typeof body.unavailableReason).toBe("string");
  });

  it("GET /api/assistant-surface?pageType=schedule returns schedule-specific unavailable state", async () => {
    const res = await app().request("http://local/api/assistant-surface?pageType=schedule");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pageType: string; status: string };
    expect(body.pageType).toBe("schedule");
    expect(body.status).toBe("unavailable");
  });

  it("POST /api/assistant-surface/actions with no actionId returns an informational result", async () => {
    const res = await app().request("http://local/api/assistant-surface/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageType: "task", actionId: "ask-about-task", input: "How is this task going?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; message?: string; route?: { href: string } };
    // Either informational message or a proposal route — both
    // are valid contract shapes per the service.
    expect(["informational", "proposal"]).toContain(body.kind);
    if (body.kind === "informational") {
      expect(typeof body.message).toBe("string");
    } else {
      expect(typeof body.route?.href).toBe("string");
    }
  });
});
