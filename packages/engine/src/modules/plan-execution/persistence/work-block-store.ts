import { db } from "@/lib/db";

export async function activateWorkBlock(taskId: string, workBlockId?: string | null) {
  const targetWorkBlockId = workBlockId ?? (await db.workBlock.findFirst({
    where: { taskId, status: "Scheduled" },
    orderBy: { scheduledStartAt: "asc" },
    select: { id: true },
  }))?.id ?? null;

  if (!targetWorkBlockId) return;

  await db.workBlock.updateMany({
    where: { id: targetWorkBlockId, taskId },
    data: { status: "Active", startedAt: new Date() },
  });
}

export async function completeWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Active" },
    data: { status: "Completed", completedAt: new Date() },
  });
}

export async function releaseWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Active" },
    data: { status: "Scheduled", startedAt: null },
  });
}
