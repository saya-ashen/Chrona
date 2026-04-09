import { db } from "@/lib/db";

export async function getTaskCenter(
  workspaceId: string,
  filter?: "Running" | "WaitingForApproval" | "Blocked" | "Failed" | "Unscheduled" | "Overdue",
) {
  const projections = await db.taskProjection.findMany({
    where: { workspaceId },
    include: { task: true },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
  });

  return projections
    .filter((item) => {
      if (!filter) {
        return true;
      }

      if (filter === "WaitingForApproval") {
        return item.displayState === "WaitingForApproval";
      }

      if (filter === "Failed") {
        return item.persistedStatus === "Failed" || item.displayState === "Attention Needed";
      }

      if (filter === "Blocked") {
        return (
          item.persistedStatus === "Blocked" &&
          item.displayState !== "WaitingForApproval" &&
          item.displayState !== "Attention Needed"
        );
      }

      if (filter === "Unscheduled" || filter === "Overdue") {
        return item.scheduleStatus === filter;
      }

      return item.persistedStatus === filter;
    })
    .map((item) => ({
      taskId: item.taskId,
      title: item.task.title,
      persistedStatus: item.persistedStatus,
      displayState: item.displayState,
      latestRunStatus: item.latestRunStatus,
      actionRequired: item.actionRequired,
      scheduleStatus: item.scheduleStatus,
      dueAt: item.dueAt,
      updatedAt: item.lastActivityAt ?? item.updatedAt,
      workspaceId: item.workspaceId,
    }));
}
