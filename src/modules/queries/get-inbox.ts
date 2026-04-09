import { ApprovalStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export async function getInbox() {
  const approvals = await db.approval.findMany({
    where: { status: ApprovalStatus.Pending },
    include: {
      task: true,
      run: true,
    },
    orderBy: { requestedAt: "desc" },
  });

  return approvals.map((approval) => {
    const payload = (approval.payload as { consequence?: string; ask?: string } | null) ?? null;

    return {
      id: approval.id,
      actionType: approval.type,
      riskLevel: approval.riskLevel,
      sourceTaskTitle: approval.task.title,
      currentRunLabel: approval.run.runtimeRunRef ?? approval.run.id,
      summary: approval.summary,
      consequence: payload?.consequence ?? payload?.ask ?? "Task remains blocked until resolved.",
    };
  });
}
