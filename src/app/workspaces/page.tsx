import Link from "next/link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function WorkspacesPage() {
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Operational entry points for task triage and run supervision.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/workspaces/${workspace.id}`}
              className="rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
            >
              <p className="font-medium text-foreground">{workspace.name}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {workspace._count.tasks} task{workspace._count.tasks === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </ControlPlaneShell>
  );
}
