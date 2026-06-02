"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskAction } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
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
  type NodeDrawerFrame,
  type NodeDrawerSize,
  WorkspaceNodeActionControls,
} from "../execution/task-workspace-node-detail-panel";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import {
  createTaskWorkspaceExecutionConsoleView,
  type TaskExecutionDispatchResult,
} from "../model/task-workspace-query";
import {
  dispatchInputForPrimaryAction,
  resolveCommandCenterPrimaryAction,
} from "../model/task-workspace-primary-action";
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

function isSyntheticStartingNodeWithoutExecutionEvidence(node: TaskPlanGraphPlan["nodes"][number]) {
  return node.metadata?.launchState === "starting";
}

function hasStartedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  return (graphPlan?.nodes ?? []).some((node) => {
    if (isSyntheticStartingNodeWithoutExecutionEvidence(node)) return false;
    return node.status !== "idle" && node.status !== "pending" && node.status !== "ready";
  });
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

function graphNodeIdForAction(action: TaskAction | null | undefined, pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null) {
  return action?.targetNodeId
    ?? pageData.task.executionSummary?.currentNodeId
    ?? graphPlan?.currentStepId
    ?? graphPlan?.nodes.find((node) => node.status === "failed" || node.status === "blocked")?.id
    ?? null;
}

function isNodeDetailDrawerTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("[data-node-detail-drawer]"));
}

function isPlanGraphTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest("[data-plan-graph-surface]"));
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
  const [nodeDrawerSize, setNodeDrawerSize] = useState<NodeDrawerSize>("collapsed");
  const [nodeDrawerFrame, setNodeDrawerFrame] = useState<NodeDrawerFrame | null>(null);
  const nodeDrawerFrameRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoOpenDrawerRef = useRef(false);
  const { selectedPlanNode, selectedPlanNodes, handleSelectedPlanNodeChange } =
    useTaskWorkspacePlanSectionState(graphPlan);
  const { messages } = useI18n();
  const copy = messages.components?.taskWorkspace ?? {};
  const consoleView = useMemo(
    () => createTaskWorkspaceExecutionConsoleView({
      pageData,
      graphPlan,
      selectedNode: selectedPlanNode,
      copy,
    }),
    [pageData, graphPlan, selectedPlanNode, copy],
  );
  const operationConsoleView = useMemo(
    () => createTaskWorkspaceExecutionConsoleView({
      pageData,
      graphPlan,
      selectedNode: null,
      copy,
    }),
    [pageData, graphPlan, copy],
  );
  const stateMessage =
    consoleView.states.errorMessage ??
    (consoleView.states.isPermissionLimited
      ? consoleView.task.runnabilitySummary
      : null) ??
    (consoleView.states.isStale
      ? consoleView.states.treatment.guidance
      : null) ??
    (planGenerationStatus === "generating"
      ? (copy.generatingFreshPlan ?? "Generating a fresh plan. The graph will update when the run completes.")
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
  const taskPrimaryAction = pageData.task.executionSummary?.primaryAction ?? null;
  const primaryActionNodeId = graphNodeIdForAction(taskPrimaryAction, pageData, graphPlan);
  const primaryActionDispatch = taskPrimaryAction
    ? dispatchInputForPrimaryAction(taskPrimaryAction, primaryActionNodeId)
    : null;
  const shouldUseTaskPrimaryAction = Boolean(
    isPlanAccepted &&
    !hasTaskCompleted &&
    taskPrimaryAction?.enabled &&
    taskPrimaryAction.type !== "none" &&
    taskPrimaryAction.type !== "start",
  );
  const nodeActivityQuery = useQuery({
    queryKey: ["task-workspace-node-activity", pageData.task.id, selectedDetailNode?.id],
    queryFn: () => loadNodeWorkspaceActivityPage({
      taskId: pageData.task.id,
      nodeId: selectedDetailNode?.id ?? "",
      limit: 100,
    }),
    enabled: Boolean(selectedDetailNode?.id) && nodeDrawerSize !== "collapsed",
  });
  const selectedNodeRuntimeEvents = selectedDetailNode?.id
    ? runtimeEvents.filter((event) => event.nodeId === selectedDetailNode.id)
    : [];
  const hasCurrentOperationControls = Boolean(currentOperationNode?.checkpoint) && hasNodeActionPayload(currentOperationNode) && !operationConsoleView.nodeDetail.disabledActionReason;
  const shouldShowCurrentOperation = Boolean(currentOperationNode && (hasCurrentOperationControls || currentOperationNode.status === "blocked"));
  const visibleGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const handleRegeneratePlan = () => {
    onGeneratePlan({ userInstruction: regenerationInstruction });
  };
  const primaryActionDescriptor = resolveCommandCenterPrimaryAction({
    hasPlan: Boolean(plan),
    planStatus: plan?.status ?? null,
    isPlanAwaitingAcceptance,
    planGenerationStatus,
    isGeneratingPlan,
    hasTaskCompleted,
    hasGraphExecutionStarted,
    shouldUseTaskPrimaryAction,
    taskPrimaryAction,
    shouldShowCurrentOperation: shouldShowCurrentOperation && Boolean(currentOperationNode),
    currentOperationStatusLabel: currentOperationNode?.statusLabel ?? currentOperationNode?.status ?? null,
    currentOperationDescription: currentOperationNode?.nextAction ?? currentOperationNode?.summary ?? null,
    currentOperationTone: operationConsoleView.attention?.tone ?? operationConsoleView.readiness.tone,
    primaryStateLabel: consoleView.header.primaryStateLabel ?? null,
    taskStatus: pageData.task.status,
    runnabilitySummary: pageData.task.runnabilitySummary || null,
    blockActionRequired: pageData.task.blockReason?.actionRequired ?? null,
    blockType: pageData.task.blockReason?.blockType ?? null,
  });
  const primaryAction: CommandCenterPrimaryAction = {
    ...primaryActionDescriptor,
    ...(primaryActionDescriptor.kind === "generate"
      ? { onClick: () => onGeneratePlan() }
      : {}),
    ...(primaryActionDescriptor.kind === "task-primary-action" && primaryActionDispatch
      ? { onClick: () => void onDispatchExecutionAction(primaryActionDispatch) }
      : {}),
    ...(primaryActionDescriptor.kind === "start-plan"
      ? { onClick: () => void onDispatchExecutionAction({ action: "start_manual" }) }
      : {}),
    ...(primaryActionDescriptor.kind === "accept-or-regenerate" && plan
      ? {
          actionControls: (
            <div className="space-y-3">
              {visibleGenerationInstruction ? (
                <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
                  <div className="font-semibold">{copy.instructionLabel ?? "User instruction for this plan revision"}</div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{visibleGenerationInstruction}</p>
                </div>
              ) : null}
              <Textarea
                value={regenerationInstruction}
                onChange={(event) => setRegenerationInstruction(event.target.value)}
                placeholder={copy.instructionPlaceholder ?? "Tell Chrona what to change in the regenerated plan..."}
                className="min-h-24 resize-y rounded-xl bg-background text-sm"
                aria-label={copy.instructionAria ?? "Plan regeneration instruction"}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs shadow-sm"
                  disabled={!canAcceptPlan}
                  onClick={() => void onApplyPlan(plan)}
                >
                  {copy.accept ?? "Accept plan"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  disabled={isGeneratingPlan}
                  onClick={handleRegeneratePlan}
                >
                  {isGeneratingPlan ? (copy.generating ?? "Generating...") : (copy.regenerateWithInstruction ?? "Regenerate with instruction")}
                </Button>
              </div>
              {acceptPlanError ? <p className="text-xs text-destructive">{acceptPlanError}</p> : null}
            </div>
          ),
        }
      : {}),
    ...(primaryActionDescriptor.kind === "current-operation" && currentOperationNode
      ? {
          actionControls: (
            <WorkspaceNodeActionControls
              node={currentOperationNode}
              disabledActionReason={operationConsoleView.nodeDetail.disabledActionReason}
              onDispatchExecutionAction={onDispatchExecutionAction}
              onSubmitCheckpointAction={onSubmitCheckpointAction}
              className="border-0 bg-transparent p-0 shadow-none"
            />
          ),
        }
      : {}),
  };
  const handlePlanNodeChange = useCallback((
    node: PlanNodeDataModel | null,
    nodes: PlanNodeDataModel[],
  ) => {
    handleSelectedPlanNodeChange(node, nodes);
    if (node && nodeDrawerSize === "collapsed" && shouldAutoOpenDrawerRef.current) {
      setNodeDrawerSize("expanded");
    }
    shouldAutoOpenDrawerRef.current = false;
  }, [handleSelectedPlanNodeChange, nodeDrawerSize]);
  const focusNodeActions = (nodeId?: string) => {
    if (nodeId && graphPlan) {
      const node =
        graphPlan.nodes.find((candidate) => candidate.id === nodeId) ?? null;
      if (node) {
        handleSelectedPlanNodeChange(node, [node]);
        if (nodeDrawerSize === "collapsed") setNodeDrawerSize("expanded");
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
  useEffect(() => {
    const frame = nodeDrawerFrameRef.current;
    if (!frame) return;

    const updateFrame = () => {
      const rect = frame.getBoundingClientRect();
      setNodeDrawerFrame({ left: rect.left, width: rect.width });
    };

    updateFrame();

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateFrame);
    resizeObserver?.observe(frame);
    window.addEventListener("resize", updateFrame);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateFrame);
    };
  }, []);

  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className="relative flex flex-col overflow-visible rounded-[1.5rem] border border-border bg-canvas p-2 pb-0 xl:min-h-0 xl:flex-1 xl:overflow-hidden"
    >
      {stateMessage ? (
        <div
          className="relative mb-2 rounded-xl border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-foreground shadow-sm"
          role="status"
        >
          {stateMessage}
        </div>
      ) : null}

      {recoveryIssue ? (
        <div
          className="relative mb-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          <div className="font-semibold">{copy.recoveryNeeded ?? "Recovery needed"}</div>
          <div className="mt-0.5">{recoveryIssue.message}</div>
          {recoveryActions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {recoveryActions.map((action) => (
                <Button
                  key={action.type}
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-lg px-2.5 text-xs"
                  disabled={!action.enabled}
                  onClick={() => focusNodeActions(recoveryCurrentNodeId)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative flex min-h-[700px] flex-1 flex-col gap-2 xl:min-h-0">
        <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(0,1fr)_352px] 2xl:grid-cols-[minmax(0,1fr)_372px]">
          <section
            aria-label={copy.executionFlow ?? "Execution flow"}
            className="min-h-0 min-w-0"
            data-plan-graph-surface
          >
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
            className="min-h-0 space-y-2 overflow-y-auto p-1"
            aria-label={copy.commandCenterAria ?? "Task command center"}
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

        <div className="pointer-events-none relative z-20 grid h-[60px] shrink-0 gap-2 xl:grid-cols-[minmax(0,1fr)_352px] 2xl:grid-cols-[minmax(0,1fr)_372px]">
          <div ref={nodeDrawerFrameRef} className="relative min-w-0">
            <div className="absolute inset-x-0 bottom-2">
              <TaskWorkspaceNodeDetailPanel
                detail={consoleView.nodeDetail}
                activity={nodeActivityQuery.data?.items ?? []}
                runtimeEvents={selectedNodeRuntimeEvents}
                isActivityLoading={nodeActivityQuery.isLoading || nodeActivityQuery.isFetching}
                selectedNodes={selectedPlanNodes}
                variant="drawer"
                drawerSize={nodeDrawerSize}
                drawerFrame={nodeDrawerFrame}
                onDrawerSizeChange={setNodeDrawerSize}
                preferredTab={preferredNodeDetailTab}
                onPreferredTabApplied={() => setPreferredNodeDetailTab(null)}
                onDispatchExecutionAction={onDispatchExecutionAction}
                onSubmitCheckpointAction={onSubmitCheckpointAction}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
