import { CalendarDays, Ellipsis } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "@/components/ui/badge";

type WorkPageHeaderCardProps = {
  title: string;
  executionStatus: string;
  executionTone: "secondary" | "destructive" | "outline";
  syncLabel: string;
  isStale: boolean;
  description: string;
  taskId: string;
};

export function WorkPageHeaderCard({
  title,
  executionStatus,
  executionTone,
  syncLabel,
  isStale,
  description,
  taskId,
}: WorkPageHeaderCardProps) {
  return (
    <section className="shrink-0 overflow-hidden rounded-[22px] border border-border/70 bg-card shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{title} / Work</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-[1.35rem]">{title}</h1>
              <Badge variant={executionTone}>{executionStatus}</Badge>
              <Badge variant={isStale ? "secondary" : "secondary"}>{syncLabel}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocalizedLink
              href="/schedule"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
            >
              <CalendarDays className="size-4" />
              Schedule
            </LocalizedLink>
            <LocalizedLink
              href={`/tasks/${taskId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
            >
              Details
            </LocalizedLink>
            <button className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground hover:bg-muted/40">
              <Ellipsis className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
