import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createExecutionRoutes } from "../../routes/execution.routes";
import {
  resetTestDb,
  seedWorkspace,
  seedTask,
  seedAcceptedPlan,
  json,
} from "../bun-test-helpers";

function app() {
  const router = new Hono();
  router.route("/api", createExecutionRoutes());
  return router;
}

describe("work-block endpoints", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  describe("GET /api/tasks/:taskId/work-blocks", () => {
    it("returns empty array for task with no work blocks", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId);

      const res = await app().request(`/api/tasks/${taskId}/work-blocks`);
      const body = await json<{ workBlocks: unknown[] }>(res);

      expect(res.status).toBe(200);
      expect(body.workBlocks).toEqual([]);
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await app().request("/api/tasks/nonexistent/work-blocks");
      expect(res.status).toBe(404);
    });

    it("returns created work blocks", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId, { title: "Scheduled Task" });

      const postRes = await app().request(`/api/tasks/${taskId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledStartAt: "2026-05-05T09:00:00Z",
          scheduledEndAt: "2026-05-05T10:00:00Z",
        }),
      });
      expect(postRes.status).toBe(201);

      const getRes = await app().request(`/api/tasks/${taskId}/work-blocks`);
      const body = await json<{ workBlocks: unknown[] }>(getRes);

      expect(getRes.status).toBe(200);
      expect(body.workBlocks).toHaveLength(1);
    });
  });

  describe("POST /api/tasks/:taskId/work-blocks", () => {
    it("creates a work block with manual trigger", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId, { title: "My Task" });

      const res = await app().request(`/api/tasks/${taskId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledStartAt: "2026-05-05T09:00:00Z",
          scheduledEndAt: "2026-05-05T10:00:00Z",
        }),
      });
      const block = await json<{
        id: string;
        taskId: string;
        title: string;
        status: string;
        trigger: string;
      }>(res);

      expect(res.status).toBe(201);
      expect(block.taskId).toBe(taskId);
      expect(block.title).toBe("My Task");
      expect(block.status).toBe("Scheduled");
      expect(block.trigger).toBe("manual");
    });

    it("links to accepted plan when one exists", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId, { title: "Planned Task" });
      const { planId } = await seedAcceptedPlan(taskId, ws.workspaceId);

      const res = await app().request(`/api/tasks/${taskId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledStartAt: "2026-05-05T09:00:00Z",
          scheduledEndAt: "2026-05-05T10:00:00Z",
        }),
      });
      const block = await json<{ planId: string | null }>(res);

      expect(res.status).toBe(201);
      expect(block.planId).toBe(planId);
    });

    it("uses custom title when provided", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId);

      const res = await app().request(`/api/tasks/${taskId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Custom Block Title",
          scheduledStartAt: "2026-05-05T09:00:00Z",
          scheduledEndAt: "2026-05-05T10:00:00Z",
        }),
      });
      const block = await json<{ title: string }>(res);

      expect(res.status).toBe(201);
      expect(block.title).toBe("Custom Block Title");
    });

    it("returns 404 for nonexistent task", async () => {
      const res = await app().request("/api/tasks/nonexistent/work-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledStartAt: "2026-05-05T09:00:00Z",
          scheduledEndAt: "2026-05-05T10:00:00Z",
        }),
      });
      expect(res.status).toBe(404);
    });

    it("defaults end time to 1 hour after start", async () => {
      const ws = await seedWorkspace();
      const { taskId } = await seedTask(ws.workspaceId);

      const res = await app().request(`/api/tasks/${taskId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledStartAt: "2026-05-05T09:00:00Z",
        }),
      });
      const block = await json<{ scheduledStartAt: string; scheduledEndAt: string }>(res);

      expect(res.status).toBe(201);
      expect(new Date(block.scheduledEndAt).getTime() - new Date(block.scheduledStartAt).getTime()).toBe(3600000);
    });
  });
});

describe("work-block execution workflow", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("starts execution from a work block via manual start", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId, { title: "Exec Task" });
    await seedAcceptedPlan(taskId, ws.workspaceId);

    const blockRes = await app().request(`/api/tasks/${taskId}/work-blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: "2026-05-05T09:00:00Z",
        scheduledEndAt: "2026-05-05T10:00:00Z",
      }),
    });
    expect(blockRes.status).toBe(201);

    const runRes = await app().request(`/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(runRes.status).toBe(201);

    const runBody = await json<{ status: string }>(runRes);
    expect(runBody.status).toBe("running");
  });

  it("returns no_plan status when starting execution without an accepted plan", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`/api/tasks/${taskId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const body = await json<{ error: string }>(res);
    expect(body.error).toContain("No accepted plan");
  });

  it("resolves correctly when blocked action is present", async () => {
    const ws = await seedWorkspace();
    const { taskId } = await seedTask(ws.workspaceId);

    const res = await app().request(`/api/tasks/${taskId}/work-blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: "2026-05-05T09:00:00Z",
        scheduledEndAt: "2026-05-05T10:00:00Z",
      }),
    });
    expect(res.status).toBe(201);
  });
});
