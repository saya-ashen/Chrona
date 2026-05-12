import { Bell, Boxes, CheckSquare, Database, Home, Plug, Settings, Wrench } from "lucide-react";

const sections = [
  { label: "Overview", icon: Home },
  { label: "Tasks", icon: CheckSquare, active: true },
  { label: "Plan library", icon: Boxes },
  { label: "Knowledge", icon: Database },
  { label: "Tools", icon: Wrench },
  { label: "Integrations", icon: Plug },
];

export function TaskWorkspaceNavigation({ notificationCount = 0 }: { notificationCount?: number }) {
  return (
    <nav aria-label="Task workspace navigation" className="min-w-0 rounded-[1.45rem] border border-border/50 bg-background/70 p-3 shadow-none xl:min-h-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">Chrona</p>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Task console</p>
        </div>
        <button type="button" aria-label="Notifications" className="relative rounded-xl border border-border/60 p-2 text-muted-foreground hover:bg-muted">
          <Bell className="size-4" />
          {notificationCount > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{notificationCount}</span> : null}
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-3 xl:grid-cols-1">
        {sections.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            aria-current={active ? "page" : undefined}
            className={active
              ? "flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              : "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
        <Settings className="size-4" />
        Settings
      </button>
    </nav>
  );
}
