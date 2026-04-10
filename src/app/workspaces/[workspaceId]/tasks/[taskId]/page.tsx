import { redirect } from "next/navigation";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskPage } from "@/components/tasks/task-page";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localizeHref } from "@/i18n/routing";
import { getTaskPage } from "@/modules/queries/get-task-page";

export default async function TaskDetailPage(props: {
  params: Promise<{ workspaceId: string; taskId: string; lang?: string }>;
}) {
  const { workspaceId, taskId, lang } = await props.params;
  const locale = resolveLocale(lang);
  const dictionary = await getDictionary(locale);
  const data = await getTaskPage(taskId);

  if (data.task.workspaceId !== workspaceId) {
    redirect(localizeHref(locale, `/workspaces/${data.task.workspaceId}/tasks/${taskId}`));
  }

  return (
    <ControlPlaneShell>
      <TaskPage data={data} copy={dictionary.components.taskPage} />
    </ControlPlaneShell>
  );
}
