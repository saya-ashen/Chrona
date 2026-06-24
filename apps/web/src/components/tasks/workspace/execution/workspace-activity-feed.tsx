import { CalendarClock, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../model/task-workspace-activity";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";
import { ActivityTimeline } from "./activity-timeline";

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
}) {
  const items = mergeWorkspaceActivity([...runtimeEventsToWorkspaceActivity(runtimeEvents, limit), ...activity], limit);
  const latestProvider = runtimeEvents.at(-1)?.provider;
  const liveCount = runtimeEvents.length;
  const persistedCount = activity.length;

  return (
    <section>
      <ActivityFeedHeader title={title} shownCount={items.length} liveCount={liveCount} savedCount={persistedCount} provider={latestProvider} />
      {items.length === 0 ? (
        <ActivityEmptyState message={emptyMessage} />
      ) : (
        <div className={density === "rail" ? "mt-4" : "mt-4 pl-1"}>
          <ActivityTimeline items={items} density={density} />
        </div>
      )}
      <LoadOlderActivityButton visible={hasOlderActivity} loading={isLoadingOlder} onClick={onLoadOlder} />
    </section>
  );
}
