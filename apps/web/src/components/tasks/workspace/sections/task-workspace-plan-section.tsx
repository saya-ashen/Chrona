"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExecutionActionInput, PlanExecutionResult, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskAction } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
import { TaskPlanGenerationPanel } from "@/components/tasks/ai/task-plan-generation-panel";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskConfigFormDraft } from "@/components/schedule/forms/task-config-form";
import { Button } from "@/components/ui/button";
import { buildAcceptOrRegenerateSpec } from "../execution/build-execution-overview-spec";
import type {
  CommandCenterCopy,
  CommandCenterPrimaryAction,
} from "../execution/task-workspace-execution-overview";
import { useActionSpecRenderConfig } from "../execution/action-tab";
import type { UiDocument } from "@chrona/ui-protocol";
import { TaskWorkspaceInspector } from "../execution/task-workspace-inspector";
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
  WorkspaceActivityItem,
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
  liveActivity?: WorkspaceActivityItem[];
  currentExecution?: PlanExecutionResult | null;
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
  liveActivity = [],
  currentExecution,
  onGeneratePlan,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
}: TaskWorkspacePlanSectionProps) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [preferredNodeDetailTab, setPreferredNodeDetailTab] = useState<"result" | null>(null);
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
    enabled: Boolean(selectedDetailNode?.id) && Boolean(selectedPlanNode),
  });
  // Scope follows the user's explicit graph selection. `selectedDetailNode`
  // falls back to the active node for display, so it must not drive scope.
  const inspectorScope = selectedPlanNode ? "node" : "task";
  const selectedNodeRuntimeEvents = selectedDetailNode?.id
    ? runtimeEvents.filter((event) => event.nodeId === selectedDetailNode.id)
    : [];
  const hasCurrentOperationControls = Boolean(currentOperationNode?.checkpoint) && hasNodeActionPayload(currentOperationNode) && !operationConsoleView.nodeDetail.disabledActionReason;
  const shouldShowCurrentOperation = Boolean(currentOperationNode && (hasCurrentOperationControls || currentOperationNode.status === "blocked"));
  const visibleGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const commandCenterScopeKey = pageData.task.currentWorkBlock?.id ?? pageData.task.id;
  const currentOperationAction = useActionSpecRenderConfig({
    node: currentOperationNode,
    disabledActionReason: operationConsoleView.nodeDetail.disabledActionReason,
    onDispatchExecutionAction,
    onSubmitCheckpointAction,
  });
  const apiCurrentOperationSpec = currentExecution?.ui?.currentOperationSpec ?? null;
  const acceptOrRegenerateSpec = useMemo<UiDocument | null>(() => {
    if (!plan) return null;
    return buildAcceptOrRegenerateSpec({
      copy,
      canAcceptPlan,
      isGeneratingPlan,
      visibleGenerationInstruction,
      acceptPlanError,
      regenerationInstruction,
    });
  }, [acceptPlanError, canAcceptPlan, copy, isGeneratingPlan, plan, regenerationInstruction, visibleGenerationInstruction]);
  const acceptOrRegenerateHandlers = useMemo(() => ({
    "accept-plan": async () => {
      if (plan) await onApplyPlan(plan);
    },
    "regenerate-plan": (params: Record<string, unknown>) => {
      const instruction = typeof params.instruction === "string" ? params.instruction : regenerationInstruction;
      onGeneratePlan({ userInstruction: instruction });
    },
  }), [onApplyPlan, onGeneratePlan, plan, regenerationInstruction]);
  const commandCenterActionHandlers = useMemo(() => ({
    "submit-checkpoint": async (params: Record<string, unknown>) => {
      if (!onSubmitCheckpointAction) throw new Error("Checkpoint actions are not available for this view.");
      const checkpointId = typeof params.checkpointId === "string"
        ? params.checkpointId
        : currentExecution?.checkpoint?.id;
      const actionId = typeof params.actionId === "string" ? params.actionId : null;
      if (!checkpointId || !actionId) throw new Error("Checkpoint action payload is incomplete.");
      const rawValues = (params.values ?? {}) as Record<string, unknown>;
      const values = Object.fromEntries(
        Object.entries(rawValues).filter(([, value]) => typeof value === "string" && value.trim()),
      ) as Record<string, string>;
      const payloadValue = Object.values(values)[0];
      return onSubmitCheckpointAction({
        checkpointId,
        action: actionId as SubmitCheckpointActionInput["action"],
        ...(payloadValue ? { payload: payloadValue } : {}),
      });
    },
  }), [currentExecution?.checkpoint?.id, onSubmitCheckpointAction]);
  const handleAcceptOrRegenerateStateChange = useCallback((changes: Array<{ path: string; value: unknown }>) => {
    const instructionChange = changes.find((change) => change.path === "/instruction");
    if (instructionChange) {
      setRegenerationInstruction(typeof instructionChange.value === "string" ? instructionChange.value : "");
    }
  }, []);
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
          actionSpec: acceptOrRegenerateSpec,
          actionHandlers: acceptOrRegenerateHandlers,
          onActionStateChange: handleAcceptOrRegenerateStateChange,
        }
      : {}),
    ...(primaryActionDescriptor.kind === "current-operation" && currentOperationNode
      ? {
          actionSpec: apiCurrentOperationSpec ?? currentOperationAction.spec,
          actionHandlers: currentOperationAction.handlers,
          onActionStateChange: currentOperationAction.onStateChange,
        }
      : {}),
  };
  const handlePlanNodeChange = useCallback((
    node: PlanNodeDataModel | null,
    nodes: PlanNodeDataModel[],
  ) => {
    handleSelectedPlanNodeChange(node, nodes);
  }, [handleSelectedPlanNodeChange]);
  const focusNodeActions = (nodeId?: string) => {
    if (nodeId && graphPlan) {
      const node =
        graphPlan.nodes.find((candidate) => candidate.id === nodeId) ?? null;
      if (node) {
        handleSelectedPlanNodeChange(node, [node]);
      }
    }
    setPreferredNodeDetailTab("result");

    const actionsPanel = document.getElementById("task-workspace-node-actions");
    if (typeof actionsPanel?.scrollIntoView === "function") {
      actionsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  const handleBackToTask = useCallback(() => {
    handleSelectedPlanNodeChange(null, []);
  }, [handleSelectedPlanNodeChange]);

  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className="relative flex flex-col overflow-visible rounded-[1.75rem] border border-border/80 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--canvas)_88%,var(--background)),var(--canvas))] p-2.5 pb-0 shadow-[0_18px_60px_rgba(15,23,42,0.08)] xl:min-h-0 xl:flex-1 xl:overflow-hidden"
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

      <div className="relative flex min-h-[680px] flex-1 flex-col gap-2.5 xl:min-h-0">
        <div className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section
            aria-label={copy.executionFlow ?? "Execution flow"}
            className="min-h-0 min-w-0 overflow-hidden rounded-[1.25rem] border border-border/60 bg-background/55 shadow-sm"
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
          <TaskWorkspaceInspector
            key={commandCenterScopeKey}
            taskId={pageData.task.id}
            scope={inspectorScope}
            consoleView={consoleView}
            primaryAction={primaryAction}
            commandCenter={pageData.commandCenter ?? null}
            commandCenterActionHandlers={commandCenterActionHandlers}
            runtimeEvents={runtimeEvents}
            liveActivity={liveActivity}
            commandCenterCopy={commandCenterCopy}
            copy={copy}
            selectedNodes={selectedPlanNodes}
            selectedNodeRuntimeEvents={selectedNodeRuntimeEvents}
            nodeActivity={nodeActivityQuery.data?.items ?? []}
            isNodeActivityLoading={nodeActivityQuery.isLoading || nodeActivityQuery.isFetching}
            preferredNodeDetailTab={preferredNodeDetailTab}
            onPreferredNodeDetailTabApplied={() => setPreferredNodeDetailTab(null)}
            onAction={focusNodeActions}
            onBackToTask={handleBackToTask}
            planGenerationPanel={shouldShowPlanGenerationPanel ? (
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
          />
        </div>
      </div>
    </section>
  );
}
