import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type PlanningMetric = {
  label: string;
  value: number;
  tone?: "neutral" | "info" | "critical";
};

type PlanningDayLink = {
  label: string;
  href: string;
  current?: boolean;
};

export function PlanningHeader({
  ariaLabel,
  title,
  activeDayLabel,
  dateSwitcherLabel,
  dayLinks,
  metrics,
  activeView,
  timelineHref,
  listHref,
  timelineLabel,
  listLabel,
}: {
  ariaLabel: string;
  title: string;
  activeDayLabel: string;
  dateSwitcherLabel: string;
  dayLinks: PlanningDayLink[];
  metrics: PlanningMetric[];
  activeView: "timeline" | "list";
  timelineHref: string;
  listHref: string;
  timelineLabel: string;
  listLabel: string;
}) {
  return (
    <SurfaceCard as="section" variant="highlight" aria-label={ariaLabel} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{activeDayLabel}</p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{dateSwitcherLabel}</span>
            <div className="flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-background/70 p-1">
              {dayLinks.map((dayLink) => (
                <LocalizedLink
                  key={dayLink.label}
                  href={dayLink.href}
                  aria-current={dayLink.current ? "date" : undefined}
                  className={buttonVariants({ variant: dayLink.current ? "default" : "ghost", size: "sm" })}
                >
                  {dayLink.label}
                </LocalizedLink>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-background/70 p-1">
            <LocalizedLink
              href={timelineHref}
              aria-current={activeView === "timeline" ? "page" : undefined}
              className={buttonVariants({ variant: activeView === "timeline" ? "default" : "ghost", size: "sm" })}
            >
              {timelineLabel}
            </LocalizedLink>
            <LocalizedLink
              href={listHref}
              aria-current={activeView === "list" ? "page" : undefined}
              className={buttonVariants({ variant: activeView === "list" ? "default" : "ghost", size: "sm" })}
            >
              {listLabel}
            </LocalizedLink>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {metrics.map((metric) => (
          <StatusBadge
            key={metric.label}
            tone={metric.tone}
            className={cn("px-3 py-1.5 text-xs", metric.tone === undefined && "border-border/70 bg-background text-muted-foreground")}
          >
            {metric.label}: {metric.value}
          </StatusBadge>
        ))}
      </div>
    </SurfaceCard>
  );
}
