import Link from "next/link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskCenterTable } from "@/components/tasks/task-center-table";
import { getTaskCenter } from "@/modules/queries/get-task-center";

const FILTERS = ["Running", "WaitingForApproval", "Blocked", "Failed"] as const;

export default async function TasksPage(props: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const activeFilter = FILTERS.includes(searchParams.status as (typeof FILTERS)[number])
    ? (searchParams.status as (typeof FILTERS)[number])
    : undefined;
  const rows = await getTaskCenter(activeFilter);

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Task Center</h1>
          <p className="text-sm text-muted-foreground">
            Focus on running, blocked, approval-waiting, and failed work without reading full transcripts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/tasks"
            className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            All
          </Link>
          {FILTERS.map((filter) => {
            const isActive = activeFilter === filter;

            return (
              <Link
                key={filter}
                href={`/tasks?status=${filter}`}
                className={isActive
                  ? "rounded-full border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground"
                  : "rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"}
              >
                {filter}
              </Link>
            );
          })}
        </div>
        <TaskCenterTable rows={rows} />
      </div>
    </ControlPlaneShell>
  );
}
