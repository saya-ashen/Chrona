import { db } from "@/lib/db";

export async function activateWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Scheduled" },
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

export async function cancelWorkBlock(taskId: string, workBlockId?: string | null) {
  await db.workBlock.updateMany({
    where: workBlockId
      ? { id: workBlockId, taskId }
      : { taskId, status: "Active" },
    data: { status: "Cancelled" },
  });
}
