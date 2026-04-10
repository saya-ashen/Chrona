import { ControlPlaneShell } from "@/components/control-plane-shell";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function AdvancedSettingsPage(props: { params?: Promise<{ lang?: string }> }) {
  const locale = resolveLocale((await props.params)?.lang);
  const t = (await getDictionary(locale)).pages.advancedSettings;
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>

        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">{t.workspaceManagementTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.workspaceManagementDescription}</p>
            </div>
            <LocalizedLink
              href="/workspaces"
              className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              {t.openWorkspaces}
            </LocalizedLink>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="rounded-xl border bg-muted/20 p-4">
                <p className="font-medium text-foreground">{workspace.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workspace._count.tasks} {workspace._count.tasks === 1 ? t.taskCountOne : t.taskCountOther}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ControlPlaneShell>
  );
}
