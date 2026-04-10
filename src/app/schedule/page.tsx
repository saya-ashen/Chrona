import { ControlPlaneShell } from "@/components/control-plane-shell";
import { SchedulePage } from "@/components/schedule/schedule-page";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

type ScheduleRoutePageProps = {
  searchParams?: Promise<{
    day?: string;
    task?: string;
    view?: string;
  }>;
};

export default async function ScheduleRoutePage({ searchParams }: ScheduleRoutePageProps) {
  const workspace = await getDefaultWorkspace();
  const data = await getSchedulePage(workspace.id);
  const params = searchParams ? await searchParams : undefined;

  return (
    <ControlPlaneShell>
      <SchedulePage
        workspaceId={workspace.id}
        data={data}
        selectedDay={params?.day}
        selectedTaskId={params?.task}
        selectedView={params?.view}
      />
    </ControlPlaneShell>
  );
}
