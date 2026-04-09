import Link from "next/link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function AdvancedSettingsPage() {
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Advanced Settings</h1>
          <p className="text-sm text-muted-foreground">
            Internal controls that stay available without becoming the default workflow.
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Workspace management</h2>
              <p className="text-sm text-muted-foreground">
                The product now defaults into a single-workspace UX. Use workspace management only for advanced or internal operations.
              </p>
            </div>
            <Link
              href="/workspaces"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              Open Workspaces
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="rounded-xl border bg-muted/20 p-4">
                <p className="font-medium text-foreground">{workspace.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workspace._count.tasks} task{workspace._count.tasks === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ControlPlaneShell>
  );
}
