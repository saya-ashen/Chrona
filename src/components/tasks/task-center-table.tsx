import Link from "next/link";

type TaskCenterTableProps = {
  rows: Array<{
    taskId: string;
    title: string;
    persistedStatus: string;
    displayState: string | null;
    latestRunStatus: string | null;
    actionRequired: string | null;
    scheduleStatus: string | null;
    dueAt: Date | null;
    updatedAt: Date;
    workspaceId: string;
  }>;
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "-";
}

export function TaskCenterTable({ rows }: TaskCenterTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Latest Run</th>
            <th className="px-4 py-3 font-medium">Block Reason</th>
            <th className="px-4 py-3 font-medium">Schedule</th>
            <th className="px-4 py-3 font-medium">Due</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                No tasks match this filter.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.taskId} className="border-t align-top">
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <Link
                      href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">Open task for planning details, or jump straight into work.</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.displayState ?? row.persistedStatus}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.latestRunStatus ?? "No run"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.actionRequired ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.scheduleStatus ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(row.dueAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/workspaces/${row.workspaceId}/work/${row.taskId}`}
                      className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Open Work
                    </Link>
                    <Link
                      href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`}
                      className="rounded-md border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      Open Task
                    </Link>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
