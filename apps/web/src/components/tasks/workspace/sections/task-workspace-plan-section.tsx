"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import { TaskPlanGenerationPanel } from "@/components/tasks/ai/task-plan-generation-panel";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskConfigFormDraft } from "@/components/schedule/forms/task-config-form";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
  type CommandCenterPrimaryAction,
} from "../execution/task-workspace-execution-overview";
import {
  TaskWorkspaceNodeDetailPanel,
  WorkspaceNodeActionControls,
} from "../execution/task-workspace-node-detail-panel";
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

function hasStartedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  return (graphPlan?.nodes ?? []).some((node) => node.status !== "idle" && node.status !== "pending" && node.status !== "ready");
}

function hasNodeActionPayload(node: PlanNodeDataModel | null) {
  if (!node) return false;
  if ((node.availableActions?.length ?? 0) > 0) return true;
  if ((node.interactiveFields?.length ?? 0) === 0) return false;
  const submittedInput = node.inputFields && Object.values(node.inputFields).some((value) => value.trim());
  return !(node.status === "done" || node.status === "skipped") || !submittedInput;
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
  commandCenterCopy?: Partial<CommandCenterCopy>;
  graphPlan: TaskPlanGraphPlan | null;
  isGraphPlanPending: boolean;
  pageData: TaskPageData;
  plan: TaskPlanReadModel | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  planningTaskDraft: TaskConfigFormDraft;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  requestGenerationKey?: number;
  runtimeEvents: WorkspaceRuntimeEvent[];
  onGeneratePlan: () => void;
  onPlanLoaded: (savedPlan: TaskPlanReadModel | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
};

export function TaskWorkspacePlanSection({
  label,
  commandCenterCopy,
  graphPlan,
  isGraphPlanPending,
  pageData,
  plan,
  planGenerationStatus,
  canAcceptPlan,
  acceptPlanError,
  planningTaskDraft,
  hasUnsavedConfigChanges,
  unsavedConfigDraft,
  requestGenerationKey,
  runtimeEvents,
  onGeneratePlan,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
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
  const recoveryCurrentNodeId = pageData.reconciliation?.currentNodeId ?? undefined;
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
  const isGeneratingPlan = planGenerationStatus === "generating";
  const currentOperationNode = consoleView.nodeDetail.currentNode;
  const hasCurrentOperationControls = hasNodeActionPayload(currentOperationNode) && !consoleView.nodeDetail.disabledActionReason;
  const primaryAction: CommandCenterPrimaryAction = !plan
    ? {
        label: isGeneratingPlan ? "Generating..." : "Generate plan",
        description: isGeneratingPlan
          ? "A fresh plan is being generated for this task."
          : "Create an execution plan before starting task work.",
        statusLabel: planGenerationStatus,
        tone: "info",
        disabled: isGeneratingPlan,
        isLoading: isGeneratingPlan,
        onClick: onGeneratePlan,
      }
    : !hasStartedGraphExecution(graphPlan)
      ? {
          label: "Start plan",
          description: "Run the accepted plan and move into the first executable step.",
          statusLabel: plan.status,
          tone: "success",
          onClick: () => void onDispatchExecutionAction({ action: "start_manual" }),
        }
      : hasCurrentOperationControls && currentOperationNode
        ? {
            label: "Current node action",
            description: currentOperationNode.nextAction ?? currentOperationNode.summary ?? "Complete the current node action to continue.",
            statusLabel: currentOperationNode.statusLabel ?? currentOperationNode.status,
            tone: consoleView.attention?.tone ?? consoleView.readiness.tone,
            actionControls: (
              <WorkspaceNodeActionControls
                node={currentOperationNode}
                disabledActionReason={consoleView.nodeDetail.disabledActionReason}
                onDispatchExecutionAction={onDispatchExecutionAction}
                className="border-0 bg-transparent p-0 shadow-none"
              />
            ),
          }
        : {
            label: "No current operation",
            description: "This task has no node input or execution action available right now.",
            statusLabel: consoleView.header.primaryStateLabel ?? pageData.task.status,
            tone: "neutral",
            suppressAttentionCard: true,
          };
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

    const actionsPanel = document.getElementById("task-workspace-node-actions");
    if (typeof actionsPanel?.scrollIntoView === "function") {
      actionsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
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
                  onClick={() => focusNodeActions(recoveryCurrentNodeId)}
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
              runtimeEvents={runtimeEvents}
              primaryAction={primaryAction}
              copy={commandCenterCopy}
              progressLabel={completionLabel}
              taskStatus={consoleView.header.primaryStateLabel ?? pageData.task.status}
              nextAction={consoleView.latestResult.description}
              onAction={focusNodeActions}
            />
            <TaskPlanGenerationPanel
              taskId={pageData.task.id}
              title={planningTaskDraft.title}
              description={planningTaskDraft.description}
              priority={planningTaskDraft.priority}
              dueAt={planningTaskDraft.dueAt}
              autoRequest={false}
              savedPlan={plan}
              generationStatus={planGenerationStatus}
              onPlanLoaded={onPlanLoaded}
              onApply={canAcceptPlan ? onApplyPlan : undefined}
              activeAcceptedPlanId={plan?.status === "accepted" ? plan.id : null}
              hasUnsavedConfigChanges={hasUnsavedConfigChanges}
              unsavedConfigDraft={unsavedConfigDraft}
              onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
              showGraph={false}
              requestGenerationKey={requestGenerationKey}
              showEmptyGenerateButton={false}
              showRegenerateButton={false}
              renderIdleEmptyState={false}
            />
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
