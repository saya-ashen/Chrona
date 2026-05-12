import type { ReactNode } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import type { TaskExecutionDispatchResult } from "./task-workspace-query";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";
import { TaskWorkspaceNavigation } from "./task-workspace-navigation";
import { TaskWorkspaceNodeDetailPanel } from "./task-workspace-node-detail-panel";
import type { TaskWorkspaceExecutionConsoleView } from "./task-workspace-types";

export function TaskWorkspaceExecutionConsole({
  topContent,
  graphContent,
  consoleView,
  selectedPlanNodes,
  graphPlan,
  onFocusNodeActions,
  onDispatchExecutionAction,
}: {
  topContent: ReactNode;
  graphContent: ReactNode;
  consoleView: TaskWorkspaceExecutionConsoleView;
  selectedPlanNodes: PlanNodeDataModel[];
  graphPlan: TaskPlanGraphPlan | null;
  onFocusNodeActions: (nodeId?: string) => void;
  onDispatchExecutionAction: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
}) {
  return (
    <div className="h-full min-h-0 space-y-3 overflow-visible rounded-[1.75rem] border border-border/40 bg-[linear-gradient(180deg,hsl(var(--muted)/0.18),transparent_20%),hsl(var(--background))] p-2.5 xl:grid xl:grid-cols-[220px_minmax(0,1fr)_360px] xl:gap-3 xl:overflow-hidden">
      <TaskWorkspaceNavigation notificationCount={consoleView.attention ? 1 : 0} />
      <main aria-label="Task execution console" className="space-y-3 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:gap-3 xl:space-y-0 xl:overflow-hidden">
        <div className="relative xl:shrink-0">{topContent}</div>
        {graphPlan ? graphContent : (
          <div className="flex min-h-[520px] flex-1 items-center justify-center rounded-[1.1rem] border border-dashed border-border/60 bg-background/40 px-6 text-center text-sm text-muted-foreground">
            The plan graph will appear here once AI generates a plan.
          </div>
        )}
        <TaskWorkspaceNodeDetailPanel
          detail={consoleView.nodeDetail}
          selectedNodes={selectedPlanNodes}
          onDispatchExecutionAction={onDispatchExecutionAction}
        />
      </main>
      <TaskWorkspaceExecutionOverview
        readiness={consoleView.readiness}
        latestResult={consoleView.latestResult}
        attention={consoleView.attention}
        artifacts={consoleView.artifacts}
        activity={consoleView.activity}
        onAction={onFocusNodeActions}
      />
    </div>
  );
}
