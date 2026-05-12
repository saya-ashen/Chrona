import { SurfaceCard } from "@/components/ui/surface-card";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "./task-workspace-types";

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
  return (
    <aside
      aria-label="Execution overview"
      className="min-w-0 space-y-3 xl:flex xl:min-h-0 xl:flex-col xl:self-stretch xl:overflow-y-auto"
    >
      <OverviewCard card={readiness} onAction={onAction} />
      <OverviewCard card={latestResult} onAction={onAction} />
      <OverviewCard
        card={attention ?? {
          id: "attention-empty",
          title: "Needs handling",
          description: "No approval, input, or blocker needs attention.",
          tone: "success",
        }}
        onAction={onAction}
      />
      <ArtifactsCard artifacts={artifacts} onAction={onAction} />
      <ActivityCard activity={activity} />
    </aside>
  );
}

function OverviewCard({ card, onAction }: { card: ExecutionOverviewCard; onAction?: OverviewAction }) {
  return (
    <SurfaceCard variant="inset" padding="sm" className="rounded-[1.35rem] border-border/50 bg-background/70 shadow-none">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.title}</p>
          {card.statusLabel ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{card.statusLabel}</span> : null}
        </div>
        <p className={card.tone === "critical" ? "text-sm text-destructive" : "text-sm text-foreground"}>{card.description}</p>
        {card.actionLabel && onAction ? (
          <button
            type="button"
            className="rounded-xl border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onAction(card.actionNodeId)}
          >
            {card.actionLabel}
          </button>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

function ArtifactsCard({ artifacts, onAction }: { artifacts: WorkspaceArtifactItem[]; onAction?: OverviewAction }) {
  return (
    <SurfaceCard variant="inset" padding="sm" className="rounded-[1.35rem] border-border/50 bg-background/70 shadow-none">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Artifacts</p>
        {artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No artifacts yet.</p>
        ) : (
          <div className="space-y-2">
            {artifacts.slice(0, 5).map((artifact) => (
              <div key={artifact.id} className="rounded-xl border border-border/50 bg-background/60 px-3 py-2">
                <p className="text-sm font-medium text-foreground">{artifact.title}</p>
                <p className="text-xs text-muted-foreground">{artifact.type}</p>
                {artifact.sourceNodeId && onAction ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onAction(artifact.sourceNodeId)}
                  >
                    Review source node
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}

function ActivityCard({ activity }: { activity: WorkspaceActivityItem[] }) {
  return (
    <SurfaceCard variant="inset" padding="sm" className="rounded-[1.35rem] border-border/50 bg-background/70 shadow-none">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Execution activity</p>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Activity will appear after planning or execution starts.</p>
        ) : (
          <div className="space-y-2">
            {activity.slice(0, 6).map((item) => (
              <div key={item.id} className="flex gap-2 rounded-xl bg-muted/35 px-3 py-2">
                <span className="mt-1 size-2 rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}
