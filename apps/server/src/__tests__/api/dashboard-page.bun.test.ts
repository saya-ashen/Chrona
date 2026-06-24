import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// GET /api/dashboard — landing "task news homepage" projection.
// Composes the workspace projections into editorial sections: a focus
// headline, a needs-attention queue (with reasons + next steps), an
// auto-completed feed with outputs, an in-progress list, and a readable
// recent-events stream. Pinned cases:
//   - empty workspace returns empty sections and a zero all-time total
//   - attention buckets surface with derived kind + reason + nextStep
//   - focus task picks the highest-impact non-terminal task
//   - auto-completed feed lists finished tasks newest-first with outputs
//   - recent events surface readable, task-scoped feed entries only

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

type DashboardBody = {
  focusTask: { taskId: string; title: string; nextStep: string; reason: string | null } | null;
  needsAttention: Array<{
    taskId: string;
    kind: string;
    reason: string | null;
    nextStep: string;
    latestOutput: { id: string; title: string } | null;
  }>;
  inProgress: Array<{ taskId: string; stage: string | null }>;
  autoCompleted: Array<{ taskId: string; title: string; category: string; output: { title: string } | null }>;
  totalAutoCompleted: number;
  recentEvents: Array<{ id: string; category: string; taskTitle: string }>;
};

