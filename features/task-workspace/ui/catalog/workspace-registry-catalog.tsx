import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocale } from "@chrona/i18n";
import { Button, Calendar, Popover, PopoverContent, PopoverTrigger } from "@shared/ui";

export type OccurrenceOption = {
  value: string;
  label: string;
  taskId: string;
  date: string | null;
  workBlockId: string | null;
};

export function isOccurrenceOption(value: unknown): value is OccurrenceOption {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { value?: unknown }).value === "string" &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { taskId?: unknown }).taskId === "string" &&
    (typeof (value as { date?: unknown }).date === "string" ||
      (value as { date?: unknown }).date === null) &&
    (typeof (value as { workBlockId?: unknown }).workBlockId === "string" ||
      (value as { workBlockId?: unknown }).workBlockId === null)
  );
}

function dateFromKey(date: string) {
  return new Date(`${date}T12:00:00`);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function WorkspaceOccurrenceCalendar({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: OccurrenceOption[];
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const navigate = useNavigate();
  const current =
    options.find((option) => option.value === value) ?? options[0];
  const availableDates = new Set(
    options.flatMap((option) => (option.date ? [option.date] : [])),
  );
  const selectedDate = current.date ? dateFromKey(current.date) : undefined;

  const navigateTo = (occurrence: OccurrenceOption) => {
    const search = occurrence.workBlockId
      ? `?workBlockId=${encodeURIComponent(occurrence.workBlockId)}`
      : "";
    void navigate({
      pathname: `/${locale}/tasks/${occurrence.taskId}`,
      search,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-[20rem] rounded-full bg-background/80 px-2.5 text-xs font-medium"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate">{current.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          disabled={(date) => !availableDates.has(dateKey(date))}
          modifiers={{
            occurrence: (date) => availableDates.has(dateKey(date)),
          }}
          modifiersClassNames={{ occurrence: "font-semibold text-primary" }}
          onSelect={(date) => {
            if (!date) return;
            const matches = options.filter(
              (option) => option.date === dateKey(date),
            );
            if (matches.length === 1) navigateTo(matches[0]);
          }}
        />
        <div className="max-h-40 space-y-1 overflow-y-auto border-t border-border/70 p-2">
          {options
            .filter(
              (option) =>
                option.date ===
                (selectedDate ? dateKey(selectedDate) : current.date),
            )
            .map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={option.value === value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-full justify-start rounded-md px-2 text-xs"
                onClick={() => navigateTo(option)}
              >
                {option.label}
              </Button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { ResultCollapseProvider } from "./workspace-collapse";
