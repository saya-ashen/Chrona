import { ControlPlaneShell } from "@/components/control-plane-shell";
import { WorkspaceOverview } from "@/components/workspaces/workspace-overview";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getWorkspaceOverview } from "@/modules/queries/get-workspace-overview";

export default async function WorkspacePage(props: {
  params: Promise<{ workspaceId: string; lang?: string }>;
}) {
  const { workspaceId, lang } = await props.params;
  const locale = resolveLocale(lang);
  const t = (await getDictionary(locale)).pages.workspaceOverview;
  const data = await getWorkspaceOverview(workspaceId);

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <WorkspaceOverview data={data} />
      </div>
    </ControlPlaneShell>
  );
}
