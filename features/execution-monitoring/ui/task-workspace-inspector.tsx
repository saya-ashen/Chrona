import type { ReactNode } from "react";
import type { UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts/ai";
import type { WorkspaceActivityItem } from "../../task-workspace";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { createTaskWorkspaceExecutionConsoleView } from "../../task-workspace";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
} from "./task-workspace-execution-overview";

type ConsoleView = ReturnType<typeof createTaskWorkspaceExecutionConsoleView>;
type WorkspaceCopy = Record<string, string | undefined>;

export function TaskWorkspaceInspector({
  taskId,
  consoleView,
  commandCenter,
  commandCenterActionHandlers,
  runtimeEvents,
  liveActivity,
  currentExecution,
  commandCenterCopy,
  copy,
  operationPanel,
  onAction,
  isPlanCompact = false,
}: {
  taskId: string;
  consoleView: ConsoleView;
  commandCenter: { documents: { now: UiDocument; output: UiDocument; trail: UiDocument } } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  runtimeEvents: WorkspaceRuntimeEvent[];
  liveActivity: WorkspaceActivityItem[];
  currentExecution?: PlanExecutionResult | null;
  commandCenterCopy?: Partial<CommandCenterCopy>;
  copy: WorkspaceCopy;
  isPlanCompact?: boolean;
  operationPanel?: ReactNode;
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
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5">
        {operationPanel}
        <TaskWorkspaceExecutionOverview
          taskId={taskId}
          progress={consoleView.progress}
          readiness={consoleView.readiness}
          latestResult={consoleView.latestResult}
          attention={consoleView.attention}
          latestCompletedNode={consoleView.latestCompletedNode}
          nodes={consoleView.graphPlan?.nodes ?? []}
          artifacts={consoleView.artifacts}
          activity={consoleView.activity}
          commandCenterActionHandlers={commandCenterActionHandlers}
          commandCenter={commandCenter}
          runtimeEvents={runtimeEvents}
          liveActivity={liveActivity}
          currentExecution={currentExecution}
          primaryAction={null}
          copy={commandCenterCopy}
          activityLayout={isPlanCompact ? "side" : "below"}
          onAction={onAction}
        />
      </div>
    </aside>
  );
}
