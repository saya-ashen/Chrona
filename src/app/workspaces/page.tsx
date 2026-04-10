import { ControlPlaneShell } from "@/components/control-plane-shell";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getWorkspaces } from "@/modules/queries/get-workspaces";

export default async function WorkspacesPage(props: { params?: Promise<{ lang?: string }> }) {
  const locale = resolveLocale((await props.params)?.lang);
  const t = (await getDictionary(locale)).pages.workspaces;
  const workspaces = await getWorkspaces();

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">{t.notice}</div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <LocalizedLink
              key={workspace.id}
              href={`/workspaces/${workspace.id}`}
              className="rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
            >
              <p className="font-medium text-foreground">{workspace.name}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {workspace._count.tasks} {workspace._count.tasks === 1 ? t.taskCountOne : t.taskCountOther}
              </p>
            </LocalizedLink>
          ))}
        </div>
      </div>
    </ControlPlaneShell>
  );
}
