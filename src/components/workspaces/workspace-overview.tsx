type WorkspaceOverviewProps = {
  data: {
    running: Array<{ taskId: string; latestRunStatus: string | null }>;
    waitingForApproval: Array<{ taskId: string; actionRequired: string | null }>;
    blockedOrFailed: Array<{ taskId: string; persistedStatus: string }>;
    upcomingDeadlines: Array<{ taskId: string; dueAt: Date | null }>;
    recentlyUpdated: Array<{ taskId: string; lastActivityAt: Date | null }>;
  };
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "-";
}

export function WorkspaceOverview({ data }: WorkspaceOverviewProps) {
  const sections = [
    {
      title: "Running Tasks",
      items: data.running.map((item) => ({
        taskId: item.taskId,
        meta: item.latestRunStatus ?? "No run yet",
      })),
    },
    {
      title: "Waiting for Approval",
      items: data.waitingForApproval.map((item) => ({
        taskId: item.taskId,
        meta: item.actionRequired ?? "Open task",
      })),
    },
    {
      title: "Blocked / Failed Tasks",
      items: data.blockedOrFailed.map((item) => ({
        taskId: item.taskId,
        meta: item.persistedStatus,
      })),
    },
    {
      title: "Upcoming Deadlines",
      items: data.upcomingDeadlines.map((item) => ({
        taskId: item.taskId,
        meta: formatDate(item.dueAt),
      })),
    },
    {
      title: "Recently Updated Tasks",
      items: data.recentlyUpdated.map((item) => ({
        taskId: item.taskId,
        meta: item.lastActivityAt ? item.lastActivityAt.toISOString() : "No activity yet",
      })),
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => (
        <section key={section.title} className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {section.items.length === 0 ? (
              <p>No items</p>
            ) : (
              section.items.map((item) => (
                <div
                  key={`${section.title}-${item.taskId}`}
                  className="rounded-xl border bg-background px-3 py-2"
                >
                  <p className="font-medium text-foreground">{item.taskId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
