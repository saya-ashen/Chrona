import { useEffect, useMemo, useState } from "react";
import type { PlanNodeDataModel } from "../plan/task-plan-graph/types";
import type { SubmitCheckpointActionInput } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { useActionSpecRenderConfig } from "@features/execution-monitoring/ui";
import {
  createTaskWorkspaceExecutionConsoleView,
  pickWorkspaceCurrentNode,
} from "../model/task-workspace-query";
import { deriveTaskWorkspaceDisplayState } from "../model/task-workspace-interaction";
import { dispatchInputForPrimaryAction } from "../model/task-workspace-primary-action";
import { resolveTaskWorkspaceOperationState } from "../model/task-workspace-operation-machine";
import {
  derivePreferredGraphMode,
  graphNodeIdForAction,
  hasCompletedGraphExecution,
  hasNodeActionPayload,
  hasStartedGraphExecution,
  isCompletedGraphNode,
  isCompletedTaskStatus,
} from "./task-workspace-plan-utils";
import type { TaskWorkspacePlanSectionProps } from "./task-workspace-plan-section-contract";
type TaskPrimaryAction = NonNullable<TaskWorkspacePlanSectionProps["pageData"]["task"]["executionSummary"]>["primaryAction"];

export function useTaskWorkspacePlanSectionRuntime(props: TaskWorkspacePlanSectionProps) {
  const state = usePlanSectionState(props);
  const context = usePlanSectionContext(props, state);
  const resultChanges = useResultChanges(props, state, context.copy);
  return { ...state, ...context, ...resultChanges };
}

function usePlanSectionState({ plan, planGenerationStatus, graphPlan, pageData }: Pick<TaskWorkspacePlanSectionProps, "plan" | "planGenerationStatus" | "graphPlan" | "pageData">) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [submittedRevisionInstruction, setSubmittedRevisionInstruction] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<PlanNodeDataModel | null>(null);
  const [isRequestingResultChanges, setIsRequestingResultChanges] = useState(false);
  const [resultChangeInstruction, setResultChangeInstruction] = useState("");
  const [resultChangeError, setResultChangeError] = useState<string | null>(null);
  const [isSubmittingResultChanges, setIsSubmittingResultChanges] = useState(false);
  const [graphMode, setGraphMode] = useState<"full" | "compact">("full");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const isGeneratingPlan = planGenerationStatus === "generating";
  const hasGraphExecutionStarted = hasStartedGraphExecution(graphPlan);
  const hasTaskCompleted = isCompletedTaskStatus(pageData.task.status) || hasCompletedGraphExecution(graphPlan);
  useEffect(() => setSubmittedRevisionInstruction(null), [plan?.id, plan?.revision]);
  useEffect(() => {
    setGraphMode((currentMode) => derivePreferredGraphMode({ currentMode, isGeneratingPlan, hasGraphExecutionStarted, hasTaskCompleted }));
  }, [hasGraphExecutionStarted, hasTaskCompleted, isGeneratingPlan]);
  return { regenerationInstruction, setRegenerationInstruction, submittedRevisionInstruction, setSubmittedRevisionInstruction, selectedNode, setSelectedNode, isRequestingResultChanges, setIsRequestingResultChanges, resultChangeInstruction, setResultChangeInstruction, resultChangeError, setResultChangeError, isSubmittingResultChanges, setIsSubmittingResultChanges, graphMode, setGraphMode, recoveryError, setRecoveryError, isGeneratingPlan, hasGraphExecutionStarted, hasTaskCompleted };
}

function usePlanSectionContext(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const recovery = useRecoveryActions(props, state.setRecoveryError);
  const consoleView = useConsoleView(props, state.selectedNode, copy);
  const operation = usePlanOperation(props, state, consoleView);
  return {
    copy,
    consoleView,
    displayState: deriveTaskWorkspaceDisplayState({ pageData: props.pageData, graphPlan: props.graphPlan, operationState: operation.operationState, currentNode: operation.currentOperationNode, inspectedNode: state.selectedNode }),
    ...recovery,
    ...operation,
    ...getContextPresentation(props, state, consoleView, copy),
  };
}

