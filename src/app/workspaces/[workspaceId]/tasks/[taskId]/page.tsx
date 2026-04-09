import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskPage } from "@/components/tasks/task-page";
import { getTaskPage } from "@/modules/queries/get-task-page";
import { notFound, redirect } from "next/navigation";
import { proposeSchedule, startRun, updateTask } from "@/app/actions/task-actions";

function parseOptionalDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? new Date(value) : null;
}

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
        updateTaskAction={async (formData) => {
          "use server";

          const title = String(formData.get("title") ?? "").trim();

          if (!title) {
            throw new Error("title is required");
          }

          await updateTask({
            taskId,
            title,
            description: String(formData.get("description") ?? "").trim() || null,
            priority: String(formData.get("priority") ?? "Medium") as "Low" | "Medium" | "High" | "Urgent",
            dueAt: parseOptionalDate(formData, "dueAt"),
          });
        }}
        proposeScheduleAction={async (formData) => {
          "use server";

          const summary = String(formData.get("summary") ?? "").trim();
          const dueAt = parseOptionalDate(formData, "dueAt");
          const scheduledStartAt = parseOptionalDate(formData, "scheduledStartAt");
          const scheduledEndAt = parseOptionalDate(formData, "scheduledEndAt");

          if (!summary) {
            throw new Error("summary is required");
          }

          if (!dueAt && !scheduledStartAt && !scheduledEndAt) {
            throw new Error("At least one proposed scheduling field is required.");
          }

          await proposeSchedule({
            taskId,
            source: "human",
            proposedBy: "operator",
            summary,
            dueAt,
            scheduledStartAt,
            scheduledEndAt,
          });
        }}
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
