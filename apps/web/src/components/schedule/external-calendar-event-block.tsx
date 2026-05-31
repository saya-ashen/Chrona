import type { PlanningBusyBlock } from "@chrona/domain";

import { Badge } from "@/components/ui/badge";
import { externalCalendarMessages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export function ExternalCalendarEventBlock({
  event,
  timeRange,
}: {
  event: PlanningBusyBlock;
  timeRange: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 gap-2 overflow-hidden rounded-[0.85rem] border border-dashed bg-white/92 p-2 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.72)]",
        event.overlapsScheduledTask ? "border-amber-400 bg-amber-50/95" : "border-slate-300",
      )}
      data-read-only="true"
    >
      <div
        aria-hidden="true"
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: event.sourceColor }}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="line-clamp-1 text-sm font-medium text-foreground">{event.title}</p>
          <Badge variant="outline" className="shrink-0 px-2 py-0 text-[10px]">
            {externalCalendarMessages.readOnlyLabel}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{timeRange}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate">{event.sourceName}</span>
          {event.overlapsScheduledTask ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {externalCalendarMessages.overlapsTaskLabel}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}
