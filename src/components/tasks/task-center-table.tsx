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
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                No tasks match this filter.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.taskId} className="border-t align-top">
                <td className="px-4 py-3">
                  <Link
                    href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`}
                    className="font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {row.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.displayState ?? row.persistedStatus}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.latestRunStatus ?? "No run"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.actionRequired ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.scheduleStatus ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(row.dueAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
