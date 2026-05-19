"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
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

function isCompletedGraphNode(status: string) {
  return status === "done" || status === "completed" || status === "skipped";
}

function isNodeDetailDrawerTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("[data-node-detail-drawer]"));
}

function isPlanGraphTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest(".react-flow__node,.react-flow__edge,.react-flow__controls"));
}

type TaskWorkspacePlanSectionProps = {
  label: string;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  onGeneratePlan: () => void;
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
};

export function TaskWorkspacePlanSection({
  label,
  graphPlan,
  isGraphPlanPending,
  pageData,
  plan,
  planGenerationStatus,
  acceptPlanError,
  runtimeEvents,
  onGeneratePlan,
  onDispatchExecutionAction,
}: TaskWorkspacePlanSectionProps) {
  const [preferredNodeDetailTab, setPreferredNodeDetailTab] = useState<"action" | null>(null);
  const [nodeDrawerSize, setNodeDrawerSize] = useState<"collapsed" | "half" | "expanded">("collapsed");
  const shouldAutoOpenDrawerRef = useRef(false);
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
      ? consoleView.states.treatment.guidance
      : null) ??
    (planGenerationStatus === "generating"
      ? "Generating a fresh plan. The graph will update when the run completes."
      : null);
  const recoveryActions = pageData.reconciliation?.repairActions ?? [];
  const recoveryIssue = pageData.reconciliation?.issues.find((issue) => issue.severity === "error") ?? null;
  const graphNodes = graphPlan?.nodes ?? [];
  const completedNodeCount = graphNodes.filter((node) =>
    isCompletedGraphNode(node.status),
  ).length;
  const totalNodeCount = graphNodes.length;
  const progressLabel =
    totalNodeCount > 0
      ? `${completedNodeCount}/${totalNodeCount}`
      : consoleView.progress.label;
  const completionLabel = totalNodeCount > 0 ? `${progressLabel} steps` : consoleView.progress.label;
  const handlePlanNodeChange = useCallback((
    node: PlanNodeDataModel | null,
    nodes: PlanNodeDataModel[],
  ) => {
    handleSelectedPlanNodeChange(node, nodes);
    if (node && nodeDrawerSize === "collapsed" && shouldAutoOpenDrawerRef.current) {
      setNodeDrawerSize("half");
    }
    shouldAutoOpenDrawerRef.current = false;
  }, [handleSelectedPlanNodeChange, nodeDrawerSize]);
  const focusNodeActions = (nodeId?: string) => {
    if (nodeId && graphPlan) {
      const node =
        graphPlan.nodes.find((candidate) => candidate.id === nodeId) ?? null;
      if (node) {
        handleSelectedPlanNodeChange(node, [node]);
        if (nodeDrawerSize === "collapsed") setNodeDrawerSize("half");
      }
    }
    setPreferredNodeDetailTab("action");

    document
      .getElementById("task-workspace-node-actions")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (isNodeDetailDrawerTarget(event.target)) return;
      if (isPlanGraphTarget(event.target)) {
        shouldAutoOpenDrawerRef.current = true;
        return;
      }

      shouldAutoOpenDrawerRef.current = false;
      setNodeDrawerSize((currentSize) => currentSize === "collapsed" ? currentSize : "collapsed");
    };

    document.addEventListener("click", handleDocumentClick, { capture: true });

    return () => {
      document.removeEventListener("click", handleDocumentClick, { capture: true });
    };
  }, []);

  return (
    <section
      aria-label="Task execution workspace"
      className="relative flex flex-col overflow-visible rounded-[1.5rem] border border-slate-200/80 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.14),transparent_34%),radial-gradient(circle_at_82%_6%,rgba(99,102,241,0.10),transparent_30%),linear-gradient(135deg,rgba(248,250,252,0.98),rgba(241,245,249,0.9)_46%,rgba(255,255,255,0.98))] p-2 pb-0 shadow-[0_22px_70px_rgba(15,23,42,0.10)] xl:min-h-0 xl:flex-1 xl:overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-32 rounded-full bg-cyan-300/18 blur-3xl" />
      {stateMessage ? (
        <div
          className="relative mb-2 rounded-xl border border-amber-300/45 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 shadow-sm"
          role="status"
        >
          {stateMessage}
        </div>
      ) : null}

      {recoveryIssue ? (
        <div
          className="relative mb-2 rounded-xl border border-red-300/50 bg-red-50/85 px-3 py-2 text-sm text-red-950 shadow-sm"
          role="alert"
        >
          <div className="font-semibold">Recovery needed</div>
          <div className="mt-0.5">{recoveryIssue.message}</div>
          {recoveryActions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {recoveryActions.map((action) => (
                <button
                  key={action.type}
                  type="button"
                  className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  disabled={!action.enabled}
                  onClick={() => focusNodeActions(pageData.reconciliation?.currentNodeId ?? undefined)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative flex min-h-[700px] flex-1 flex-col gap-2 xl:min-h-0">
        <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(0,1fr)_352px] 2xl:grid-cols-[minmax(0,1fr)_372px]">
          <section aria-label="Execution flow" className="min-h-0 min-w-0">
            <TaskWorkspacePlanContent
              label={label}
              graphPlan={graphPlan}
              isGraphPlanPending={isGraphPlanPending}
              plan={plan}
              acceptPlanError={acceptPlanError}
              planGenerationStatus={planGenerationStatus}
              onGeneratePlan={onGeneratePlan}
              onSelectedNodeChange={handlePlanNodeChange}
            />
          </section>

          <aside
            className="min-h-0 space-y-2 overflow-y-auto rounded-[1.2rem] border border-slate-200/80 bg-white/82 p-2 shadow-[0_14px_45px_rgba(15,23,42,0.07)] backdrop-blur"
            aria-label="Task command center"
          >
            <TaskWorkspaceExecutionOverview
              readiness={consoleView.readiness}
              latestResult={consoleView.latestResult}
              attention={consoleView.attention}
              artifacts={consoleView.artifacts}
              activity={consoleView.activity}
              progressLabel={completionLabel}
              taskStatus={consoleView.header.primaryStateLabel ?? pageData.task.status}
              nextAction={consoleView.latestResult.description}
              onAction={focusNodeActions}
            />
          <RuntimeActivityPanel events={runtimeEvents} />
          </aside>
        </div>

        <div className="pointer-events-none relative z-20 grid h-[52px] shrink-0 xl:grid-cols-[minmax(0,1fr)_352px] 2xl:grid-cols-[minmax(0,1fr)_372px]">
          <div className="relative min-w-0">
            <div className="absolute inset-x-0 bottom-0">
              <TaskWorkspaceNodeDetailPanel
                detail={consoleView.nodeDetail}
                selectedNodes={selectedPlanNodes}
                variant="drawer"
                drawerSize={nodeDrawerSize}
                onDrawerSizeChange={setNodeDrawerSize}
                preferredTab={preferredNodeDetailTab}
                onPreferredTabApplied={() => setPreferredNodeDetailTab(null)}
                onDispatchExecutionAction={onDispatchExecutionAction}
              />
            </div>
          </div>
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
    <section className="rounded-[1.1rem] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(239,246,255,0.72))] p-3 shadow-sm" aria-label="Runtime activity">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-950">Runtime activity</p>
          <p className="text-xs text-slate-500">Provider stream, Chrona state remains authoritative.</p>
        </div>
        <span className="rounded-full border border-cyan-200/70 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
          {events.at(-1)?.provider ?? "runtime"}
        </span>
      </div>
      {assistantText ? (
        <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200/80 bg-white/85 px-2.5 py-2 text-sm leading-5 text-slate-800 shadow-inner">
          {assistantText}
        </p>
      ) : null}
      {reasoningText ? (
        <details className="mt-2 rounded-xl border border-slate-200/80 bg-white/70 px-2.5 py-2 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-800">Reasoning</summary>
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
      <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs shadow-sm">
        <span className="font-medium text-slate-900">{value.label}</span>
        {typeof value.preview === "string" && value.preview ? <span className="ml-1 text-slate-500">{value.preview}</span> : null}
      </div>
    );
  }
  if (value.type === "tool_completed") {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs shadow-sm">
        <span className={value.error ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
          {value.error ? `${value.label} failed` : `${value.label} completed`}
        </span>
        {value.durationMs !== undefined ? <span className="ml-1 text-slate-500">{Math.round(value.durationMs)}ms</span> : null}
        {value.error ? <span className="ml-1 text-red-700">{value.error.message}</span> : null}
      </div>
    );
  }
  if (value.type === "approval_required") {
    return <div className="rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 shadow-sm">Approval required</div>;
  }
  if (value.type === "run_status") {
    return <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500 shadow-sm">{value.message ?? value.status}</div>;
  }
  return <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500 shadow-sm">{value.type === "raw_event" ? value.rawEventType ?? "Raw provider event" : value.type}</div>;
}
