"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { TaskWorkspaceExecutionOverview } from "../execution/task-workspace-execution-overview";
import { TaskWorkspaceNodeDetailPanel } from "../execution/task-workspace-node-detail-panel";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import {
  createTaskWorkspaceExecutionConsoleView,
  type TaskExecutionDispatchResult,
} from "../model/task-workspace-query";
import type {
  TaskPageData,
  TaskPlanGenerationStatus,
} from "../model/task-workspace-types";
import { useTaskWorkspacePlanSectionState } from "../hooks/use-task-workspace-plan-section-state";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

const DEFAULT_NODE_PANEL_HEIGHT = 360;
const MIN_NODE_PANEL_HEIGHT = 100;
const MIN_FLOW_PANEL_HEIGHT = 100;

type TaskWorkspacePlanSectionProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan: boolean;
  isAcceptingPlan: boolean;
  acceptPlanError: string | null;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void;
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
};

export function TaskWorkspacePlanSection({
  label,
  graphPlan,
  pageData,
  plan,
  planGenerationStatus,
  canAcceptPlan,
  isAcceptingPlan,
  acceptPlanError,
  onAcceptPlan,
  onGeneratePlan,
  onDispatchExecutionAction,
}: TaskWorkspacePlanSectionProps) {
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [nodePanelHeight, setNodePanelHeight] = useState(
    DEFAULT_NODE_PANEL_HEIGHT,
  );
  const { selectedPlanNode, selectedPlanNodes, handleSelectedPlanNodeChange } =
    useTaskWorkspacePlanSectionState(graphPlan);
  const consoleView = createTaskWorkspaceExecutionConsoleView({
    pageData,
    graphPlan,
    selectedNode: selectedPlanNode,
  });
  const stateMessage =
    consoleView.states.errorMessage ??
    (consoleView.states.isPermissionLimited
      ? consoleView.task.runnabilitySummary
      : null) ??
    (consoleView.states.isStale
      ? "Execution data may be stale. Refresh before acting on results."
      : null) ??
    (planGenerationStatus === "generating"
      ? "Generating a fresh plan. The graph will update when the run completes."
      : null);
  const focusNodeActions = (nodeId?: string) => {
    if (nodeId && graphPlan) {
      const node =
        graphPlan.nodes.find((candidate) => candidate.id === nodeId) ?? null;
      if (node) {
        handleSelectedPlanNodeChange(node, [node]);
      }
    }

    document
      .getElementById("task-workspace-node-actions")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const resizeNodePanel = useCallback((clientY: number) => {
    const container = splitContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const requestedHeight = rect.bottom - clientY;
    const maxNodePanelHeight = Math.max(
      MIN_NODE_PANEL_HEIGHT,
      rect.height - MIN_FLOW_PANEL_HEIGHT,
    );
    setNodePanelHeight(
      Math.min(
        Math.max(requestedHeight, MIN_NODE_PANEL_HEIGHT),
        maxNodePanelHeight,
      ),
    );
  }, []);

  const updateNodePanelHeight = useCallback(
    (getNextHeight: (height: number) => number) => {
      const container = splitContainerRef.current;
      const maxNodePanelHeight = container
        ? Math.max(
            MIN_NODE_PANEL_HEIGHT,
            container.getBoundingClientRect().height - MIN_FLOW_PANEL_HEIGHT,
          )
        : DEFAULT_NODE_PANEL_HEIGHT;

      setNodePanelHeight((height) => {
        const nextHeight = getNextHeight(height);
        return Math.min(
          Math.max(nextHeight, MIN_NODE_PANEL_HEIGHT),
          maxNodePanelHeight,
        );
      });
    },
    [],
  );

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeNodePanel(event.clientY);
    },
    [resizeNodePanel],
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      resizeNodePanel(event.clientY);
    },
    [resizeNodePanel],
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        updateNodePanelHeight((height) => height + 24);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        updateNodePanelHeight((height) => height - 24);
      } else if (event.key === "Home") {
        event.preventDefault();
        updateNodePanelHeight(() => MIN_NODE_PANEL_HEIGHT);
      } else if (event.key === "End") {
        event.preventDefault();
        updateNodePanelHeight(() => DEFAULT_NODE_PANEL_HEIGHT);
      }
    },
    [updateNodePanelHeight],
  );

  const splitStyle = {
    "--task-node-panel-height": `${nodePanelHeight}px`,
  } as CSSProperties;

  return (
    <section
      aria-label="Task execution workspace"
      className="min-h-0 rounded-[1rem] border border-border/35 bg-[linear-gradient(180deg,hsl(var(--muted)/0.12),transparent_18%),hsl(var(--background))] p-1"
    >
      {stateMessage ? (
        <div
          className="mb-1.5 rounded-xl border border-amber-300/45 bg-amber-50/70 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {stateMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 gap-1.5 xl:h-[calc(100dvh-6.25rem)] xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div
          ref={splitContainerRef}
          className="grid min-h-0 gap-1 xl:grid-rows-[minmax(0,1fr)_10px_minmax(0,var(--task-node-panel-height))]"
          style={splitStyle}
        >
          <section aria-label="Execution flow" className="min-h-0 min-w-0">
            <TaskWorkspacePlanContent
              label={label}
              graphPlan={graphPlan}
              plan={plan}
              canAcceptPlan={canAcceptPlan}
              isAcceptingPlan={isAcceptingPlan}
              acceptPlanError={acceptPlanError}
              planGenerationStatus={planGenerationStatus}
              onGeneratePlan={onGeneratePlan}
              onAcceptPlan={onAcceptPlan}
              onSelectedNodeChange={handleSelectedPlanNodeChange}
            />
          </section>

          <button
            type="button"
            aria-label="Resize execution flow and current node panels"
            aria-orientation="horizontal"
            aria-valuemin={MIN_NODE_PANEL_HEIGHT}
            aria-valuenow={Math.round(nodePanelHeight)}
            role="separator"
            className="hidden cursor-row-resize touch-none items-center justify-center rounded-md outline-none transition-colors hover:bg-border/40 focus-visible:bg-border/50 focus-visible:ring-2 focus-visible:ring-ring xl:flex"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onKeyDown={handleResizeKeyDown}
          >
            <span className="h-px w-16 rounded-full bg-border" />
          </button>

          <TaskWorkspaceNodeDetailPanel
            detail={consoleView.nodeDetail}
            selectedNodes={selectedPlanNodes}
            onDispatchExecutionAction={onDispatchExecutionAction}
          />
        </div>

        <TaskWorkspaceExecutionOverview
          readiness={consoleView.readiness}
          latestResult={consoleView.latestResult}
          attention={consoleView.attention}
          artifacts={consoleView.artifacts}
          activity={consoleView.activity}
          onAction={focusNodeActions}
        />
      </div>
    </section>
  );
}
