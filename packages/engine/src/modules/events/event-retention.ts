import { createHash } from "node:crypto";

import { db } from "@/lib/db";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;

type RetentionSource = "raw_event_log" | "event" | "task_timeline_item";

type RetentionRecord = {
  id: string;
  recordedAt: Date;
  checksumMaterial: string;
};

export type EventRetentionConfig = {
  batchSize: number;
  retentionDays: number;
};

export type EventRetentionArchiveResult = {
  archived: Record<RetentionSource, number>;
  cutoffAt: Date;
};

function readBoundedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

/** Bounded retention configuration; explicit environment values override defaults. */
export function readEventRetentionConfig(env: NodeJS.ProcessEnv = process.env): EventRetentionConfig {
  return {
    retentionDays: readBoundedPositiveInteger(env.CHRONA_EVENT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 3_650),
    batchSize: readBoundedPositiveInteger(env.CHRONA_EVENT_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
  };
}

function checksum(source: RetentionSource, records: RetentionRecord[]) {
  const digest = createHash("sha256");
  digest.update(source);
  digest.update("\n");
  for (const record of records) {
    digest.update(record.id);
    digest.update("\u0000");
    digest.update(record.recordedAt.toISOString());
    digest.update("\u0000");
    digest.update(record.checksumMaterial);
    digest.update("\n");
  }
  return digest.digest("hex");
}

async function archiveBatch(source: RetentionSource, cutoffAt: Date, batchSize: number): Promise<number> {
  let records: RetentionRecord[];

  switch (source) {
    case "raw_event_log": {
      const rows = await db.rawEventLog.findMany({
        where: { receivedAt: { lt: cutoffAt } },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, receivedAt: true, payloadHash: true },
      });
      records = rows.map((row) => ({ id: row.id, recordedAt: row.receivedAt, checksumMaterial: row.payloadHash }));
      break;
    }
    case "event": {
      const rows = await db.event.findMany({
        where: { createdAt: { lt: cutoffAt } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, createdAt: true, eventType: true, ingestSequence: true, summary: true },
      });
      records = rows.map((row) => ({
        id: row.id,
        recordedAt: row.createdAt,
        checksumMaterial: `${row.eventType}\u0000${row.ingestSequence}\u0000${row.summary ?? ""}`,
      }));
      break;
    }
    case "task_timeline_item": {
      const rows = await db.taskTimelineItem.findMany({
        where: { createdAt: { lt: cutoffAt } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, createdAt: true, kind: true, title: true, status: true },
      });
      records = rows.map((row) => ({
        id: row.id,
        recordedAt: row.createdAt,
        checksumMaterial: `${row.kind}\u0000${row.title}\u0000${row.status ?? ""}`,
      }));
      break;
    }
  }

  if (records.length === 0) return 0;

  const first = records[0]!;
  const last = records.at(-1)!;
  const recordIds = records.map((record) => record.id);
  const archive = {
    source,
    cutoffAt,
    recordCount: records.length,
    firstRecordId: first.id,
    lastRecordId: last.id,
    firstRecordedAt: first.recordedAt,
    lastRecordedAt: last.recordedAt,
    checksum: checksum(source, records),
  };

  await db.$transaction(async (tx) => {
    await tx.eventRetentionArchive.create({ data: archive });
    if (source === "raw_event_log") {
      await tx.rawEventLog.deleteMany({ where: { id: { in: recordIds } } });
    } else if (source === "event") {
      await tx.event.deleteMany({ where: { id: { in: recordIds } } });
    } else {
      await tx.taskTimelineItem.deleteMany({ where: { id: { in: recordIds } } });
    }
  });

  return records.length;
}

/**
 * Archives at most one bounded batch for each high-volume event table. The
 * compact archive row is written atomically with deletion and preserves a
 * deterministic SHA-256 evidence checksum without retaining raw payloads.
 */
export async function archiveExpiredEventRecords(input: {
  config?: EventRetentionConfig;
  now?: Date;
} = {}): Promise<EventRetentionArchiveResult> {
  const config = input.config ?? readEventRetentionConfig();
  const cutoffAt = new Date((input.now ?? new Date()).getTime() - config.retentionDays * 24 * 60 * 60 * 1_000);
  const sources: RetentionSource[] = ["raw_event_log", "event", "task_timeline_item"];
  const archived = {} as Record<RetentionSource, number>;

  for (const source of sources) {
    archived[source] = await archiveBatch(source, cutoffAt, config.batchSize);
  }

  return { cutoffAt, archived };
}
