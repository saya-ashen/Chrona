import { LocalizedLink } from "@/components/i18n/localized-link";

type WorkspaceSummary = {
  id: string;
  name: string;
  _count: {
    tasks: number;
  };
};

type AdvancedSettingsPanelProps = {
  title: string;
  subtitle: string;
  workspaceManagementTitle: string;
  workspaceManagementDescription: string;
  openWorkspaces: string;
  taskCountOne: string;
  taskCountOther: string;
  workspaces: WorkspaceSummary[];
  compact?: boolean;
};

export function AdvancedSettingsPanel({
  title,
  subtitle,
  workspaceManagementTitle,
  workspaceManagementDescription,
  openWorkspaces,
  taskCountOne,
  taskCountOther,
  workspaces,
  compact = false,
}: AdvancedSettingsPanelProps) {
  return (
    <div className={compact ? "space-y-5" : "space-y-6"}>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold tracking-tight text-foreground">{workspaceManagementTitle}</h3>
            <p className="text-sm text-muted-foreground">{workspaceManagementDescription}</p>
          </div>
          <LocalizedLink
            href="/workspaces"
            className="inline-flex rounded-xl border border-border/60 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {openWorkspaces}
          </LocalizedLink>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="font-medium text-foreground">{workspace.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {workspace._count.tasks} {workspace._count.tasks === 1 ? taskCountOne : taskCountOther}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
