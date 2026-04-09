import { db } from "@/lib/db";

export async function getWorkspaceOverview(workspaceId: string) {
  const projections = await db.taskProjection.findMany({
    where: { workspaceId },
    include: { task: true },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
  });

  return {
    running: projections
      .filter((item) => item.persistedStatus === "Running")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        latestRunStatus: item.latestRunStatus,
      })),
    waitingForApproval: projections
      .filter((item) => item.displayState === "WaitingForApproval")
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        actionRequired: item.actionRequired,
        latestRunStatus: item.latestRunStatus,
      })),
    blockedOrFailed: projections
      .filter(
        (item) =>
          item.persistedStatus === "Blocked" ||
          item.persistedStatus === "Failed" ||
          item.displayState === "Attention Needed",
      )
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        persistedStatus: item.persistedStatus,
        latestRunStatus: item.latestRunStatus,
      })),
    scheduleRisks: projections
      .filter(
        (item) =>
          Boolean(item.scheduleStatus) &&
          ["AtRisk", "Overdue", "Interrupted"].includes(item.scheduleStatus ?? ""),
      )
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        scheduleStatus: item.scheduleStatus,
        actionRequired: item.actionRequired,
        latestRunStatus: item.latestRunStatus,
      })),
    upcomingDeadlines: projections
      .filter((item) => Boolean(item.dueAt))
      .sort((left, right) => (left.dueAt?.getTime() ?? Infinity) - (right.dueAt?.getTime() ?? Infinity))
      .slice(0, 5)
      .map((item) => ({
        taskId: item.taskId,
        workspaceId: item.workspaceId,
        title: item.task.title,
        dueAt: item.dueAt,
        latestRunStatus: item.latestRunStatus,
      })),
    recentlyUpdated: projections.slice(0, 5).map((item) => ({
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.task.title,
      lastActivityAt: item.lastActivityAt,
      latestRunStatus: item.latestRunStatus,
    })),
  };
}