function useConsoleView(props: TaskWorkspacePlanSectionProps, selectedNode: PlanNodeDataModel | null, copy: ReturnType<typeof useI18n>["messages"]["components"]["taskWorkspace"]) {
  return useMemo(() => createTaskWorkspaceExecutionConsoleView({ pageData: props.pageData, graphPlan: props.graphPlan, selectedNode, copy }), [props.pageData, props.graphPlan, selectedNode, copy]);
}

function getContextPresentation(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>, consoleView: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>, copy: ReturnType<typeof useI18n>["messages"]["components"]["taskWorkspace"]) {
  return {
    ...getContextIdentifiers(props, state),
    ...getContextRecovery(props),
    stateMessage: getStateMessage(consoleView, props.planGenerationStatus, copy),
  };
}

function getContextIdentifiers(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>) {
  return {
    focusNodeActions: focusNodeActions,
    commandCenterScopeKey: props.pageData.task.currentWorkBlock?.id ?? props.pageData.task.id,
    visibleGenerationInstruction: state.submittedRevisionInstruction ?? props.plan?.prompt?.trim() ?? props.generationUserInstruction?.trim() ?? null,
    isPlanAccepted: props.plan?.status === "accepted",
  };
}

function getContextRecovery(props: TaskWorkspacePlanSectionProps) {
  return {
    recoveryActions: props.pageData.reconciliation?.repairActions ?? [],
    recoveryIssue: props.pageData.reconciliation?.issues.find(isRecoveryError) ?? null,
    recoveryCurrentNodeId: props.pageData.reconciliation?.currentNodeId ?? undefined,
  };
}

function isRecoveryError(issue: { severity: string }) {
  return issue.severity === "error";
}

function focusNodeActions(nodeId?: string) {
  if (nodeId) document.getElementById("task-workspace-node-actions")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function getStateMessage(consoleView: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>, planGenerationStatus: TaskWorkspacePlanSectionProps["planGenerationStatus"], copy: ReturnType<typeof useI18n>["messages"]["components"]["taskWorkspace"]) {
  if (consoleView.states.errorMessage) return consoleView.states.errorMessage;
  if (consoleView.states.isPermissionLimited) return consoleView.task.runnabilitySummary;
  if (consoleView.states.isStale) return consoleView.states.treatment.guidance;
  if (planGenerationStatus === "generating") return copy.generatingFreshPlan ?? "Generating a fresh plan. The graph will update when the run completes.";
  return null;
}

function useRecoveryActions({ onDispatchExecutionAction, onGeneratePlan }: Pick<TaskWorkspacePlanSectionProps, "onDispatchExecutionAction" | "onGeneratePlan">, setRecoveryError: (error: string | null) => void) {
  const restartPlanFromBeginning = async (prompt?: string) => {
    setRecoveryError(null);
    try { await onDispatchExecutionAction({ action: "restart_from_beginning", ...(prompt ? { prompt } : {}) }); }
    catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : "Failed to restart plan"); throw cause; }
  };
  const regeneratePlanForRecovery = async (instruction?: string) => {
    setRecoveryError(null);
    try { onGeneratePlan({ userInstruction: instruction ?? null, replaceActiveExecution: true }); }
    catch (cause) { setRecoveryError(cause instanceof Error ? cause.message : "Failed to regenerate plan"); throw cause; }
  };
  return { restartPlanFromBeginning, regeneratePlanForRecovery };
}

function usePlanOperation(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>, consoleView: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>) {
  const currentOperationNode = getCurrentOperationNode(props.graphPlan, props.currentExecution);
  const taskPrimaryAction = props.pageData.task.executionSummary?.primaryAction ?? null;
  const primaryActionDispatch = getPrimaryActionDispatch(taskPrimaryAction, props);
  const operationAction = useOperationAction(props, currentOperationNode, consoleView);
  const currentOperationHandlers = getOperationHandlers(props, operationAction);
  const operationState = getOperationState({ props, state, currentOperationNode, taskPrimaryAction, operationAction, currentOperationHandlers });
  return { currentOperationNode, operationState, primaryActionDispatch, commandCenterActionHandlers: operationAction.commandCenterActionHandlers };
}

