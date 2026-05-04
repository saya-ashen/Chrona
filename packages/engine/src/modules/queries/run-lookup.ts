import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export async function getWaitingInputRun(taskId: string) {
  return db.run.findFirst({
    where: { taskId, status: RunStatus.WaitingForInput },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
}

export async function getActiveMessageableRun(taskId: string) {
  return db.run.findFirst({
    where: { taskId, status: { in: [RunStatus.Running, RunStatus.WaitingForApproval] } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
}
