import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";

import { appendRawEventLog } from "./append-canonical-event";

async function resetDb() {
  await db.event.deleteMany();
  await db.rawEventLog.deleteMany();
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
