"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { TaskPlanGenerationPanel } from "@/components/tasks/ai/task-plan-generation-panel";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskConfigFormDraft } from "@/components/schedule/forms/task-config-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { loadNodeWorkspaceActivityPage } from "../model/task-workspace-actions";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
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

function isCompletedTaskStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? "";
  return normalized === "done" || normalized === "completed" || normalized === "complete";
}

function hasCompletedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  const nodes = graphPlan?.nodes ?? [];
  return nodes.length > 0 && nodes.every((node) => isCompletedGraphNode(node.status));
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
  runtimeEvents: WorkspaceRuntimeEvent[];
  generationUserInstruction?: string | null;
  onGeneratePlan: (request?: PlanGenerationRequest) => void;
  onPlanLoaded: (savedPlan: TaskPlanReadModel | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
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
  generationUserInstruction,
  runtimeEvents,
  onGeneratePlan,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
}: TaskWorkspacePlanSectionProps) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
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
  const operationConsoleView = createTaskWorkspaceExecutionConsoleView({
    pageData,
    graphPlan,
    selectedNode: null,
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
  const isPlanAccepted = plan?.status === "accepted";
  const isPlanAwaitingAcceptance = Boolean(plan && !isPlanAccepted);
  const shouldShowPlanGenerationPanel = isGeneratingPlan;
  const hasGraphExecutionStarted = hasStartedGraphExecution(graphPlan);
  const hasTaskCompleted = isCompletedTaskStatus(pageData.task.status) || hasCompletedGraphExecution(graphPlan);
  const currentOperationNode = operationConsoleView.nodeDetail.currentNode;
  const selectedDetailNode = consoleView.nodeDetail.currentNode;
  const nodeActivityQuery = useQuery({
    queryKey: ["task-workspace-node-activity", pageData.task.id, selectedDetailNode?.id],
    queryFn: () => loadNodeWorkspaceActivityPage({
      taskId: pageData.task.id,
      nodeId: selectedDetailNode?.id ?? "",
      limit: 100,
    }),
    enabled: Boolean(selectedDetailNode?.id) && nodeDrawerSize !== "collapsed",
  });
  const hasCurrentOperationControls = Boolean(currentOperationNode?.checkpoint) && hasNodeActionPayload(currentOperationNode) && !operationConsoleView.nodeDetail.disabledActionReason;
  const shouldShowCurrentOperation = Boolean(currentOperationNode && (hasCurrentOperationControls || currentOperationNode.status === "blocked"));
  const visibleGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const handleRegeneratePlan = () => {
    onGeneratePlan({ userInstruction: regenerationInstruction });
  };
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
        onClick: () => onGeneratePlan(),
      }
    : isPlanAwaitingAcceptance
      ? {
          label: "Accept or regenerate plan",
          description: "Review this draft plan. Accept it to enable execution, or regenerate it with user instructions.",
          statusLabel: planGenerationStatus === "waiting_acceptance" ? planGenerationStatus : plan.status,
          tone: "info",
          actionControls: (
            <div className="space-y-3">
              {visibleGenerationInstruction ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950">
                  <div className="font-semibold">User instruction for this plan revision</div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{visibleGenerationInstruction}</p>
                </div>
              ) : null}
              <Textarea
                value={regenerationInstruction}
                onChange={(event) => setRegenerationInstruction(event.target.value)}
                placeholder="Tell Chrona what to change in the regenerated plan..."
                className="min-h-24 resize-y rounded-xl bg-white/90 text-sm"
                aria-label="Plan regeneration instruction"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs shadow-sm"
                  disabled={!canAcceptPlan}
                  onClick={() => void onApplyPlan(plan)}
                >
                  Accept plan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  disabled={isGeneratingPlan}
                  onClick={handleRegeneratePlan}
                >
                  {isGeneratingPlan ? "Generating..." : "Regenerate with instruction"}
                </Button>
              </div>
              {acceptPlanError ? <p className="text-xs text-red-700">{acceptPlanError}</p> : null}
            </div>
          ),
        }
    : hasTaskCompleted
      ? {
          label: "Task completed",
          description: "Execution has finished. Review the result, artifacts, or activity history if needed.",
          statusLabel: consoleView.header.primaryStateLabel ?? pageData.task.status,
          tone: "success",
          suppressAttentionCard: true,
        }
    : !hasGraphExecutionStarted
           ? {
              label: "Start plan",
              description: "Run the accepted plan and move into the first executable step.",
              statusLabel: plan.status,
              tone: "success",
              onClick: () => void onDispatchExecutionAction({ action: "start_manual" }),
            }
        : shouldShowCurrentOperation && currentOperationNode
          ? {
              label: "Current node action",
              description: currentOperationNode.nextAction ?? currentOperationNode.summary ?? "Complete the current node action to continue.",
              statusLabel: currentOperationNode.statusLabel ?? currentOperationNode.status,
              tone: operationConsoleView.attention?.tone ?? operationConsoleView.readiness.tone,
              actionControls: (
                <WorkspaceNodeActionControls
                  node={currentOperationNode}
                  disabledActionReason={operationConsoleView.nodeDetail.disabledActionReason}
                  onSubmitCheckpointAction={onSubmitCheckpointAction}
                  className="border-0 bg-transparent p-0 shadow-none"
                />
              ),
            }
        : {
            label: "No current operation",
            description: "The accepted plan is running, but the engine has not returned an actionable checkpoint yet.",
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
            {shouldShowPlanGenerationPanel ? (
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
                activeAcceptedPlanId={isPlanAccepted ? plan.id : null}
                hasUnsavedConfigChanges={hasUnsavedConfigChanges}
                unsavedConfigDraft={unsavedConfigDraft}
                onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
                showGraph={false}
                userInstruction={generationUserInstruction}
                showEmptyGenerateButton={false}
                showRegenerateButton={false}
                renderIdleEmptyState={false}
              />
            ) : null}
          </aside>
        </div>

        <div className="pointer-events-none relative z-20 grid h-[52px] shrink-0 xl:grid-cols-[minmax(0,1fr)_352px] 2xl:grid-cols-[minmax(0,1fr)_372px]">
          <div className="relative min-w-0">
            <div className="absolute inset-x-0 bottom-0">
              <TaskWorkspaceNodeDetailPanel
                detail={consoleView.nodeDetail}
                activity={nodeActivityQuery.data?.items ?? []}
                isActivityLoading={nodeActivityQuery.isLoading || nodeActivityQuery.isFetching}
                selectedNodes={selectedPlanNodes}
                variant="drawer"
                drawerSize={nodeDrawerSize}
                onDrawerSizeChange={setNodeDrawerSize}
                preferredTab={preferredNodeDetailTab}
                onPreferredTabApplied={() => setPreferredNodeDetailTab(null)}
                onSubmitCheckpointAction={onSubmitCheckpointAction}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
