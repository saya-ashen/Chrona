import { LocalizedLink } from "@/components/i18n/localized-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

type ScheduleMiniCalendarDay = {
  key: string;
  label: string;
  shortLabel: string;
  dateNumber: string;
  href: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  scheduledCount: number;
  riskCount: number;
};

export function ScheduleMiniCalendar({
  monthLabel,
  days,
}: {
  monthLabel: string;
  days: ScheduleMiniCalendarDay[];
}) {
  return (
    <SurfaceCard as="section" variant="default" padding="sm" className="space-y-4 rounded-[30px]">
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Calendar
          </p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{monthLabel}</h2>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <span key={label} className="py-1">
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => (
          <LocalizedLink
            key={day.key}
            href={day.href}
            aria-current={day.isSelected ? "date" : undefined}
            aria-label={day.label}
            className={cn(
              "group flex aspect-square min-h-10 flex-col items-center justify-center rounded-2xl border text-xs transition-all duration-150",
              day.isSelected
                ? "border-primary/30 bg-primary/12 text-primary shadow-[0_6px_18px_rgba(79,70,229,0.2)]"
                : day.isToday
                  ? "border-border/80 bg-background text-foreground ring-2 ring-primary/20"
                  : "border-transparent bg-transparent text-foreground hover:-translate-y-0.5 hover:border-border/70 hover:bg-background/90",
              !day.isCurrentMonth && "text-muted-foreground/40",
            )}
          >
            <span className="text-sm font-medium">{day.dateNumber}</span>
            {day.riskCount > 0 ? (
              <span className="mt-1 size-1.5 rounded-full bg-red-500" />
            ) : day.scheduledCount > 0 ? (
              <span className="mt-1 size-1.5 rounded-full bg-primary/70" />
            ) : null}
          </LocalizedLink>
        ))}
      </div>
    </SurfaceCard>
  );
}

export function CompactTodayFocus({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: Array<{ taskId: string; title: string; reason: string; tone?: "neutral" | "info" | "warning" | "critical" | "success" }>;
  emptyMessage: string;
}) {
  return (
    <SurfaceCard as="section" variant="inset" padding="sm" className="space-y-3 rounded-[28px]">
      <div className="px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Focus
        </p>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{title}</h2>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-3 text-xs leading-5 text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 4).map((item) => (
            <div
              key={item.taskId}
              className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <StatusBadge tone={item.tone}>{item.reason}</StatusBadge>
                <p className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
