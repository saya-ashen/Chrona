import { CheckCircle2, Clock3 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkPageSectionFrame } from "./work-page-section-frame";
import type { WorkbenchCopy } from "./work-page-types";

type WorkPageRightRailProps = {
  copy: WorkbenchCopy;
  suggestedAction: string;
  syncLabel: string;
  riskSummary: string;
  rightRailSummary: string | null;
};

export function WorkPageRightRail({
  copy,
  suggestedAction,
  syncLabel,
  riskSummary,
  rightRailSummary,
}: WorkPageRightRailProps) {
  return (
    <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 xl:flex xl:flex-col xl:gap-4 xl:space-y-0 xl:self-stretch xl:overflow-hidden">
      <WorkPageSectionFrame title="Quick Actions" bodyClassName="overflow-auto">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-6 text-muted-foreground">{suggestedAction}</p>
          <StatusBadge tone="info">OK</StatusBadge>
        </div>
      </WorkPageSectionFrame>

      <WorkPageSectionFrame title="Sync Status" bodyClassName="overflow-auto">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>{copy.syncStatusLabel}</span>
            </div>
            <span className="font-medium text-foreground">{syncLabel}</span>
          </div>
        </div>
        {riskSummary ? (
          <details className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
            <summary className="cursor-pointer list-none font-medium text-foreground">Details</summary>
            <p className="mt-2 leading-6">{riskSummary}</p>
          </details>
        ) : null}
      </WorkPageSectionFrame>

      {rightRailSummary && rightRailSummary !== copy.noBlockingAction ? (
        <section className="shrink-0 rounded-[22px] border border-amber-200/70 bg-amber-50/80 p-4 shadow-[0_14px_32px_rgba(245,158,11,0.08)]">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-white p-2 text-amber-600 shadow-sm">
              <Clock3 className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-amber-950">Heads Up</h3>
              <p className="mt-2 text-sm leading-6 text-amber-900/80">{rightRailSummary}</p>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
