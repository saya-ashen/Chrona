import { useEffect, useState, type ReactNode } from "react";
import type { UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts";
import type { WorkspaceActivityItem, createTaskWorkspaceExecutionConsoleView } from "@features/task-workspace/public/workspace-integration";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
} from "./task-workspace-execution-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";

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
  onRetryFinalization,
  isRetryingFinalization = false,
  finalizationRetryError,
  commandCenterCopy,
  copy,
  operationPanel,
  onAction,
  isPlanCompact: _isPlanCompact = false,
  isExecutionRunning = false,
  executionResultState = "waiting",
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
  onRetryFinalization?: () => Promise<void> | void;
  isRetryingFinalization?: boolean;
  finalizationRetryError?: string | null;
  commandCenterCopy?: Partial<CommandCenterCopy>;
  copy: WorkspaceCopy;
  isPlanCompact?: boolean;
  isExecutionRunning?: boolean;
  executionResultState?: "waiting" | "available";
  operationPanel?: ReactNode;
  operationPlacement?: "before" | "after";
  showHeader?: boolean;
  onAction: (nodeId?: string) => void;
}) {
  const hasCheckpointForm = currentExecution?.status === "waiting_for_user" && Boolean(operationPanel);
  const [activePanel, setActivePanel] = useState<"input" | "results">("input");
  useEffect(() => {
    if (hasCheckpointForm) setActivePanel("input");
  }, [currentExecution?.checkpoint?.id, hasCheckpointForm]);

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
      <div className={showHeader ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4" : "flex min-h-0 flex-col gap-4"}>
        {showHeader && hasCheckpointForm ? (
          <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as "input" | "results")} className="min-h-0">
            <TabsList className="sticky top-0 z-10 grid w-full grid-cols-2 bg-background/95 shadow-sm backdrop-blur">
              <TabsTrigger value="input">{copy.provideInput ?? "Provide input"}</TabsTrigger>
              <TabsTrigger value="results">{commandCenterCopy?.outputTab ?? "Results"}</TabsTrigger>
            </TabsList>
            <TabsContent value="input" className="mt-3 min-h-0">
              {operationPanel}
            </TabsContent>
            <TabsContent value="results" className="mt-3 min-h-0">
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
                onRetryFinalization={onRetryFinalization}
                isRetryingFinalization={isRetryingFinalization}
                finalizationRetryError={finalizationRetryError}
                isExecutionRunning={isExecutionRunning}
                executionResultState={executionResultState}
                primaryAction={null}
                copy={commandCenterCopy}
                activityLayout="side"
                onAction={onAction}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <>
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
              onRetryFinalization={onRetryFinalization}
              isRetryingFinalization={isRetryingFinalization}
              finalizationRetryError={finalizationRetryError}
              isExecutionRunning={isExecutionRunning}
              executionResultState={executionResultState}
              primaryAction={null}
              copy={commandCenterCopy}
              activityLayout="side"
              onAction={onAction}
            />
            {operationPlacement === "after" ? operationPanel : null}
          </>
        )}
      </div>
    </aside>
  );
}
