import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlanningDayLink = {
  label: string;
  href: string;
  current?: boolean;
};

type PlanningAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  description?: string;
  disabled?: boolean;
};

export type ScheduleCockpitMetric = {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "info" | "critical";
};

export function PlanningHeader({
  ariaLabel,
  title,
  activeDayLabel,
  dateSwitcherLabel,
  dayLinks,
  metrics,
  actions,
  activeView,
  timelineHref,
  listHref,
  timelineLabel,
  listLabel,
}: {
  ariaLabel: string;
  title: string;
  activeDayLabel: string;
  summary: string;
  dateSwitcherLabel: string;
  dayLinks: PlanningDayLink[];
  metrics: ScheduleCockpitMetric[];
  actions: PlanningAction[];
  activeView: "timeline" | "list";
  timelineHref: string;
  listHref: string;
  timelineLabel: string;
  listLabel: string;
}) {
  return (
    <header
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <span className="rounded-full bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
          {activeDayLabel}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {dateSwitcherLabel}
        </span>
        <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/30 p-0.5">
          {dayLinks.map((dayLink) => (
            <a
              key={dayLink.label}
              href={dayLink.href}
              aria-current={dayLink.current ? "date" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                dayLink.current
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {dayLink.label}
            </a>
          ))}
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/30 p-0.5">
        <a
          href={timelineHref}
          aria-current={activeView === "timeline" ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            activeView === "timeline"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          {timelineLabel}
        </a>
        <a
          href={listHref}
          aria-current={activeView === "list" ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            activeView === "list"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          {listLabel}
        </a>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            title={metric.hint}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1"
          >
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {metric.label}
            </span>
            <span
              className={cn(
                "text-sm font-semibold",
                metric.tone === "critical"
                  ? "text-red-600"
                  : metric.tone === "info"
                    ? "text-blue-600"
                    : "text-foreground",
              )}
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {actions.map((action, index) =>
          action.onClick ? (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.description}
              className={cn(
                buttonVariants({ variant: index === 0 ? "default" : "outline", size: "sm" }),
                "h-8 rounded-lg text-xs",
              )}
            >
              {action.label}
            </button>
          ) : action.href && !action.disabled ? (
            <a
              key={action.label}
              href={action.href}
              title={action.description}
              className={cn(
                buttonVariants({ variant: index === 0 ? "default" : "outline", size: "sm" }),
                "h-8 rounded-lg text-xs",
              )}
            >
              {action.label}
            </a>
          ) : (
            <button
              key={action.label}
              type="button"
              disabled
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-8 rounded-lg text-xs",
              )}
              title={action.description}
            >
              {action.label}
            </button>
          ),
        )}
      </div>
    </header>
  );
}
