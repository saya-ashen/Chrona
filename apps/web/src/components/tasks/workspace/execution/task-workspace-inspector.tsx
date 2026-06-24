import type { UiDocument } from "@chrona/ui-protocol";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
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
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-border/60 bg-background/45 p-1 shadow-sm"
      aria-label={copy.commandCenterAria ?? "Task command center"}
    >
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
    </aside>
  );
}