async function fetchDashboard(workspaceId: string): Promise<DashboardBody> {
  const res = await app().request(`http://local/api/dashboard?workspaceId=${workspaceId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardBody;
}

async function seedProjection(
  workspaceId: string,
  taskId: string,
  fields: {
    persistedStatus?: string;
    displayState?: string | null;
    scheduleStatus?: string | null;
    approvalPendingCount?: number;
    actionRequired?: string | null;
    blockDetail?: string | null;
    currentNodeTitle?: string | null;
    dueAt?: Date | null;
    lastActivityAt?: Date | null;
  },
) {
  const data = {
    workspaceId,
    persistedStatus: fields.persistedStatus ?? "Ready",
    displayState: fields.displayState ?? null,
    scheduleStatus: fields.scheduleStatus ?? null,
    approvalPendingCount: fields.approvalPendingCount ?? 0,
    actionRequired: fields.actionRequired ?? null,
    blockDetail: fields.blockDetail ?? null,
    currentNodeTitle: fields.currentNodeTitle ?? null,
    dueAt: fields.dueAt ?? null,
    lastActivityAt: fields.lastActivityAt ?? new Date(),
  };
  return await db.taskProjection.upsert({
    where: { taskId },
    create: { taskId, ...data },
    update: data,
  });
}

async function seedPlanOutput(workspaceId: string, taskId: string, summary = "Plan output") {
  const planId = `plan-${crypto.randomUUID()}`;
  await db.taskPlan.create({
    data: {
      workspaceId,
      taskId,
      planId,
      revision: 1,
      status: "Accepted",
      compiledPlan: {},
    },
  });
  return await db.taskPlanRun.create({
    data: {
      workspaceId,
      taskId,
      planId,
      planRun: {
        planRun: { id: planId },
        mutableGraph: {
          planOutput: {
            spec: { root: "root", elements: { root: { type: "Text", props: { text: summary } } } },
            revision: 1,
            updatedAt: "2030-01-01T00:00:00.000Z",
            updatedByNodeId: null,
            history: [{ id: "rev-1", nodeId: null, summary, patches: [], createdAt: "2030-01-01T00:00:00.000Z" }],
          },
        },
      },
    },
  });
}

async function seedEvent(
  workspaceId: string,
  taskId: string,
  eventType: string,
  index: number,
  summary?: string,
) {
  return await db.event.create({
    data: {
      workspaceId,
      taskId,
      eventType,
      actorType: "system",
      source: "test",
      payload: {},
      summary: summary ?? null,
      dedupeKey: `dash-${eventType}-${index}-${crypto.randomUUID()}`,
      occurredAt: new Date(`2030-01-01T00:00:0${index}.000Z`),
      ingestSequence: index + 1,
    },
  });
}

describe("GET /api/dashboard", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns empty sections and zero all-time total for an empty workspace", async () => {
    const { workspaceId } = await seedWorkspace("Empty dashboard");

    const body = await fetchDashboard(workspaceId);
    expect(body.focusTask).toBeNull();
    expect(body.needsAttention).toEqual([]);
    expect(body.inProgress).toEqual([]);
    expect(body.autoCompleted).toEqual([]);
    expect(body.recentEvents).toEqual([]);
    expect(body.totalAutoCompleted).toBe(0);
  });

  it("derives attention kind, reason, and next step per bucket", async () => {
    const { workspaceId } = await seedWorkspace("Attention");
    const { taskId: blocked } = await seedTask(workspaceId, { title: "Blocked", status: "Blocked" });
    await seedProjection(workspaceId, blocked, {
      persistedStatus: "Blocked",
      blockDetail: "Needs confirmation to keep scraping data",
    });
    const { taskId: approval } = await seedTask(workspaceId, { title: "Approval", status: "WaitingForApproval" });
    await seedProjection(workspaceId, approval, { persistedStatus: "WaitingForApproval", approvalPendingCount: 1 });

    const body = await fetchDashboard(workspaceId);
    const byTask = new Map(body.needsAttention.map((item) => [item.taskId, item]));
    expect(byTask.get(blocked)?.kind).toBe("blocked");
    expect(byTask.get(blocked)?.reason).toBe("Needs confirmation to keep scraping data");
    expect(byTask.get(blocked)?.nextStep).toBe("resolve_block");
    expect(byTask.get(approval)?.kind).toBe("approval");
    expect(byTask.get(approval)?.nextStep).toBe("approve_or_edit");
  });

  it("picks the highest-impact non-terminal task as the focus headline", async () => {
    const { workspaceId } = await seedWorkspace("Focus");
    const { taskId: idle } = await seedTask(workspaceId, { title: "Idle low", status: "Ready", priority: "Low" });
    await seedProjection(workspaceId, idle, { persistedStatus: "Ready" });
    const { taskId: failing } = await seedTask(workspaceId, { title: "Failing urgent", status: "Failed", priority: "Urgent" });
    await seedProjection(workspaceId, failing, { persistedStatus: "Failed", blockDetail: "GitHub API request failed" });

    const body = await fetchDashboard(workspaceId);
    expect(body.focusTask?.taskId).toBe(failing);
    expect(body.focusTask?.reason).toBe("GitHub API request failed");
    expect(body.focusTask?.nextStep).toBe("resolve_block");
  });

  it("lists auto-completed tasks newest-first with their outputs", async () => {
    const { workspaceId } = await seedWorkspace("Completed");
    const { taskId: older } = await seedTask(workspaceId, { title: "Older done", status: "Completed" });
    await seedProjection(workspaceId, older, {
      persistedStatus: "Completed",
      lastActivityAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    const { taskId: newer } = await seedTask(workspaceId, { title: "Newer done", status: "Done" });
    await seedProjection(workspaceId, newer, {
      persistedStatus: "Done",
      lastActivityAt: new Date("2030-02-01T00:00:00.000Z"),
    });
    await seedPlanOutput(workspaceId, newer, "github-trending-summary");

    const body = await fetchDashboard(workspaceId);
    expect(body.autoCompleted.map((item) => item.taskId)).toEqual([newer, older]);
    expect(body.autoCompleted[0]?.output?.title).toBe("github-trending-summary");
    expect(body.autoCompleted[0]?.category).toBe("automation");
    expect(body.totalAutoCompleted).toBe(2);
  });

  it("surfaces only readable, task-scoped events in the recent feed", async () => {
    const { workspaceId } = await seedWorkspace("Feed");
    const { taskId } = await seedTask(workspaceId, { title: "GitHub trendings" });
    await seedProjection(workspaceId, taskId, { persistedStatus: "Running" });
    await seedEvent(workspaceId, taskId, "execution_started", 0);
    await seedEvent(workspaceId, taskId, "plan_generation.completed", 1);
    await seedEvent(workspaceId, taskId, "provider.text_delta", 2); // not feed-worthy

    const body = await fetchDashboard(workspaceId);
    expect(body.recentEvents).toHaveLength(2);
    expect(body.recentEvents.every((event) => event.taskTitle === "GitHub trendings")).toBe(true);
    expect(body.recentEvents.map((event) => event.category).sort()).toEqual(["plan", "started"]);
  });
});
