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
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
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
  runtimeEvents: WorkspaceRuntimeEvent[];
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
  runtimeEvents,
  onAcceptPlan,
  onGeneratePlan,
  onDispatchExecutionAction,
}: TaskWorkspacePlanSectionProps) {
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [nodePanelHeight, setNodePanelHeight] = useState(
    DEFAULT_NODE_PANEL_HEIGHT,
  );
  const [preferredNodeDetailTab, setPreferredNodeDetailTab] = useState<"action" | null>(null);
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
    setPreferredNodeDetailTab("action");

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
            preferredTab={preferredNodeDetailTab}
            onPreferredTabApplied={() => setPreferredNodeDetailTab(null)}
            onDispatchExecutionAction={onDispatchExecutionAction}
          />
        </div>

        <div className="min-h-0 space-y-1.5 overflow-y-auto">
          <RuntimeActivityPanel events={runtimeEvents} />
          <TaskWorkspaceExecutionOverview
            readiness={consoleView.readiness}
            latestResult={consoleView.latestResult}
            attention={consoleView.attention}
            artifacts={consoleView.artifacts}
            activity={consoleView.activity}
            onAction={focusNodeActions}
          />
        </div>
      </div>
    </section>
  );
}

function RuntimeActivityPanel({ events }: { events: WorkspaceRuntimeEvent[] }) {
  if (events.length === 0) return null;

  const assistantText = events
    .map((event) => event.event.type === "assistant_text_delta" ? event.event.text : "")
    .join("")
    .trim();
  const reasoningText = events
    .map((event) => event.event.type === "reasoning_delta" ? event.event.text : "")
    .join("")
    .trim();
  const activityEvents = events
    .filter((event) => event.event.type !== "assistant_text_delta" && event.event.type !== "reasoning_delta")
    .slice(-12);

  return (
    <section className="rounded-[1rem] border border-blue-200/70 bg-blue-50/60 p-3" aria-label="Runtime activity">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Runtime activity</p>
          <p className="text-xs text-muted-foreground">Provider stream, Chrona state remains authoritative.</p>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-blue-800">
          {events.at(-1)?.provider ?? "runtime"}
        </span>
      </div>
      {assistantText ? (
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-white/80 bg-white/85 px-2.5 py-2 text-sm leading-5 text-foreground">
          {assistantText}
        </p>
      ) : null}
      {reasoningText ? (
        <details className="mt-2 rounded-lg border border-white/80 bg-white/70 px-2.5 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Reasoning</summary>
          <p className="mt-1 whitespace-pre-wrap leading-5">{reasoningText}</p>
        </details>
      ) : null}
      {activityEvents.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {activityEvents.map((event, index) => (
            <RuntimeActivityRow key={`${event.sequence ?? index}:${event.event.type}:${event.rawEventType ?? "event"}`} event={event} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RuntimeActivityRow({ event }: { event: WorkspaceRuntimeEvent }) {
  const value = event.event;
  if (value.type === "tool_started") {
    return (
      <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-xs">
        <span className="font-medium text-foreground">{value.label}</span>
        {typeof value.preview === "string" && value.preview ? <span className="ml-1 text-muted-foreground">{value.preview}</span> : null}
      </div>
    );
  }
  if (value.type === "tool_completed") {
    return (
      <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-xs">
        <span className={value.error ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
          {value.error ? `${value.label} failed` : `${value.label} completed`}
        </span>
        {value.durationMs !== undefined ? <span className="ml-1 text-muted-foreground">{Math.round(value.durationMs)}ms</span> : null}
        {value.error ? <span className="ml-1 text-red-700">{value.error.message}</span> : null}
      </div>
    );
  }
  if (value.type === "approval_required") {
    return <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">Approval required</div>;
  }
  if (value.type === "run_status") {
    return <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-xs text-muted-foreground">{value.message ?? value.status}</div>;
  }
  return <div className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-xs text-muted-foreground">{value.type === "raw_event" ? value.rawEventType ?? "Raw provider event" : value.type}</div>;
}
