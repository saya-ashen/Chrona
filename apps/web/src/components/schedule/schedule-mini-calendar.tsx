import { LocalizedLink } from "@/components/i18n/localized-link";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
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

  return (
    <Card className="rounded-[30px]">
      <div className="mx-auto w-fit">
        <div className="px-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Calendar
          </p>
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          showOutsideDays
          fixedWeeks
          className="mt-2 p-0 [--cell-size:--spacing(9)]"
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

  return (
    <LocalizedLink
      href={calendarDay?.href ?? `/schedule?day=${encodeURIComponent(dayKey)}`}
      aria-current={modifiers.selected ? "date" : undefined}
      aria-label={calendarDay?.label ?? day.date.toDateString()}
      className={cn(
        "flex aspect-square size-auto min-w-(--cell-size) flex-col items-center justify-center gap-1 rounded-(--cell-radius) text-sm leading-none font-normal transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        modifiers.selected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        modifiers.today && !modifiers.selected && "bg-muted text-foreground",
        modifiers.outside && "text-muted-foreground opacity-50",
        className,
      )}
    >
      <span>{day.date.getDate()}</span>
      {calendarDay?.riskCount ? (
        <span className="size-1.5 rounded-full bg-destructive" />
      ) : calendarDay?.scheduledCount ? (
        <span className="size-1.5 rounded-full bg-primary/70 group-data-[selected=true]/day:bg-primary-foreground/80" />
      ) : null}
    </LocalizedLink>
  );
}

function formatCalendarDayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
