import { useState } from "react";
import { CalendarDays, LayoutList, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "shared/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type PlanningDayLink = {
  label: string;
  href: string;
  kind: "previous" | "today" | "next";
  current?: boolean;
};


export function PlanningHeader({
  ariaLabel,
  title,
  activeDayLabel,
  summary,
  dayLinks,
  selectedDate,
  onSelectDate,
  primaryAction,
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
  dayLinks: PlanningDayLink[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  primaryAction: { label: string; onClick: () => void };
  activeView: "timeline" | "list";
  timelineHref: string;
  listHref: string;
  timelineLabel: string;
  listLabel: string;
  onNavigate?: (href: string) => void;
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const previousDay = dayLinks.find((link) => link.kind === "previous");
  const today = dayLinks.find((link) => link.kind === "today");
  const nextDay = dayLinks.find((link) => link.kind === "next");

  return (
    <header
      data-testid="planning-header"
      aria-label={ariaLabel}
      className="rounded-3xl border border-border/60 bg-card/95 px-4 py-4 shadow-sm lg:px-5"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              {title}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            {previousDay ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={previousDay.label}
                onClick={() => onNavigate?.(previousDay.href)}
              >
                <ChevronLeft />
              </Button>
            ) : null}
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {activeDayLabel}
            </h1>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={activeDayLabel}
                >
                  <CalendarDays aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="z-50 w-auto border bg-popover p-0 text-popover-foreground shadow-lg">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  onSelect={(date) => {
                    if (!date) return;
                    setDatePickerOpen(false);
                    onSelectDate(date);
                  }}
                />
              </PopoverContent>
            </Popover>
            {nextDay ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={nextDay.label}
                onClick={() => onNavigate?.(nextDay.href)}
              >
                <ChevronRight />
              </Button>
            ) : null}
            {today ? (
              <Button
                type="button"
                size="sm"
                variant={today.current ? "secondary" : "outline"}
                aria-current={today.current ? "date" : undefined}
                onClick={() => onNavigate?.(today.href)}
              >
                {today.label}
              </Button>
            ) : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{summary}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div
            className="grid grid-cols-2 rounded-xl border border-border/55 bg-background/75 p-0.5"
            aria-label={ariaLabel}
          >
            <Button
              type="button"
              size="sm"
              variant={activeView === "timeline" ? "secondary" : "ghost"}
              aria-current={activeView === "timeline" ? "page" : undefined}
              onClick={() => onNavigate?.(timelineHref)}
            >
              <Clock />
              {timelineLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeView === "list" ? "secondary" : "ghost"}
              aria-current={activeView === "list" ? "page" : undefined}
              onClick={() => onNavigate?.(listHref)}
            >
              <LayoutList />
              {listLabel}
            </Button>
          </div>
          <Button type="button" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        </div>
      </div>
    </header>
  );
}
