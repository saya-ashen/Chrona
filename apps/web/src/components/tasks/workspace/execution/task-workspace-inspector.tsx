import { useCallback, useEffect, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { UiDocument } from "@chrona/ui-protocol";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
  type CommandCenterPrimaryAction,
} from "./task-workspace-execution-overview";
import { TaskWorkspaceNodeDetailPanel } from "./task-workspace-node-detail-panel";

type ConsoleView = ReturnType<typeof createTaskWorkspaceExecutionConsoleView>;
type WorkspaceCopy = Record<string, string | undefined>;

/**
 * Right-rail inspector.
 *
 * The task overview is the stable base layer and is always mounted. Selecting a
 * plan node opens the node detail as a clearly-delineated overlay layered *on
 * top of* the overview, rather than silently swapping the rail's contents. The
 * overlay carries its own header (back + node title + close) and slides in, so
 * the user can tell what caused the change and exactly how to dismiss it
 * (close button, Escape, or deselecting the node in the graph).
 */
export function TaskWorkspaceInspector({
  taskId,
  scope,
  consoleView,
  primaryAction,
  commandCenter,
  commandCenterActionHandlers,
  runtimeEvents,
  liveActivity,
  commandCenterCopy,
  copy,
  selectedNodes,
  selectedNodeRuntimeEvents,
  nodeActivity,
  isNodeActivityLoading,
  preferredNodeDetailTab,
  onPreferredNodeDetailTabApplied,
  onAction,
  onBackToTask,
}: {
  taskId: string;
  scope: "task" | "node";
  consoleView: ConsoleView;
  primaryAction: CommandCenterPrimaryAction;
  commandCenter: { documents: { now: UiDocument; output: UiDocument; trail: UiDocument } } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  runtimeEvents: WorkspaceRuntimeEvent[];
  liveActivity: WorkspaceActivityItem[];
  commandCenterCopy?: Partial<CommandCenterCopy>;
  copy: WorkspaceCopy;
  selectedNodes: PlanNodeDataModel[];
  selectedNodeRuntimeEvents: WorkspaceRuntimeEvent[];
  nodeActivity: WorkspaceActivityItem[];
  isNodeActivityLoading: boolean;
  preferredNodeDetailTab: "result" | null;
  onPreferredNodeDetailTabApplied: () => void;
  onAction: (nodeId?: string) => void;
  onBackToTask: () => void;
}) {
  const isNodeScope = scope === "node" && consoleView.nodeDetail.currentNode !== null;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeTitle = consoleView.nodeDetail.title;

  // Escape dismisses the node overlay back to the task overview.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onBackToTask();
      }
    },
    [onBackToTask],
  );

  // Move focus into the overlay when it opens so keyboard users land on the
  // dismiss control and Escape is wired without an extra click.
  useEffect(() => {
    if (isNodeScope) closeButtonRef.current?.focus();
  }, [isNodeScope]);

  return (
    <aside
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-border/60 bg-background/45 p-1 shadow-sm"
      aria-label={copy.commandCenterAria ?? "Task command center"}
    >
      {/* Base layer: task overview is always mounted so the node overlay reads
          as a temporary focus on top of a stable surface. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        inert={isNodeScope ? true : undefined}
        aria-hidden={isNodeScope ? true : undefined}
      >
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
          onAction={onAction}
        />
      </div>

      {/* Overlay layer: selected node detail, slid in over the overview. A
          distinct muted background + titled header separate it visually from
          the base overview and state plainly what it is. */}
      {isNodeScope ? (
        <div
          role="dialog"
          aria-label={copy.nodeDetailOverlayAria ?? "Selected node details"}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 z-20 flex animate-in flex-col gap-2 rounded-[1.25rem] border border-border/70 bg-muted/95 p-2.5 shadow-xl duration-150 slide-in-from-right-4 fade-in-0 supports-backdrop-filter:backdrop-blur-sm"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 pb-2">
            <Button
              ref={closeButtonRef}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 rounded-lg px-2 text-xs"
              onClick={onBackToTask}
            >
              <ArrowLeft className="size-3.5" />
              {copy.backToTaskOverview ?? "Task overview"}
            </Button>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.nodeDetailOverlayTitle ?? "Node details"}
              </span>
              <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={nodeTitle}>
                {nodeTitle}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-lg"
              onClick={onBackToTask}
              aria-label={copy.closeNodeDetail ?? "Close node details"}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <TaskWorkspaceNodeDetailPanel
              detail={consoleView.nodeDetail}
              activity={nodeActivity}
              runtimeEvents={selectedNodeRuntimeEvents}
              isActivityLoading={isNodeActivityLoading}
              selectedNodes={selectedNodes}
              preferredTab={preferredNodeDetailTab}
              onPreferredTabApplied={onPreferredNodeDetailTabApplied}
            />
          </div>
        </div>
      ) : null}
    </aside>
  );
}
