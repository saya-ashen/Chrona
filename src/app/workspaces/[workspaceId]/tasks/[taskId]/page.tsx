import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskPage } from "@/components/tasks/task-page";
import { getTaskPage } from "@/modules/queries/get-task-page";
import { notFound, redirect } from "next/navigation";
import { startRun } from "@/app/actions/task-actions";

export default async function TaskDetailPage(props: {
  params: Promise<{ workspaceId: string; taskId: string }>;
}) {
  const { workspaceId, taskId } = await props.params;
  const data = await getTaskPage(taskId);

  if (data.task.workspaceId !== workspaceId) {
    notFound();
  }

  return (
    <ControlPlaneShell>
      <TaskPage
        data={data}
        startRunAction={async (formData) => {
          "use server";

          const prompt = String(formData.get("prompt") ?? "").trim();

          if (!prompt) {
            throw new Error("prompt is required");
          }

          await startRun({ taskId, prompt });
          redirect(`/workspaces/${workspaceId}/work/${taskId}`);
        }}
      />
    </ControlPlaneShell>
  );
}
