import { Archive, Bell, CalendarClock, FileText, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "../model/task-workspace-types";

type OverviewAction = (nodeId?: string) => void;

export function TaskWorkspaceExecutionOverview({
  readiness,
  latestResult,
  attention,
  artifacts,
  activity,
  onAction,
}: {
  readiness: ExecutionOverviewCard;
  latestResult: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  onAction?: OverviewAction;
}) {
  const pendingAttention = attention ?? {
    id: "attention-empty",
    title: "Needs handling",
    description: "No approval, input, or blocker needs attention.",
    tone: "success" as const,
  };

  return (
    <aside aria-label="Execution overview" className="min-h-0 min-w-0 xl:overflow-y-auto">
      <SurfaceCard variant="inset" padding="none" className="rounded-[0.9rem] border-border/40 bg-background p-2 shadow-none">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Execution result overview</h2>
          </div>
        </div>
        <div className="space-y-1">
          <LatestResultCard card={latestResult} onAction={onAction} />
          <AttentionCard card={pendingAttention} readiness={readiness} onAction={onAction} />
          <ArtifactsCard artifacts={artifacts} onAction={onAction} />
          <ActivityCard activity={activity} />
        </div>
      </SurfaceCard>
    </aside>
  );
}

function cardToneClass(tone: ExecutionOverviewCard["tone"]) {
  if (tone === "critical") return "border-red-200 bg-red-50/70";
  if (tone === "warning") return "border-orange-200 bg-orange-50/70";
  if (tone === "success") return "border-emerald-100 bg-emerald-50/60";
  if (tone === "info") return "border-blue-100 bg-blue-50/60";
  return "border-border/60 bg-white";
}

function LatestResultCard({ card, onAction }: { card: ExecutionOverviewCard; onAction?: OverviewAction }) {
  return (
    <section className="rounded-lg border border-border/50 bg-white p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-3" />
          </span>
          <p className="text-sm font-semibold text-foreground">{card.title}</p>
        </div>
        {card.statusLabel ? <span className="text-xs text-muted-foreground">{card.statusLabel}</span> : null}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-foreground">{card.description}</p>
      <div className="mt-1.5 line-clamp-2 rounded-md bg-muted/35 px-2 py-1.5 text-xs leading-[1.35] text-muted-foreground">
        {card.description === "No execution result yet."
          ? "Result summary will appear here after the current node finishes."
          : card.description}
      </div>
      {card.actionLabel && onAction ? (
        <button type="button" className="mt-1.5 text-xs font-medium text-primary hover:underline" onClick={() => onAction(card.actionNodeId)}>
          View full result -&gt;
        </button>
      ) : null}
    </section>
  );
}

function AttentionCard({ card, readiness, onAction }: { card: ExecutionOverviewCard; readiness: ExecutionOverviewCard; onAction?: OverviewAction }) {
  return (
    <section className={cn("rounded-lg border p-2.5", cardToneClass(card.tone))}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className={cn("size-4", card.tone === "warning" ? "text-orange-600" : "text-emerald-600")} />
          <p className="text-sm font-semibold text-foreground">{card.title}</p>
        </div>
        {card.statusLabel ? <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-orange-700">{card.statusLabel}</span> : null}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-foreground">{card.description}</p>
      <p className="mt-1 text-xs text-muted-foreground">Readiness: {readiness.description}</p>
      {card.actionLabel && onAction ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={buttonVariants({ variant: "default", size: "sm", className: "h-7 rounded-lg px-2 text-xs" })} onClick={() => onAction(card.actionNodeId)}>
            {card.actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactsCard({ artifacts, onAction }: { artifacts: WorkspaceArtifactItem[]; onAction?: OverviewAction }) {
  return (
    <section className="rounded-lg border border-border/50 bg-white p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Artifacts ({artifacts.length})</p>
        </div>
      </div>
      {artifacts.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">No artifacts yet.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {artifacts.slice(0, 4).map((artifact) => (
            <div key={artifact.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <FileText className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{artifact.title}</p>
                <p className="text-xs text-muted-foreground">{artifact.type}</p>
              </div>
              {artifact.sourceNodeId && onAction ? (
                <button type="button" className="text-xs font-medium text-primary" onClick={() => onAction(artifact.sourceNodeId)}>
                  Source
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function dotClassName(tone: WorkspaceActivityItem["tone"]) {
  if (tone === "success") return "bg-emerald-500";
  if (tone === "warning") return "bg-orange-500";
  if (tone === "critical") return "bg-red-500";
  if (tone === "info") return "bg-blue-500";
  return "bg-slate-300";
}

function ActivityCard({ activity }: { activity: WorkspaceActivityItem[] }) {
  return (
    <section className="rounded-lg border border-border/50 bg-white p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Execution activity</p>
        </div>
      </div>
      {activity.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">Activity will appear after planning or execution starts.</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {activity.slice(0, 5).map((item) => (
            <div key={item.id} className="flex gap-2">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotClassName(item.tone))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.timestamp ? <span className="text-xs text-muted-foreground">{item.timestamp.slice(11, 16)}</span> : null}
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-[1.35] text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