function getPrimaryActionDispatch(action: TaskPrimaryAction | null | undefined, props: TaskWorkspacePlanSectionProps) {
  return action ? dispatchInputForPrimaryAction(action, graphNodeIdForAction(action, props.pageData, props.graphPlan)) : null;
}

function useOperationAction(props: TaskWorkspacePlanSectionProps, currentOperationNode: ReturnType<typeof getCurrentOperationNode>, consoleView: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>) {
  const hasCurrentOperationControls = Boolean(props.currentExecution?.checkpoint || (currentOperationNode?.checkpoint && hasNodeActionPayload(currentOperationNode) && !consoleView.nodeDetail.disabledActionReason));
  const currentOperationAction = useActionSpecRenderConfig({ node: currentOperationNode, disabledActionReason: consoleView.nodeDetail.disabledActionReason, onDispatchExecutionAction: props.onDispatchExecutionAction, onSubmitCheckpointAction: props.onSubmitCheckpointAction });
  const apiCurrentOperationSpec = props.currentExecution?.ui?.currentOperationSpec ?? null;
  const commandCenterActionHandlers = useCheckpointActionHandlers(props.currentExecution?.checkpoint?.id, props.onSubmitCheckpointAction);
  const currentOperationSpec = getCurrentOperationSpec(Boolean(props.currentExecution?.checkpoint), apiCurrentOperationSpec, hasCurrentOperationControls, currentOperationAction.spec);
  return { hasCurrentOperationControls, currentOperationAction, apiCurrentOperationSpec, commandCenterActionHandlers, currentOperationSpec };
}

function getOperationHandlers(props: TaskWorkspacePlanSectionProps, action: ReturnType<typeof useOperationAction>) {
  return useMemo(() => props.currentExecution?.checkpoint && action.apiCurrentOperationSpec ? action.commandCenterActionHandlers : { ...action.commandCenterActionHandlers, ...action.currentOperationAction.handlers }, [action.apiCurrentOperationSpec, action.commandCenterActionHandlers, action.currentOperationAction.handlers, props.currentExecution?.checkpoint]);
}

function getOperationState({ props, state, currentOperationNode: currentNode, taskPrimaryAction, operationAction: action, currentOperationHandlers }: {
  props: TaskWorkspacePlanSectionProps;
  state: ReturnType<typeof usePlanSectionState>;
  currentOperationNode: ReturnType<typeof getCurrentOperationNode>;
  taskPrimaryAction: TaskPrimaryAction | null | undefined;
  operationAction: ReturnType<typeof useOperationAction>;
  currentOperationHandlers: ReturnType<typeof getOperationHandlers>;
}) {
  return resolveTaskWorkspaceOperationState({ plan: props.plan, planGenerationStatus: props.planGenerationStatus, canAcceptPlan: props.canAcceptPlan, acceptPlanError: props.acceptPlanError, generationUserInstruction: props.generationUserInstruction, graphPlan: props.graphPlan, pageData: props.pageData, currentNode, selectedNode: state.selectedNode, hasTaskCompleted: state.hasTaskCompleted, hasGraphExecutionStarted: state.hasGraphExecutionStarted, hasCurrentOperationControls: action.hasCurrentOperationControls, shouldShowCurrentOperation: Boolean(currentNode && (action.hasCurrentOperationControls || currentNode.status === "blocked")), currentOperationSpec: action.currentOperationSpec, currentOperationHandlers, onCurrentOperationStateChange: action.currentOperationAction.onStateChange, shouldUseTaskPrimaryAction: shouldUsePrimaryAction(props, state), taskPrimaryAction: taskPrimaryAction ?? null, runtimeEvents: props.runtimeEvents });
}

