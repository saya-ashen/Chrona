import { Calendar, LayoutList, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type PlanningDayLink = {
  label: string;
  href: string;
  current?: boolean;
};

type ScheduleCockpitMetric = {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "info" | "critical";
};

export function PlanningHeader({
  ariaLabel,
  title,
  activeDayLabel,
  summary,
  dayLinks,
  metrics,
  actions: _actions,
  activeView,
  timelineHref,
  listHref,
  timelineLabel,
  listLabel,
  onNavigate,
}: {
  ariaLabel: string;
  title: string;
  activeDayLabel: string;
  summary: string;
  dateSwitcherLabel: string;
  dayLinks: PlanningDayLink[];
  metrics: ScheduleCockpitMetric[];
  actions: { label: string; href?: string; onClick?: () => void; description?: string; disabled?: boolean }[];
  activeView: "timeline" | "list";
  timelineHref: string;
  listHref: string;
  timelineLabel: string;
  listLabel: string;
  onNewTask?: () => void;
  newTaskLabel?: string;
  onNavigate?: (href: string) => void;
}) {
  void _actions;
  // Only show queue + risk metrics (first two)
  const keyMetrics = metrics.slice(0, 2);

  return (
    <header
      aria-label={ariaLabel}
      className="flex items-center gap-4 rounded-3xl border border-border/60 bg-white/92 px-5 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
    >
      {/* Title + Date */}
      <div className="flex min-w-[15rem] items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-muted-foreground" />
          <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
        <span className="text-sm text-muted-foreground">
          {activeDayLabel}
        </span>
      </div>

      {/* Day switcher */}
      <div className="flex gap-0.5 rounded-xl border border-border/55 bg-background/75 p-0.5">
        {dayLinks.map((link) => (
          <button
            key={link.label}
            type="button"
            onClick={() => onNavigate?.(link.href)}
            aria-current={link.current ? "date" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              link.current
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex gap-0.5 rounded-xl border border-border/55 bg-background/75 p-0.5">
        <button
          type="button"
          onClick={() => onNavigate?.(timelineHref)}
          aria-current={activeView === "timeline" ? "page" : undefined}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            activeView === "timeline"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="size-3" />
          {timelineLabel}
        </button>
        <button
          type="button"
          onClick={() => onNavigate?.(listHref)}
          aria-current={activeView === "list" ? "page" : undefined}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            activeView === "list"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <LayoutList className="size-3" />
          {listLabel}
        </button>
      </div>

      <div className="hidden min-w-[13rem] flex-1 lg:block">
        <p className="truncate rounded-xl border border-border/50 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground">
          {summary}
        </p>
      </div>

      {/* Key metrics — compact pills */}
      <div className="flex items-center gap-1.5">
        {keyMetrics.map((m) => (
          <div
            key={m.label}
            title={m.hint}
            className="flex items-center gap-1 rounded-full border border-border/50 bg-background/80 px-2 py-0.5"
          >
            <span className="text-[10px] text-muted-foreground">{m.label}</span>
            <span
              className={cn(
                "text-xs font-semibold",
                m.tone === "critical" ? "text-rose-600" : m.tone === "info" ? "text-primary" : "text-foreground",
              )}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}

