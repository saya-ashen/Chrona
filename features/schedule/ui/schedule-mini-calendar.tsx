import { LocalizedLink } from "@/components/i18n/localized-link";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "shared/ui/card";
import { cn } from "@/lib/utils"
import { useEffect, useState, type ComponentProps } from "react";
import type { DayButton } from "react-day-picker";

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
  days,
  selectedDate,
}: {
  days: ScheduleMiniCalendarDay[];
  selectedDate: Date;
}) {
  const daysByKey = new Map(days.map((day) => [day.key, day]));
  const [month, setMonth] = useState(selectedDate);

  useEffect(() => {
    setMonth(selectedDate);
  }, [selectedDate]);

  return (
    <Card className="w-full max-w-sm overflow-hidden rounded-[30px]">
      <div className="mx-auto w-full max-w-sm">
        <div className="px-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Calendar
          </p>
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          month={month}
          onMonthChange={setMonth}
          showOutsideDays
          fixedWeeks
          className="mt-2 max-w-full p-0 [--cell-size:clamp(2rem,8vw,2.5rem)] xl:[--cell-size:clamp(1.65rem,2.1vw,2.25rem)] [&_.rdp-month]:w-full [&_.rdp-months]:w-full [&_.rdp-week]:w-full [&_.rdp-weekdays]:w-full"
          components={{
            DayButton: (props) => (
              <ScheduleMiniCalendarDayButton {...props} daysByKey={daysByKey} />
            ),
          }}
        />
      </div>
    </Card>
  );
}

function ScheduleMiniCalendarDayButton({
  day,
  modifiers,
  className,
  daysByKey,
}: ComponentProps<typeof DayButton> & {
  daysByKey: Map<string, ScheduleMiniCalendarDay>;
}) {
  const dayKey = formatCalendarDayKey(day.date);
  const calendarDay = daysByKey.get(dayKey);
  const isSelected = Boolean(calendarDay?.isSelected);
  const activityDot = getCalendarDayActivityDot(calendarDay, isSelected);

  return (
    <LocalizedLink
      href={calendarDay?.href ?? `/schedule?day=${encodeURIComponent(dayKey)}`}
      aria-current={isSelected ? "date" : undefined}
      aria-label={calendarDay?.label ?? day.date.toDateString()}
      className={cn(
        "flex aspect-square size-auto min-w-(--cell-size) flex-col items-center justify-center gap-1 rounded-(--cell-radius) text-sm leading-none font-normal transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        isSelected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        modifiers.today && !isSelected && "bg-muted text-foreground",
        modifiers.outside && "text-muted-foreground opacity-50",
        className,
      )}
    >
      <span>{day.date.getDate()}</span>
      {activityDot}
    </LocalizedLink>
  );
}

function getCalendarDayActivityDot(
  day: ScheduleMiniCalendarDay | undefined,
  isSelected: boolean,
) {
  if (!day) return null;

  if (day.riskCount) {
    return <span className="size-1.5 rounded-full bg-destructive" />;
  }

  if (day.scheduledCount) {
    return <span className={cn("size-1.5 rounded-full", isSelected ? "bg-primary-foreground/80" : "bg-primary/70")} />;
  }

  return null;
}

function formatCalendarDayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
