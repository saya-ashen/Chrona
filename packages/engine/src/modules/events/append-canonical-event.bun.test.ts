import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";

import { appendCanonicalEvent, appendRawEventLog } from "@chrona/engine/test-support";

async function resetDb() {
  await db.importedCalendarEvent.deleteMany();
  await db.calendarSource.deleteMany();
  await db.taskAssistantMessage.deleteMany();
  await db.taskPlanProviderApproval.deleteMany();
  await db.taskPlanProviderRun.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanLayer.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.graphMutationRecord.deleteMany();
  await db.graphVersion.deleteMany();
  await db.reconciliationEvent.deleteMany();
  await db.schedulerEvent.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.taskTimelineItem.deleteMany();
  await db.event.deleteMany();
  await db.rawEventLog.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.schedulerLease.deleteMany();
  await db.workspace.deleteMany();
}

describe("appendRawEventLog", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("persists raw events with work block context without sending unsupported fields to Prisma", async () => {
    await db.workspace.create({
      data: {
        id: "ws_event_context",
        name: "Event context workspace",
        defaultRuntime: "debug",
        status: "Active",
      },
    });

    const rawEvent = await appendRawEventLog({
      workspaceId: "ws_event_context",
      workBlockId: "wb_context_only",
      source: "graph_runtime",
      direction: "inbound",
      rawType: "execution_started",
      rawPayload: { type: "execution_started", payload: { trigger: "manual" } },
      externalRef: "plan_execution:execution_started:test",
    });

    expect(rawEvent.workspaceId).toBe("ws_event_context");
    expect(rawEvent.source).toBe("graph_runtime");
    expect(rawEvent.externalRef).toBe("plan_execution:execution_started:test");
  });
});

describe("appendCanonicalEvent", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("drops stale optional foreign-key refs before upsert", async () => {
    await db.workspace.create({
      data: {
        id: "ws_event_context",
        name: "Event context workspace",
        defaultRuntime: "debug",
        status: "Active",
      },
    });

    const event = await appendCanonicalEvent({
      workspaceId: "ws_event_context",
      taskId: "missing-task",
      workBlockId: "missing-block",
      runId: "missing-run",
      rawEventId: "missing-raw",
      eventType: "plan_generation.failed",
      actorType: "system",
      source: "plan_generation",
      payload: { code: "INVALID_TOOL_PAYLOAD" },
      dedupeKey: "plan_generation:missing-task:generation:failed",
    });

    expect(event.taskId).toBeNull();
    expect(event.workBlockId).toBeNull();
    expect(event.runId).toBeNull();
    expect(event.rawEventId).toBeNull();
  });
});
