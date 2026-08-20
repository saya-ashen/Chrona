import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { json, resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

describe("task workspace activity endpoint", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns paged task activity with next cursor", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Activity History");
    const { taskId } = await seedTask(workspaceId, { title: "Activity history" });

    await db.event.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        eventType: "task.updated",
        workspaceId,
        taskId,
        actorType: "user",
        actorId: "test-user",
        source: "ui",
        payload: { changed_fields: [`field_${index}`] },
        dedupeKey: `activity-history-${index}`,
        occurredAt: new Date(`2026-05-22T00:00:0${index}.000Z`),
        ingestSequence: index + 1,
      })),
    });

    const res = await app().request(`/api/tasks/${taskId}/activity?limit=2`);
    const body = await json<{ items: Array<{ id: string; summary: string }>; nextCursor?: string; scope: { type: string; limit: number } }>(res);

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item) => item.summary)).toEqual(["Updated field_3", "Updated field_2"]);
    expect(body.nextCursor).toBe(body.items[1]?.id);
    expect(body.scope).toMatchObject({ type: "task", limit: 2 });
  });

  it("merges coarse timeline items with provider tool events", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Mixed Activity");
    const { taskId } = await seedTask(workspaceId, { title: "Mixed activity" });

    await db.taskTimelineItem.create({
      data: {
        workspaceId,
        taskId,
        kind: "plan_execution.node_started",
        title: "Node started",
        body: "Run implementation",
        severity: "info",
        status: "running",
        nodeId: "node-a",
        sortTime: new Date("2026-05-22T00:00:02.000Z"),
        metadata: { nodeId: "node-a" },
      },
    });
    await db.event.createMany({
      data: [{
        eventType: "provider.tool_started",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        nodeId: "node-a",
        nodeTitle: "Node A",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "tool_started", toolName: "chrona_task_read", preview: "Read task" } },
        dedupeKey: "activity-tool-started",
        occurredAt: new Date("2026-05-22T00:00:03.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "provider.tool_completed",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        nodeId: "node-a",
        nodeTitle: "Node A",
        payload: { runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "tool_completed", toolName: "chrona_task_read", durationMs: 42 } },
        dedupeKey: "activity-tool-completed",
        occurredAt: new Date("2026-05-22T00:00:04.000Z"),
        ingestSequence: 2,
      }],
    });

    const res = await app().request(`/api/tasks/${taskId}/activity?limit=10`);
    const body = await json<{ items: Array<{ kind: string; title: string; sourceNodeId?: string }> }>(res);

    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.kind)).toEqual(["tool_completed", "tool_started", "node"]);
    expect(body.items.map((item) => item.title)).toEqual(["Tool completed", "Tool started", "Node started"]);
    expect(body.items.every((item) => item.sourceNodeId === "node-a")).toBe(true);
  });

  it("uses fixed public descriptors when provider implementation differs from runtime", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Provider Labeling");
    const { taskId } = await seedTask(workspaceId, { title: "Provider labeling" });

    await db.event.create({
      data: {
        eventType: "provider.run_started",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          executionScope: "scope-provider-label",
          providerLabel: "AI provider",
          runtimeLabel: "Execution runtime",
          runtimeName: "hermes",
          provider: "claude_code",
          runId: "run-1",
          event: { type: "run_started" },
        },
        dedupeKey: "activity-provider-label",
        occurredAt: new Date("2026-05-22T00:00:05.000Z"),
        ingestSequence: 1,
      },
    });

    const res = await app().request(`/api/tasks/${taskId}/activity?limit=10`);
    const body = await json<{ items: Array<{ provider?: string; runtimeName?: string; summary: string }> }>(res);

    expect(res.status).toBe(200);
    expect(body.items[0]).toMatchObject({ provider: "AI provider", runtimeName: "Execution runtime", summary: "AI provider", executionScope: "scope-provider-label" });
  });

  it("projects top-level provider tool lifecycle without tool content", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Top Level Tool Payload");
    const { taskId } = await seedTask(workspaceId, { title: "Top-level tool payload" });

    await db.event.create({
      data: {
        eventType: "provider.tool_completed",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: {
          executionScope: "scope-tool",
          providerLabel: "AI provider",
          runtimeLabel: "Execution runtime",
          toolLabel: "Runtime tool",
          runtimeName: "hermes",
          provider: "codex",
          runId: "run-1",
          toolName: "bash",
          preview: "python3 -c fetch trending",
          rawEventType: "tool_call_update",
        },
        dedupeKey: "activity-top-level-tool-payload",
        occurredAt: new Date("2026-05-22T00:00:06.000Z"),
        ingestSequence: 1,
      },
    });

    const res = await app().request(`/api/tasks/${taskId}/activity?limit=10`);
    const body = await json<{ items: Array<{ tool?: { name?: string; state?: string } }> }>(res);

    expect(res.status).toBe(200);
    expect(body.items[0]?.tool).toMatchObject({
      name: "bash",
      state: "completed",
    });
    expect(JSON.stringify(body.items)).not.toContain("run-1");
    expect(JSON.stringify(body.items)).not.toContain("python3 -c fetch trending");
  });


  it("drops generic provider events from the activity feed", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Generic Provider Event");
    const { taskId } = await seedTask(workspaceId, { title: "Generic provider event" });

    await db.event.create({
      data: {
        eventType: "provider.system",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "claude_code",
        source: "provider",
        payload: {
          runtimeName: "hermes",
          provider: "claude_code",
          runId: "run-1",
          event: { type: "system" },
        },
        dedupeKey: "activity-generic-provider-event",
        occurredAt: new Date("2026-05-22T00:00:06.000Z"),
        ingestSequence: 1,
      },
    });

    const res = await app().request(`/api/tasks/${taskId}/activity?limit=10`);
    const body = await json<{ items: Array<{ title: string }> }>(res);

    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
  });
  it("returns node-scoped activity without inferring nearby provider events", async () => {
    const { workspaceId } = await seedWorkspace("Workspace Node Activity History");
    const { taskId } = await seedTask(workspaceId, { title: "Node activity history" });

    await db.event.createMany({
      data: [{
        eventType: "provider.run_started",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        nodeId: "node-a",
        nodeTitle: "Node A",
        payload: { executionScope: "scope-node-a", providerLabel: "AI provider", runtimeLabel: "Execution runtime", runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "run_started" } },
        dedupeKey: "activity-node-a",
        occurredAt: new Date("2026-05-22T00:00:01.000Z"),
        ingestSequence: 1,
      }, {
        eventType: "provider.run_started",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        payload: { executionScope: "scope-task", providerLabel: "AI provider", runtimeLabel: "Execution runtime", runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "run_started" } },
        dedupeKey: "activity-no-node",
        occurredAt: new Date("2026-05-22T00:00:02.000Z"),
        ingestSequence: 2,
      }, {
        eventType: "provider.run_started",
        workspaceId,
        taskId,
        actorType: "runtime",
        actorId: "hermes",
        source: "provider",
        nodeId: "node-b",
        nodeTitle: "Node B",
        payload: { executionScope: "scope-node-b", providerLabel: "AI provider", runtimeLabel: "Execution runtime", runtimeName: "hermes", provider: "anthropic", runId: "run-1", event: { type: "run_started" } },
        dedupeKey: "activity-node-b",
        occurredAt: new Date("2026-05-22T00:00:03.000Z"),
        ingestSequence: 3,
      }],
    });

    const res = await app().request(`/api/tasks/${taskId}/nodes/node-a/activity?limit=10`);
    const body = await json<{ items: Array<{ sourceNodeId?: string; summary: string }>; scope: { type: string; nodeId?: string } }>(res);

    expect(res.status).toBe(200);
    expect(body.scope).toMatchObject({ type: "node", nodeId: "node-a" });
    expect(body.items).toEqual([expect.objectContaining({ sourceNodeId: "node-a", summary: "AI provider", executionScope: "scope-node-a" })]);
  });
});
