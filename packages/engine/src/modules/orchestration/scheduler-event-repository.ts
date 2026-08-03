import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type SchedulerEventInput = {
  workspaceId: string;
  taskId: string;
  eventType: string;
  graphVersion?: number | null;
  reason?: string | null;
  payload?: Prisma.InputJsonValue;
};

export function recordSchedulerEvent(
  input: SchedulerEventInput,
  tx: Prisma.TransactionClient = db,
) {
  return tx.schedulerEvent.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      eventType: input.eventType,
      graphVersion: input.graphVersion ?? null,
      reason: input.reason ?? null,
      payload: redactSchedulerEventPayload(input.payload),
    },
  });
}

export function listSchedulerEvents(taskId: string) {
  return db.schedulerEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });
}

function redactSchedulerEventPayload(payload: Prisma.InputJsonValue | undefined) {
  if (!payload || typeof payload !== "object") {
    return payload ?? undefined;
  }

  return JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (/token|secret|credential|password|apiKey/i.test(key)) {
        return "[redacted]";
      }
      return value;
    }),
  );
}
