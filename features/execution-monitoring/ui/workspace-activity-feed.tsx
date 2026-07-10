import { useState } from "react";
import { CalendarClock, Radio } from "lucide-react";
import { Button } from "../../../apps/web/src/components/ui/button";
import { taskWorkspaceActivityMessages } from "../../../apps/web/src/lib/i18n/messages";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../../task-workspace";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { WorkspaceActivityItem } from "../../task-workspace";
import { ActivityTimeline } from "./activity-timeline";
type ActivityLayer = "Progress" | "Decisions" | "Results" | "Tools" | "Diagnostics";

function activityLayer(item: WorkspaceActivityItem): ActivityLayer {
  if (item.kind === "approval") return "Decisions";
  if (item.kind === "artifact") return "Results";
  if (item.kind === "tool_started" || item.kind === "tool_completed") return "Tools";
  if (item.kind === "raw" || item.kind === "reasoning") return "Diagnostics";
  return "Progress";
}

function isGroupedDiagnostic(item: WorkspaceActivityItem) {
  return item.activityGroup?.kind === "plan_generation"
    || item.activityGroup?.kind === "provider_run"
    || item.rawEventType?.startsWith("plan_generation.") === true;
}


function ActivityFeedHeader({
  title,
  shownCount,
  liveCount,
  savedCount,
  provider,
}: {
  title: string;
  shownCount: number;
  liveCount: number;
  savedCount: number;
  provider?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <CalendarClock className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{taskWorkspaceActivityMessages.feedStats({ shown: shownCount, live: liveCount, saved: savedCount })}</p>
          </div>
        </div>
      </div>
      {provider ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
          <Radio className="size-3" />
          {provider}
        </span>
      ) : null}
    </div>
  );
}

function ActivityEmptyState({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-4 text-center">
      <p className="text-sm font-medium text-foreground">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">{taskWorkspaceActivityMessages.emptyHint}</p>
    </div>
  );
}

function LoadOlderActivityButton({
  visible,
  loading,
  onClick,
}: {
  visible: boolean;
  loading: boolean;
  onClick?: () => void;
}) {
  if (!visible || !onClick) return null;

  return (
    <Button type="button" variant="outline" size="sm" className="mt-3 w-full rounded-full text-xs" disabled={loading} onClick={onClick}>
      {loading ? taskWorkspaceActivityMessages.loadingOlder : taskWorkspaceActivityMessages.loadOlder}
    </Button>
  );
}

export function WorkspaceActivityFeed({
  activity,
  runtimeEvents = [],
  title = taskWorkspaceActivityMessages.taskTitle,
  emptyMessage = taskWorkspaceActivityMessages.taskEmpty,
  limit = 30,
  hasOlderActivity = false,
  isLoadingOlder = false,
  onLoadOlder,
  density = "detailed",
  active = false,
}: {
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  title?: string;
  emptyMessage?: string;
  limit?: number;
  hasOlderActivity?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
  density?: "compact" | "detailed" | "rail";
  active?: boolean;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const items = mergeWorkspaceActivity([...runtimeEventsToWorkspaceActivity(runtimeEvents, limit), ...activity], limit);
  const primaryItems = items.filter((item) => activityLayer(item) !== "Diagnostics" || isGroupedDiagnostic(item));
  const diagnosticItems = items.filter((item) => activityLayer(item) === "Diagnostics" && !isGroupedDiagnostic(item));
  const latestProvider = runtimeEvents.at(-1)?.provider;
  const liveCount = runtimeEvents.length;
  const persistedCount = activity.length;

  return (
    <section>
      <ActivityFeedHeader title={title} shownCount={primaryItems.length} liveCount={liveCount} savedCount={persistedCount} provider={latestProvider} />
      {primaryItems.length === 0 ? (
        <ActivityEmptyState message={emptyMessage} />
      ) : (
        <div className={density === "rail" ? "mt-4" : "mt-4 pl-1"}>
          <ActivityTimeline items={primaryItems} density={density} active={active} />
        </div>
      )}
      {diagnosticItems.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
          <button type="button" className="cursor-pointer text-xs font-medium text-muted-foreground" aria-expanded={showDiagnostics} onClick={() => setShowDiagnostics((value) => !value)}>Diagnostics ({diagnosticItems.length})</button>
          {showDiagnostics ? <div className="mt-3"><ActivityTimeline items={diagnosticItems} density="compact" active={false} /></div> : null}
        </div>
      ) : null}
      <LoadOlderActivityButton visible={hasOlderActivity} loading={isLoadingOlder} onClick={onLoadOlder} />
    </section>
  );
}
