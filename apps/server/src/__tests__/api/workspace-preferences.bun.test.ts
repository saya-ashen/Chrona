import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createWorkspacesRoutes } from "../../routes/workspaces.routes";
import { json, resetTestDb, seedWorkspace } from "../bun-test-helpers";

function app() {
  const app = new Hono();
  app.route("/api", createWorkspacesRoutes(createChronaEngine()));
  return app;
}

describe("workspace start-with-chrona preference", () => {
  beforeEach(async () => {
    await resetTestDb();
    const workspace = await seedWorkspace("Workspace Preferences");
    await db.workspace.update({ where: { id: workspace.workspaceId }, data: { id: "ws-1" } });
  });

  it("returns null before onboarding completion is stored", async () => {
    const res = await app().request("http://local/api/workspaces/ws-1/preferences/start-with-chrona");

    expect(res.status).toBe(200);
    expect(await json<{ completedAt: string | null }>(res)).toEqual({ completedAt: null });
  });

  it("persists onboarding completion per workspace", async () => {
    const completedAt = "2026-07-07T00:00:00.000Z";
    const patch = await app().request("http://local/api/workspaces/ws-1/preferences/start-with-chrona", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedAt }),
    });

    expect(patch.status).toBe(200);
    expect(await json<{ completedAt: string | null }>(patch)).toEqual({ completedAt });

    const persisted = await app().request("http://local/api/workspaces/ws-1/preferences/start-with-chrona");
    expect(await json<{ completedAt: string | null }>(persisted)).toEqual({ completedAt });

    const rows = await db.workspaceUserPreference.findMany({ where: { workspaceId: "ws-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("startWithChrona");
  });
});
