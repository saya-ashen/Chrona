import { ControlPlaneShell } from "@/components/control-plane-shell";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

export default async function ScheduleRoutePage() {
  const workspace = await getDefaultWorkspace();
  const data = await getSchedulePage(workspace.id);

  return (
    <ControlPlaneShell>
      <SchedulePage data={data} />
    </ControlPlaneShell>
  );
}
