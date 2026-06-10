import { beforeEach, describe, expect, it } from "bun:test";
import { ApprovalStatus, ArtifactType, RunStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { getTaskPage } from "@chrona/engine/modules/tasks/get-task-page";
import { json, resetTestDb, seedScheduleProposal, seedTask, seedWorkspace } from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("task workspace console read data", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns schedule proposals and latest run data needed by the workspace console", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Console");
    const { taskId } = await seedTask(workspaceId, { title: "Scheduled execution" });
    const scheduledStartAt = new Date("2026-05-13T09:00:00.000Z");

    await seedScheduleProposal({
      workspaceId,
      taskId,
      summary: "Start tomorrow morning after dependency checks.",
      scheduledStartAt,
      status: "Pending",
    });
    await seedScheduleProposal({
      workspaceId,
      taskId,
      summary: "Rejected schedule should stay out of workspace readiness.",
      status: "Rejected",
    });

    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeRunRef: "run-workspace-console",
        status: RunStatus.Running,
        syncStatus: "syncing",
        triggeredBy: "user",
        startedAt: new Date("2026-05-12T10:00:00.000Z"),
      },
    });

    const page = await getTaskPage(taskId);

    expect(page.scheduleProposals).toHaveLength(1);
    expect(page.scheduleProposals[0]).toMatchObject({
      source: "ai",
      proposedBy: "test-agent",
      summary: "Start tomorrow morning after dependency checks.",
      status: "Pending",
      scheduledStartAt: scheduledStartAt.toISOString(),
    });
    expect(page.latestRunSummary).toMatchObject({
      id: run.id,
      status: "Running",
      startedAt: "2026-05-12T10:00:00.000Z",
    });
    expect(typeof page.latestRunSummary?.syncStatus).toBe("string");
  });

  it("returns approvals and artifacts needed by human-review workspace cards", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Human Review");
    const { taskId } = await seedTask(workspaceId, { title: "Review execution" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeRunRef: "run-human-review",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "agent",
        startedAt: new Date("2026-05-12T11:00:00.000Z"),
      },
    });

    await db.approval.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: "result_review",
        title: "Approve generated patch",
        summary: "Patch changes core task behavior.",
        riskLevel: "medium",
        status: ApprovalStatus.Pending,
        requestedAt: new Date("2026-05-12T11:05:00.000Z"),
      },
    });
    await db.artifact.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: ArtifactType.patch,
        title: "Generated patch",
        uri: "file://patch.diff",
      },
    });

    const page = await getTaskPage(taskId);

    expect(page.approvals).toContainEqual(expect.objectContaining({
      title: "Approve generated patch",
      status: "Pending",
      riskLevel: "medium",
      requestedAt: "2026-05-12T11:05:00.000Z",
    }));
    expect(page.artifacts).toContainEqual(expect.objectContaining({
      title: "Generated patch",
      type: "patch",
      uri: "file://patch.diff",
    }));
  });

  it("returns command center json-render documents only", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Command Center API");
    const { taskId } = await seedTask(workspaceId, { title: "Render command center" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeRunRef: "run-command-center-documents",
        status: RunStatus.Completed,
        triggeredBy: "agent",
        startedAt: new Date("2026-05-12T11:00:00.000Z"),
      },
    });


    await db.artifact.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        type: ArtifactType.summary,
        title: "Generated summary",
        uri: "file://summary.md",
      },
    });

    const response = await app().request(`/api/tasks/${taskId}/command-center`);
    expect(response.status).toBe(200);

    const body = await json<Record<string, unknown>>(response);
    expect(Object.keys(body).sort()).toEqual(["documents"]);
    expect(body).not.toHaveProperty("artifacts");
    expect(body).not.toHaveProperty("activityTimeline");
    expect(body).not.toHaveProperty("ui");
    // Header spec now lives on its own endpoint
    // (`GET /api/tasks/:taskId/workspace/header`) — command-center returns
    // only the 3 right-pane documents.
    expect(body.documents).toMatchObject({
      now: { root: "root", elements: expect.any(Object) },
      output: { root: "root", elements: expect.any(Object) },
      trail: { root: "root", elements: expect.any(Object) },
    });
    expect(body.documents).not.toHaveProperty("header");
  });

  it("returns command center Trail items from persisted database activity", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Command Center Trail Activity");
    const { taskId } = await seedTask(workspaceId, { title: "Render command center trail" });
    await db.event.createMany({
      data: [{
        eventType: "plan_generation.started",
        workspaceId,
        taskId,
        actorType: "system",
        actorId: "plan-generator",
        source: "plan_generation",
        payload: { generation_id: "generation-command-center", instruction: "Make a plan" },
        dedupeKey: "command-center-trail-plan-started",
        occurredAt: new Date("2026-05-12T12:01:06.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "plan_generation.status",
        workspaceId,
        taskId,
        actorType: "system",
        actorId: "plan-generator",
        source: "plan_generation",
        payload: { generation_id: "generation-command-center", message: "Requesting AI provider..." },
        dedupeKey: "command-center-trail-plan-status",
        occurredAt: new Date("2026-05-12T12:01:07.000Z"),
        ingestSequence: 2,
      }],
    });

    const response = await app().request(`/api/tasks/${taskId}/command-center`);
    expect(response.status).toBe(200);

    const body = await json<{ documents: { trail: { state?: { trail?: { items?: Array<{ title?: string; description?: string; rawEventType?: string; activityGroup?: { kind?: string; id?: string } }> } } } } }>(response);
    const items = body.documents.trail.state?.trail?.items ?? [];
    expect(items).toContainEqual(expect.objectContaining({ title: "Plan generation started", description: "Make a plan", rawEventType: "plan_generation.started", activityGroup: { kind: "plan_generation", id: "generation-command-center" } }));
    expect(items).toContainEqual(expect.objectContaining({ title: "Plan generation update", description: "Requesting AI provider...", rawEventType: "plan_generation.status", activityGroup: { kind: "plan_generation", id: "generation-command-center" } }));
  });


  it("returns persisted provider runtime activity for the workspace activity timeline", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Provider Activity");
    const { taskId } = await seedTask(workspaceId, { title: "Stream provider activity" });
    const run = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        runtimeRunRef: "run-provider-activity",
        status: RunStatus.Running,
        triggeredBy: "agent",
        startedAt: new Date("2026-05-12T12:00:00.000Z"),
      },
    });

    await db.event.create({
      data: {
        eventType: "provider.tool_started",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          runtimeName: "hermes",
          provider: "hermes",
          event: { type: "tool_started", toolName: "chrona_plan_read" },
        },
        dedupeKey: "provider-runtime-test-event",
        occurredAt: new Date("2026-05-12T12:01:00.000Z"),
        ingestSequence: 1,
      },
    });
    await db.event.createMany({
      data: [{
        eventType: "provider.text_delta",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          runtimeName: "hermes",
          provider: "hermes",
          runId: "provider-run-1",
          event: { type: "text_delta", text: "Hello " },
        },
        dedupeKey: "provider-runtime-test-text-1",
        occurredAt: new Date("2026-05-12T12:01:01.000Z"),
        ingestSequence: 2,
      }, {
        eventType: "provider.text_delta",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          runtimeName: "hermes",
          provider: "hermes",
          runId: "provider-run-1",
          event: { type: "text_delta", text: "world" },
        },
        dedupeKey: "provider-runtime-test-text-2",
        occurredAt: new Date("2026-05-12T12:01:02.000Z"),
        ingestSequence: 3,
      }, {
        eventType: "provider.reasoning_delta",
        workspaceId,
        taskId,
        runId: run.id,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          runtimeName: "hermes",
          provider: "hermes",
          runId: "provider-run-1",
          event: { type: "reasoning_delta", text: "Thinking" },
        },
        dedupeKey: "provider-runtime-test-reasoning-1",
        occurredAt: new Date("2026-05-12T12:01:03.000Z"),
        ingestSequence: 4,
      }, {
        eventType: "task.updated",
        workspaceId,
        taskId,
        actorType: "user",
        actorId: "test-user",
        source: "ui",
        payload: { changed_fields: ["title", "priority"] },
        dedupeKey: "task-activity-test-updated",
        occurredAt: new Date("2026-05-12T12:01:04.000Z"),
        ingestSequence: 5,
      }, {
        eventType: "task.schedule_changed",
        workspaceId,
        taskId,
        actorType: "user",
        actorId: "test-user",
        source: "ui",
        payload: {
          scheduledStartAt: "2026-05-13T09:00:00.000Z",
          scheduledEndAt: "2026-05-13T10:00:00.000Z",
          source: "manual",
        },
        dedupeKey: "task-activity-test-schedule",
        occurredAt: new Date("2026-05-12T12:01:05.000Z"),
        ingestSequence: 6,
      }, {
        eventType: "plan_generation.started",
        workspaceId,
        taskId,
        actorType: "system",
        actorId: "plan-generator",
        source: "plan_generation",
        payload: { generation_id: "generation-test", instruction: "Make a plan" },
        dedupeKey: "task-activity-test-plan-started",
        occurredAt: new Date("2026-05-12T12:01:06.000Z"),
        ingestSequence: 7,
      }, {
        eventType: "plan_generation.status",
        workspaceId,
        taskId,
        actorType: "system",
        actorId: "plan-generator",
        source: "plan_generation",
        payload: { generation_id: "generation-test", phase: "requesting_provider", message: "Requesting AI provider..." },
        dedupeKey: "task-activity-test-plan-status",
        occurredAt: new Date("2026-05-12T12:01:06.500Z"),
        ingestSequence: 8,
      }, {
        eventType: "plan_generation.completed",
        workspaceId,
        taskId,
        actorType: "system",
        actorId: "plan-generator",
        source: "plan_generation",
        payload: { generation_id: "generation-test", plan_title: "Generated plan" },
        dedupeKey: "task-activity-test-plan-completed",
        occurredAt: new Date("2026-05-12T12:01:07.000Z"),
        ingestSequence: 9,
      }],
    });

    const page = await getTaskPage(taskId);

    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "tool_started",
      title: "Tool started",
      summary: "chrona_plan_read",
      description: "chrona_plan_read",
      tone: "info",
      timestamp: "2026-05-12T12:01:00.000Z",
      provider: "hermes",
      runtimeName: "hermes",
      tool: expect.objectContaining({ name: "chrona_plan_read", state: "started" }),
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "assistant_message",
      title: "Assistant response",
      summary: "Hello world",
      description: "Hello world",
      tone: "info",
      timestamp: "2026-05-12T12:01:02.000Z",
      assistant: { text: "Hello world", isReasoning: false, isPartial: true },
    }));
    expect(page.activityTimeline.filter((item) => item.title === "Assistant response")).toHaveLength(1);
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "reasoning",
      title: "Reasoning",
      summary: "Thinking",
      description: "Thinking",
      tone: "neutral",
      assistant: { text: "Thinking", isReasoning: true, isPartial: true },
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "task",
      title: "Task updated",
      summary: "Updated title, priority",
      description: "Updated title, priority",
      tone: "info",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      kind: "schedule",
      title: "Schedule changed",
      summary: "2026-05-13T09:00:00.000Z · 2026-05-13T10:00:00.000Z · manual",
      description: "2026-05-13T09:00:00.000Z · 2026-05-13T10:00:00.000Z · manual",
      tone: "info",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      title: "Plan generation started",
      description: "Make a plan",
      tone: "info",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      title: "Plan generation update",
      description: "Requesting AI provider...",
      tone: "info",
    }));
    expect(page.activityTimeline).toContainEqual(expect.objectContaining({
      title: "Plan generated",
      description: "Generated plan",
      tone: "success",
    }));
  });

  it("returns a header json-render document for the dedicated workspace/header endpoint", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Header");
    const { taskId } = await seedTask(workspaceId, { title: "Header doc task" });

    const response = await app().request(`/api/tasks/${taskId}/workspace/header`);
    expect(response.status).toBe(200);

    const body = await json<Record<string, unknown>>(response);
    expect(Object.keys(body).sort()).toEqual(["spec"]);
    expect(body).not.toHaveProperty("documents");
    expect(body.spec).toMatchObject({
      root: expect.any(String),
      elements: expect.any(Object),
    });
  });

  it("404s the header endpoint for unknown task ids", async () => {
    const response = await app().request("/api/tasks/missing-task/workspace/header");
    expect(response.status).toBe(404);
  });

  it("scopes the header spec to the requested work block", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Header Scoped");
    const { taskId } = await seedTask(workspaceId, { title: "Scoped header" });

    const unscoped = await app().request(`/api/tasks/${taskId}/workspace/header`);
    const scoped = await app().request(`/api/tasks/${taskId}/workspace/header?workBlockId=missing`);
    expect(unscoped.status).toBe(200);
    expect(scoped.status).toBe(200);
    // The two responses have the same shape; the seedTask helper does
    // not create a second work block, so the two payloads are
    // byte-identical here — the assertion is that the route does not
    // 500 when an unknown work block is requested.
    const a = await json<Record<string, unknown>>(unscoped);
    const b = await json<Record<string, unknown>>(scoped);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});
