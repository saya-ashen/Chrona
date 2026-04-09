import { notFound } from "next/navigation";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkPageClient } from "@/components/work/work-page-client";
import { getWorkPage } from "@/modules/queries/get-work-page";

export default async function WorkPage(props: {
  params: Promise<{ workspaceId: string; taskId: string }>;
}) {
  const { workspaceId, taskId } = await props.params;
  const data = await getWorkPage(taskId);

  if (data.taskShell.workspaceId !== workspaceId) {
    notFound();
  }

  return (
    <ControlPlaneShell>
      <WorkPageClient initialData={data} />
    </ControlPlaneShell>
  );
}
