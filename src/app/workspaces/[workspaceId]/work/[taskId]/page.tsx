import { redirect } from "next/navigation";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkPageClient } from "@/components/work/work-page-client";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localizeHref } from "@/i18n/routing";
import { getWorkPage } from "@/modules/queries/get-work-page";

export default async function WorkPage(props: {
  params: Promise<{ workspaceId: string; taskId: string; lang?: string }>;
}) {
  const { workspaceId, taskId, lang } = await props.params;
  const locale = resolveLocale(lang);
  const dictionary = await getDictionary(locale);
  const data = await getWorkPage(taskId, dictionary.queries?.workPage);

  if (data.taskShell.workspaceId !== workspaceId) {
    redirect(localizeHref(locale, `/workspaces/${data.taskShell.workspaceId}/work/${taskId}`));
  }

  return (
    <ControlPlaneShell>
      <WorkPageClient initialData={data} />
    </ControlPlaneShell>
  );
}
