import type { UiDocument } from "@chrona/ui-protocol";
import type { WorkspaceActivityItem } from "../../task-workspace";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { createTaskWorkspaceExecutionConsoleView } from "../../task-workspace";
import { TaskWorkspaceActionRail } from "./action-rail";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
  type CommandCenterPrimaryAction,
} from "./task-workspace-execution-overview";

type ConsoleView = ReturnType<typeof createTaskWorkspaceExecutionConsoleView>;
type WorkspaceCopy = Record<string, string | undefined>;

/** Right-rail inspector. Node clicks no longer open a node-detail overlay; the rail stays on task-level controls and activity. */
export function TaskWorkspaceInspector({
  taskId,
  consoleView,
  primaryAction,
  commandCenter,
  commandCenterActionHandlers,
  runtimeEvents,
  liveActivity,
  commandCenterCopy,
  copy,
  onAction,
  isPlanCompact = false,
}: {
  taskId: string;
  consoleView: ConsoleView;
  primaryAction: CommandCenterPrimaryAction;
  commandCenter: { documents: { now: UiDocument; output: UiDocument; trail: UiDocument } } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  runtimeEvents: WorkspaceRuntimeEvent[];
  liveActivity: WorkspaceActivityItem[];
  commandCenterCopy?: Partial<CommandCenterCopy>;
  copy: WorkspaceCopy;
  isPlanCompact?: boolean;
  onAction: (nodeId?: string) => void;
}) {
  return (
    <aside
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60"
      aria-label={copy.commandCenterAria ?? "Task command center"}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/50 bg-muted/25 px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            {copy.commandCenter ?? "Task Execution"}
          </p>
          {consoleView.progress.totalSteps > 0 ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {consoleView.progress.completedSteps}/{consoleView.progress.totalSteps} steps
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <TaskWorkspaceActionRail
          taskId={taskId}
          serverNowSpec={commandCenter?.documents.now ?? null}
          primaryAction={primaryAction}
          readiness={consoleView.readiness}
          attention={consoleView.attention}
          runtimeEvents={runtimeEvents}
          commandCenterActionHandlers={commandCenterActionHandlers}
          copy={copy}
        />
        <TaskWorkspaceExecutionOverview
          taskId={taskId}
          progress={consoleView.progress}
          readiness={consoleView.readiness}
          latestResult={consoleView.latestResult}
          attention={consoleView.attention}
          latestCompletedNode={consoleView.latestCompletedNode}
          artifacts={consoleView.artifacts}
          activity={consoleView.activity}
          commandCenterActionHandlers={commandCenterActionHandlers}
          commandCenter={commandCenter}
          runtimeEvents={runtimeEvents}
          liveActivity={liveActivity}
          primaryAction={primaryAction}
          copy={commandCenterCopy}
          activityLayout={isPlanCompact ? "side" : "below"}
          onAction={onAction}
        />
      </div>
    </aside>
  );
}
