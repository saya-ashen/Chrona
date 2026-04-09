import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type AppendCanonicalEventInput = {
  eventType: string;
  workspaceId: string;
  taskId: string;
  runId?: string | null;
  actorType: string;
  actorId: string;
  source: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  runtimeTs?: Date | null;
};

export async function appendCanonicalEvent(input: AppendCanonicalEventInput) {
  const latest = await db.event.aggregate({ _max: { ingestSequence: true } });

  return db.event.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      eventType: input.eventType,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      payload: input.payload as Prisma.InputJsonValue,
      dedupeKey: input.dedupeKey,
      runtimeTs: input.runtimeTs ?? null,
      ingestSequence: (latest._max.ingestSequence ?? 0) + 1,
    },
  });
}
