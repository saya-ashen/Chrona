import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { archiveExpiredEventRecords, readEventRetentionConfig } from "@chrona/engine/test-support";

async function resetDb() {
  await db.eventRetentionArchive.deleteMany();
  await db.taskTimelineItem.deleteMany();
  await db.event.deleteMany();
  await db.rawEventLog.deleteMany();
  await db.workspace.deleteMany();
}

describe("event retention", () => {
  beforeEach(resetDb);

  it("archives and deletes a bounded batch with a deterministic audit checksum", async () => {
    await db.workspace.create({
      data: { id: "ws_retention", name: "Retention", status: "Active" },
    });
    const old = new Date("2026-01-01T00:00:00.000Z");
    await db.rawEventLog.createMany({
      data: ["one", "two", "three"].map((id) => ({
        id,
        workspaceId: "ws_retention",
        source: "test",
        direction: "inbound",
        rawType: "test",
        payloadHash: `hash-${id}`,
        receivedAt: old,
      })),
    });

    const result = await archiveExpiredEventRecords({
      now: new Date("2026-02-01T00:00:00.000Z"),
      config: { retentionDays: 1, batchSize: 2 },
    });

    expect(result.archived.raw_event_log).toBe(2);
    expect(await db.rawEventLog.count()).toBe(1);
    const archive = await db.eventRetentionArchive.findFirstOrThrow({ where: { source: "raw_event_log" } });
    expect(archive.recordCount).toBe(2);
    expect(archive.firstRecordId).toBe("one");
    expect(archive.lastRecordId).toBe("three");
    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("bounds invalid environment retention configuration", () => {
    expect(readEventRetentionConfig({ CHRONA_EVENT_RETENTION_DAYS: "0", CHRONA_EVENT_RETENTION_BATCH_SIZE: "2000" }))
      .toEqual({ retentionDays: 30, batchSize: 1000 });
  });
});
