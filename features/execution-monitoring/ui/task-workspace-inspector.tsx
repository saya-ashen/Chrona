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
  isExecutionRunning = false,
  executionOutputState = "empty",
  operationPlacement = "before",
  showHeader = true,
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
  isExecutionRunning?: boolean;
  executionOutputState?: "empty" | "partial";
  operationPanel?: ReactNode;
  operationPlacement?: "before" | "after";
  showHeader?: boolean;
  onAction: (nodeId?: string) => void;
}) {
  return (
    <aside
      className={showHeader
        ? "relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60"
        : "relative flex min-h-0 flex-col bg-transparent"}
      aria-label={copy.commandCenterAria ?? "Task command center"}
    >
      {showHeader ? (
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              {copy.commandCenter ?? "Task execution"}
            </p>
            {consoleView.progress.totalSteps > 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {consoleView.progress.completedSteps}/{consoleView.progress.totalSteps} steps
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={showHeader ? "flex min-h-0 flex-1 flex-col gap-4 p-4" : "flex min-h-0 flex-col gap-4"}>
        {operationPlacement === "before" ? operationPanel : null}
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
          isExecutionRunning={isExecutionRunning}
          executionOutputState={executionOutputState}
          primaryAction={null}
          copy={commandCenterCopy}
          activityLayout={isPlanCompact ? "side" : "below"}
          onAction={onAction}
        />
        {operationPlacement === "after" ? operationPanel : null}
      </div>
    </aside>
  );
}
