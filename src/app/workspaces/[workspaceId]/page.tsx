import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";
import { getWorkspaceOverview } from "@/modules/queries/get-workspace-overview";

export default async function WorkspacePage(props: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await props.params;
  const data = await getWorkspaceOverview(workspaceId);

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workspace Overview</h1>
          <p className="text-sm text-muted-foreground">
            Triage runs, approvals, and schedule risks before diving into execution detail.
          </p>
        </div>
        <WorkspaceOverview data={data} />
      </div>
    </ControlPlaneShell>
  );
}
