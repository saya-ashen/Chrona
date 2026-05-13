import { Bell, Boxes, CheckSquare, Database, Home, Plug, Settings, Wrench } from "lucide-react";
import type { WorkspaceNavigationView } from "../model/task-workspace-types";

const sectionIcons: Record<string, typeof Home> = {
  overview: Home,
  tasks: CheckSquare,
  plans: Boxes,
  knowledge: Database,
  tools: Wrench,
  integrations: Plug,
};

export function TaskWorkspaceNavigation({ navigation }: { navigation: WorkspaceNavigationView }) {
  return (
    <nav aria-label="Task workspace navigation" className="min-w-0 rounded-[1rem] border border-border/40 bg-background/70 p-2 shadow-none xl:min-h-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">{navigation.brandName}</p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Task console</p>
        </div>
        <button type="button" aria-label="Notifications" className="relative rounded-lg border border-border/50 p-1.5 text-muted-foreground hover:bg-muted">
          <Bell className="size-3.5" />
          {navigation.notificationCount > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{navigation.notificationCount}</span> : null}
        </button>
      </div>
      <p className="mb-2 truncate rounded-lg bg-muted/35 px-2 py-1.5 text-xs font-medium text-muted-foreground">{navigation.memberIdentity}</p>
      <div className="grid gap-1 sm:grid-cols-3 xl:grid-cols-1">
        {navigation.primarySections.map(({ id, label, active }) => {
          const Icon = sectionIcons[id] ?? Home;

          return (
          <button
            key={label}
            type="button"
            aria-current={active ? "page" : undefined}
            className={active
              ? "flex items-center gap-2 rounded-lg bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground"
              : "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
          );
        })}
      </div>
      {navigation.settingsAvailable ? (
        <button type="button" className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Settings className="size-3.5" />
          Settings
        </button>
      ) : null}
    </nav>
  );
}
