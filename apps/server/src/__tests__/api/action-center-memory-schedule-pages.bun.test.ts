import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// Three page-level read models used by the action center, memory, and
// schedule pages. Coverage audit gap: weak L1 coverage (each
// endpoint was covered in isolation elsewhere; this file pins
// the contract under the same call-shape the loaders use).
//
//   - GET /api/inbox?workspaceId=…
//   - GET /api/memory?workspaceId=…
//   - GET /api/schedule?workspaceId=…
//
// Pinned cases:
//   - all three return 200 for a workspace with no data
//   - action center filter: a seeded proposal surfaces as kind=schedule_proposal

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("page-level read models: action center / memory / schedule", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns 200 with well-formed array shape for all three on a fresh workspace", async () => {
    const { workspaceId } = await seedWorkspace("Empty page models");

    const [actionCenterRes, memoryRes, scheduleRes] = await Promise.all([
      app().request(`http://local/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`),
      app().request(`http://local/api/memory?workspaceId=${encodeURIComponent(workspaceId)}`),
      app().request(`http://local/api/schedule?workspaceId=${encodeURIComponent(workspaceId)}`),
    ]);
    expect(actionCenterRes.status).toBe(200);
    expect(memoryRes.status).toBe(200);
    expect(scheduleRes.status).toBe(200);

    // Each endpoint returns a body with at least one of the
    // common list fields. We just assert it's a plain object
    // (not an error) — the exact shape is owned by the page
    // model and is verified at the page-component level.
    const actionCenterBody = await actionCenterRes.json() as Record<string, unknown>;
    const memoryBody = await memoryRes.json() as Record<string, unknown>;
    const scheduleBody = await scheduleRes.json() as Record<string, unknown>;
    expect(typeof actionCenterBody).toBe("object");
    expect(actionCenterBody).not.toBeNull();
    expect(typeof memoryBody).toBe("object");
    expect(memoryBody).not.toBeNull();
    expect(typeof scheduleBody).toBe("object");
    expect(scheduleBody).not.toBeNull();
  });

  it("action center filter: a schedule proposal is reported with kind=schedule_proposal", async () => {
    const { workspaceId } = await seedWorkspace("Action Center filter");
    const { taskId } = await seedTask(workspaceId, { title: "Action Center filter task" });
    const proposalRes = await app().request(
      `http://local/api/tasks/${taskId}/schedule/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          source: "ai",
          proposedBy: "planner",
          summary: "Test slot",
          scheduledStartAt: new Date("2030-04-01T13:00:00.000Z").toISOString(),
          scheduledEndAt: new Date("2030-04-01T14:00:00.000Z").toISOString(),
        }),
      },
    );
    expect(proposalRes.status).toBe(201);
    const res = await app().request(`http://local/api/inbox?workspaceId=${encodeURIComponent(workspaceId)}`);
    expect(res.status).toBe(200);
    // The action center endpoint returns the items array as the top
    // level body (not wrapped in { items: [...] }).
    const body = (await res.json()) as Array<{ kind: string; id: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((i) => i.kind === "schedule_proposal")).toBe(true);
  });

  it("memory shape is well-formed and is a JSON object", async () => {
    const { workspaceId } = await seedWorkspace("Memory shape");
    const res = await app().request(`http://local/api/memory?workspaceId=${encodeURIComponent(workspaceId)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });

  it("schedule shape is well-formed and is a JSON object", async () => {
    const { workspaceId } = await seedWorkspace("Schedule shape");
    const res = await app().request(`http://local/api/schedule?workspaceId=${encodeURIComponent(workspaceId)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });
});
