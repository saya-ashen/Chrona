import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// GET /api/workspaces/:workspaceId/overview — shape contract.
// Coverage audit gap: zero L1/L2/L3 coverage. The route fans
// out a workspace overview with 6 buckets (running,
// waitingForApproval, blockedOrFailed, scheduleRisks,
// upcomingDeadlines, recentlyUpdated) derived from
// TaskProjection rows.
//
// Pinned cases:
//   - empty workspace returns 6 empty arrays
//   - tasks with projections land in the right bucket
//   - bucket counts are independent (one task does not appear
//     in two buckets)

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedProjection(workspaceId: string, taskId: string, fields: {
  persistedStatus?: string;
  displayState?: string | null;
  scheduleStatus?: string | null;
  dueAt?: Date | null;
  lastActivityAt?: Date | null;
  latestRunStatus?: string | null;
  actionRequired?: string | null;
}) {
  return await db.taskProjection.upsert({
    where: { taskId },
    create: {
      taskId,
      workspaceId,
      persistedStatus: fields.persistedStatus ?? "Ready",
      displayState: fields.displayState ?? null,
      scheduleStatus: fields.scheduleStatus ?? null,
      dueAt: fields.dueAt ?? null,
      lastActivityAt: fields.lastActivityAt ?? new Date(),
      latestRunStatus: fields.latestRunStatus ?? null,
      actionRequired: fields.actionRequired ?? null,
    },
    update: {
      workspaceId,
      persistedStatus: fields.persistedStatus ?? "Ready",
      displayState: fields.displayState ?? null,
      scheduleStatus: fields.scheduleStatus ?? null,
      dueAt: fields.dueAt ?? null,
      lastActivityAt: fields.lastActivityAt ?? new Date(),
      latestRunStatus: fields.latestRunStatus ?? null,
      actionRequired: fields.actionRequired ?? null,
    },
  });
}

describe("GET /api/workspaces/:workspaceId/overview", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns 6 empty buckets for a workspace with no tasks", async () => {
    const { workspaceId } = await seedWorkspace("Empty overview");

    const res = await app().request(`http://local/api/workspaces/${workspaceId}/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      running: unknown[];
      waitingForApproval: unknown[];
      blockedOrFailed: unknown[];
      scheduleRisks: unknown[];
      upcomingDeadlines: unknown[];
      recentlyUpdated: unknown[];
    };
    expect(body.running).toEqual([]);
    expect(body.waitingForApproval).toEqual([]);
    expect(body.blockedOrFailed).toEqual([]);
    expect(body.scheduleRisks).toEqual([]);
    expect(body.upcomingDeadlines).toEqual([]);
    expect(body.recentlyUpdated).toEqual([]);
  });

  it("classifies a Running task into the running bucket only", async () => {
    const { workspaceId } = await seedWorkspace("Running bucket");
    const { taskId } = await seedTask(workspaceId, { title: "Currently running" });
    await seedProjection(workspaceId, taskId, {
      persistedStatus: "Running",
      latestRunStatus: "executing",
      lastActivityAt: new Date("2030-01-02T00:00:00.000Z"),
    });

    const res = await app().request(`http://local/api/workspaces/${workspaceId}/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      running: Array<{ taskId: string; title: string }>;
      waitingForApproval: unknown[];
      blockedOrFailed: unknown[];
    };
    expect(body.running).toHaveLength(1);
    expect(body.running[0]).toMatchObject({ taskId, title: "Currently running" });
    expect(body.waitingForApproval).toEqual([]);
    expect(body.blockedOrFailed).toEqual([]);
  });

  it("surfaces Blocked task in blockedOrFailed and a due date in upcomingDeadlines", async () => {
    const { workspaceId } = await seedWorkspace("Blocked + deadline");
    const { taskId } = await seedTask(workspaceId, { title: "Stuck" });
    await seedProjection(workspaceId, taskId, {
      persistedStatus: "Blocked",
      latestRunStatus: "blocked",
      dueAt: new Date("2030-03-01T12:00:00.000Z"),
      lastActivityAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const res = await app().request(`http://local/api/workspaces/${workspaceId}/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      blockedOrFailed: Array<{ taskId: string; persistedStatus: string }>;
      upcomingDeadlines: Array<{ taskId: string }>;
    };
    expect(body.blockedOrFailed).toHaveLength(1);
    expect(body.blockedOrFailed[0]).toMatchObject({ taskId, persistedStatus: "Blocked" });
    expect(body.upcomingDeadlines.map((d) => d.taskId)).toContain(taskId);
  });

  it("AtRisk schedule lands in scheduleRisks but not in blockedOrFailed", async () => {
    const { workspaceId } = await seedWorkspace("Schedule at risk");
    const { taskId } = await seedTask(workspaceId, { title: "Behind schedule" });
    await seedProjection(workspaceId, taskId, {
      persistedStatus: "Ready",
      scheduleStatus: "AtRisk",
      actionRequired: "deadline approaching",
      latestRunStatus: "none",
      lastActivityAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const res = await app().request(`http://local/api/workspaces/${workspaceId}/overview`);
    const body = (await res.json()) as {
      scheduleRisks: Array<{ taskId: string; scheduleStatus: string }>;
      blockedOrFailed: unknown[];
    };
    expect(body.scheduleRisks).toHaveLength(1);
    expect(body.scheduleRisks[0]).toMatchObject({ taskId, scheduleStatus: "AtRisk" });
    // Not double-counted in blockedOrFailed.
    expect(body.blockedOrFailed).toEqual([]);
  });
});