function getCurrentOperationNode(graphPlan: TaskWorkspacePlanSectionProps["graphPlan"], currentExecution: TaskWorkspacePlanSectionProps["currentExecution"]) {
  const node = pickWorkspaceCurrentNode(graphPlan);
  return node && currentExecution?.checkpoint?.nodeId === node.id ? { ...node, checkpoint: currentExecution.checkpoint, actionable: true } : node;
}

function getCurrentOperationSpec(
  hasCheckpoint: boolean,
  apiSpec: NonNullable<NonNullable<TaskWorkspacePlanSectionProps["currentExecution"]>["ui"]>["currentOperationSpec"] | null,
  hasControls: boolean,
  actionSpec: ReturnType<typeof useActionSpecRenderConfig>["spec"],
) {
  if (hasCheckpoint && apiSpec) return apiSpec;
  if (hasControls) return actionSpec;
  return apiSpec ?? actionSpec;
}

function shouldUsePrimaryAction(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>) {
  const action = props.pageData.task.executionSummary?.primaryAction;
  return Boolean(props.plan?.status === "accepted" && !state.hasTaskCompleted && action?.enabled && action.type !== "none" && action.type !== "start" && !props.currentExecution?.checkpoint);
}

function useCheckpointActionHandlers(checkpointId: string | undefined, onSubmitCheckpointAction: TaskWorkspacePlanSectionProps["onSubmitCheckpointAction"]) {
  return useMemo(() => ({ "submit-checkpoint": async (params: Record<string, unknown>) => {
    if (!onSubmitCheckpointAction) throw new Error("Checkpoint actions are not available for this view.");
    const resolvedCheckpointId = typeof params.checkpointId === "string" ? params.checkpointId : checkpointId;
    const actionId = typeof params.actionId === "string" ? params.actionId : null;
    if (!resolvedCheckpointId || !actionId) throw new Error("Checkpoint action payload is incomplete.");
    const values = filterCheckpointValues(params.values);
    return onSubmitCheckpointAction({ checkpointId: resolvedCheckpointId, action: actionId as SubmitCheckpointActionInput["action"], ...(Object.keys(values).length > 0 ? { payload: values } : {}) });
  } }), [checkpointId, onSubmitCheckpointAction]);
}

function filterCheckpointValues(rawValues: unknown): Record<string, unknown> {
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) return {};
  return Object.fromEntries(Object.entries(rawValues).filter(([, value]) => typeof value === "boolean" || (typeof value === "string" && value.trim().length > 0) || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))));
}

function useResultChanges(props: TaskWorkspacePlanSectionProps, state: ReturnType<typeof usePlanSectionState>, copy: ReturnType<typeof useI18n>["messages"]["components"]["taskWorkspace"]) {
  const lastCompletedResultNode = [...(props.graphPlan?.nodes ?? [])].reverse().find((node) => isCompletedGraphNode(node.status)) ?? null;
  const submitResultChanges = async () => {
    const instruction = state.resultChangeInstruction.trim();
    if (!instruction) { state.setResultChangeError(copy.requestChangesRequired ?? "Describe the required change before starting the rerun."); return; }
    if (!lastCompletedResultNode) { state.setResultChangeError(copy.requestChangesUnavailable ?? "No completed result step is available to rerun."); return; }
    state.setResultChangeError(null); state.setIsSubmittingResultChanges(true);
    try { await props.onDispatchExecutionAction({ action: "retry_node", nodeId: lastCompletedResultNode.id, prompt: instruction }); state.setIsRequestingResultChanges(false); state.setResultChangeInstruction(""); }
    catch (error) { state.setResultChangeError(error instanceof Error ? error.message : String(error)); }
    finally { state.setIsSubmittingResultChanges(false); }
  };
  return { submitResultChanges };
}

export type TaskWorkspacePlanSectionRuntime = ReturnType<typeof useTaskWorkspacePlanSectionRuntime>;
