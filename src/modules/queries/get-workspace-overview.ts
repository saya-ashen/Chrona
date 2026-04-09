import { db } from "@/lib/db";

export async function getWorkspaceOverview(workspaceId: string) {
  const projections = await db.taskProjection.findMany({
    where: { workspaceId },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
  });

  return {
    running: projections
      .filter((item) => item.persistedStatus === "Running")
      .map((item) => ({ taskId: item.taskId, latestRunStatus: item.latestRunStatus })),
    waitingForApproval: projections
      .filter((item) => item.displayState === "WaitingForApproval")
      .map((item) => ({ taskId: item.taskId, actionRequired: item.actionRequired })),
    blockedOrFailed: projections
      .filter(
        (item) =>
          item.persistedStatus === "Blocked" ||
          item.persistedStatus === "Failed" ||
          item.displayState === "Attention Needed",
      )
      .map((item) => ({ taskId: item.taskId, persistedStatus: item.persistedStatus })),
    scheduleRisks: projections
      .filter(
        (item) =>
          Boolean(item.scheduleStatus) &&
          ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus ?? ""),
      )
      .map((item) => ({
        taskId: item.taskId,
        scheduleStatus: item.scheduleStatus,
        actionRequired: item.actionRequired,
      })),
    upcomingDeadlines: projections
      .filter((item) => Boolean(item.dueAt))
      .sort((left, right) => (left.dueAt?.getTime() ?? Infinity) - (right.dueAt?.getTime() ?? Infinity))
      .slice(0, 5)
      .map((item) => ({ taskId: item.taskId, dueAt: item.dueAt })),
    recentlyUpdated: projections.slice(0, 5).map((item) => ({
      taskId: item.taskId,
      lastActivityAt: item.lastActivityAt,
    })),
  };
}
