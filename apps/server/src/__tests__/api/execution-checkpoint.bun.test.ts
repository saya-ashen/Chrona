import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions
//
// Coverage audit gap: weak L1 coverage. Pinned cases:
//   - 400 on a missing/empty body (param validation only —
//     no plan, no checkpoint needed to assert the schema gate)

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("POST /api/tasks/:taskId/execution/checkpoint/:checkpointId/actions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns 400 when the body is missing the required action field", async () => {
    const { workspaceId } = await seedWorkspace("Checkpoint schema gate");
    const { taskId } = await seedTask(workspaceId, { title: "Checkpoint task" });

    const res = await app().request(
      `http://local/api/tasks/${taskId}/execution/checkpoint/nonexistent/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the action field is not a known checkpoint kind", async () => {
    const { workspaceId } = await seedWorkspace("Checkpoint bad action");
    const { taskId } = await seedTask(workspaceId, { title: "Checkpoint bad action" });

    const res = await app().request(
      `http://local/api/tasks/${taskId}/execution/checkpoint/nonexistent/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "definitely_not_a_real_action" }),
      },
    );
    expect(res.status).toBe(400);
  });
});
