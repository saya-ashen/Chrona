"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExecutionActionInput, PlanExecutionResult, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskAction } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  CommandCenterCopy,
  CommandCenterPrimaryAction,
} from "../../../../../../../features/execution-monitoring/ui/task-workspace-execution-overview";
import { useActionSpecRenderConfig } from "../../../../../../../features/execution-monitoring/ui/action-tab";
import { TaskWorkspaceInspector } from "../../../../../../../features/execution-monitoring/ui/task-workspace-inspector";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import {
  createTaskWorkspaceExecutionConsoleView,
  type TaskExecutionDispatchResult,
} from "../../../../../../../features/task-workspace";
import {
  dispatchInputForPrimaryAction,
  resolveCommandCenterPrimaryAction,
} from "../../../../../../../features/task-workspace";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { TaskPageData, TaskPlanGenerationStatus, WorkspaceActivityItem } from "../../../../../../../features/task-workspace";
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

export function derivePreferredGraphMode(input: {
  currentMode: "full" | "compact";
  isGeneratingPlan: boolean;
  hasGraphExecutionStarted: boolean;
  hasTaskCompleted: boolean;
}): "full" | "compact" {
  if (input.isGeneratingPlan) return "full";
  if (input.hasGraphExecutionStarted || input.hasTaskCompleted) return "compact";
  return input.currentMode;
}

export function recoveryActionButtonVariant(actionType: TaskAction["type"]): "default" | "outline" | "destructive" {
  if (actionType === "cancel" || actionType === "cancel_execution") return "destructive";
  if (actionType === "retry_sync" || actionType === "repair_inconsistency" || actionType === "replan_from_node") return "default";
  return "outline";
}

function graphNodeIdForAction(action: TaskAction | null | undefined, pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null) {
  return action?.targetNodeId
    ?? pageData.task.executionSummary?.currentNodeId
    ?? graphPlan?.currentStepId
    ?? graphPlan?.nodes.find((node) => node.status === "failed" || node.status === "blocked")?.id
    ?? null;
}

type WorkspaceCopy = Record<string, string | undefined>;

function NodeDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

function PlanNodeDetailCard({ node, copy }: { node: PlanNodeDataModel | null; copy: WorkspaceCopy }) {
  if (!node) return null;
  const dependencies = node.dependencies?.join(", ") ?? null;
  const requiredInfo = node.requiredInfo?.join(", ") ?? null;
  return (
    <Card size="sm" className="gap-3 border-primary/20 bg-primary-soft/25 py-3" role="region" aria-label={copy.nodeDetailOverlayAria ?? "Selected node details"}>
      <CardHeader className="gap-2 px-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{copy.nodeDetailOverlayTitle ?? "Node details"}</p>
            <CardTitle className="mt-1 truncate text-sm">{node.title}</CardTitle>
          </div>
          <Badge variant="outline">{node.statusLabel ?? node.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3">
        <NodeDetailRow label="Objective" value={node.objective} />
        <NodeDetailRow label="Summary" value={node.summary} />
        <NodeDetailRow label="Next action" value={node.nextAction} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <NodeDetailRow label="Mode" value={node.executionMode ?? node.interactionType ?? null} />
          <NodeDetailRow label="Executor" value={node.executor} />
          <NodeDetailRow label="Estimate" value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
          <NodeDetailRow label="Depends on" value={dependencies} />
        </div>
        <NodeDetailRow label="Required info" value={requiredInfo} />
      </CardContent>
    </Card>
  );
}

function PlanRevisionPanel({
  copy,
  canAcceptPlan,
  isGeneratingPlan,
  visibleGenerationInstruction,
  acceptPlanError,
  revisionInstruction,
  selectedNode,
  onInstructionChange,
  onAcceptPlan,
  onRevisePlan,
}: {
  copy: WorkspaceCopy;
  canAcceptPlan?: boolean;
  isGeneratingPlan: boolean;
  visibleGenerationInstruction: string | null;
  acceptPlanError: string | null;
  revisionInstruction: string;
  selectedNode: PlanNodeDataModel | null;
  onInstructionChange: (value: string) => void;
  onAcceptPlan: () => void;
  onRevisePlan: () => void;
}) {
  return (
    <Card size="sm" className="border-primary/15 bg-background/85 py-3" role="region" aria-label={copy.planRevisionTitle ?? "Plan revision"}>
      <CardHeader className="gap-1 px-3">
        <CardTitle className="text-sm">{copy.planRevisionTitle ?? "Revise plan"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {selectedNode
            ? `Ask Chrona to revise selected step: ${selectedNode.title}`
            : (copy.planRevisionIntro ?? "Ask Chrona to revise this draft plan.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 px-3">
        {visibleGenerationInstruction ? (
          <div className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-2 text-xs">
            <div className="font-medium text-muted-foreground">{copy.instructionLabel ?? "Last revision request"}</div>
            <div className="mt-1 text-foreground">{visibleGenerationInstruction}</div>
          </div>
        ) : null}
        <label className="block space-y-1.5 text-xs font-medium text-foreground">
          <span>{copy.instructionAria ?? "Plan revision message"}</span>
          <Textarea
            value={revisionInstruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={copy.instructionPlaceholder ?? "Tell Chrona what to change in this draft plan..."}
            rows={3}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onAcceptPlan} disabled={!canAcceptPlan}>
            {copy.acceptPlan ?? copy.accept ?? "Accept plan"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onRevisePlan} disabled={isGeneratingPlan}>
            {isGeneratingPlan ? (copy.generating ?? "Revising...") : (copy.revisePlanWithAi ?? "Ask AI to revise plan")}
          </Button>
        </div>
        {acceptPlanError ? <p className="text-xs text-destructive">{acceptPlanError}</p> : null}
      </CardContent>
    </Card>
  );
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
  runtimeEvents: WorkspaceRuntimeEvent[];
  commandCenter?: NonNullable<TaskPageData["commandCenter"]> | null;
  liveActivity?: WorkspaceActivityItem[];
  currentExecution?: PlanExecutionResult | null;
  generationUserInstruction?: string | null;
  onGeneratePlan: (request?: PlanGenerationRequest) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
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
  commandCenter,
  plan,
  planGenerationStatus,
  canAcceptPlan,
  acceptPlanError,
  generationUserInstruction,
  runtimeEvents,
  liveActivity = [],
  currentExecution,
  onGeneratePlan,
  onApplyPlan,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
}: TaskWorkspacePlanSectionProps) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [selectedNode, setSelectedNode] = useState<PlanNodeDataModel | null>(null);
  const [graphMode, setGraphMode] = useState<"full" | "compact">("full");
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const consoleView = useMemo(
    () => createTaskWorkspaceExecutionConsoleView({
      pageData,
      graphPlan,
      selectedNode,
      copy,
    }),
    [pageData, graphPlan, selectedNode, copy],
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
  const hasGraphExecutionStarted = hasStartedGraphExecution(graphPlan);
  const hasTaskCompleted = isCompletedTaskStatus(pageData.task.status) || hasCompletedGraphExecution(graphPlan);
  useEffect(() => {
    setGraphMode((currentMode) => derivePreferredGraphMode({
      currentMode,
      isGeneratingPlan,
      hasGraphExecutionStarted,
      hasTaskCompleted,
    }));
  }, [hasGraphExecutionStarted, hasTaskCompleted, isGeneratingPlan]);
  const currentOperationNode = consoleView.nodeDetail.currentNode;
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
    taskPrimaryAction.type !== "start"
  );
  const hasCurrentOperationControls = Boolean(currentOperationNode?.checkpoint) && hasNodeActionPayload(currentOperationNode) && !consoleView.nodeDetail.disabledActionReason;
  const shouldShowCurrentOperation = Boolean(currentOperationNode && (hasCurrentOperationControls || currentOperationNode.status === "blocked"));
  const visibleGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const commandCenterScopeKey = pageData.task.currentWorkBlock?.id ?? pageData.task.id;
  const currentOperationAction = useActionSpecRenderConfig({
    node: currentOperationNode,
    disabledActionReason: consoleView.nodeDetail.disabledActionReason,
    onDispatchExecutionAction,
    onSubmitCheckpointAction,
  });
  const apiCurrentOperationSpec = currentExecution?.ui?.currentOperationSpec ?? null;
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
        Object.entries(rawValues).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
      ) as Record<string, string>;
      const payloadValue = Object.values(values)[0];
      return onSubmitCheckpointAction({
        checkpointId,
        action: actionId as SubmitCheckpointActionInput["action"],
        ...(payloadValue ? { payload: payloadValue } : {}),
      });
    },
  }), [currentExecution?.checkpoint?.id, onSubmitCheckpointAction]);
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
    currentOperationTone: consoleView.attention?.tone ?? consoleView.readiness.tone,
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
    ...(primaryActionDescriptor.kind === "current-operation" && currentOperationNode
      ? {
          actionSpec: apiCurrentOperationSpec ?? currentOperationAction.spec,
          actionHandlers: currentOperationAction.handlers,
          onActionStateChange: currentOperationAction.onStateChange,
        }
      : {}),
  };
  const focusNodeActions = (nodeId?: string) => {
    if (!nodeId) return;

    const actionsPanel = document.getElementById("task-workspace-node-actions");
    if (typeof actionsPanel?.scrollIntoView === "function") {
      actionsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };


  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className="relative flex flex-col overflow-visible rounded-[1.75rem] border border-border/80 bg-muted/20 p-2 shadow-[0_18px_60px_rgba(15,23,42,0.06)] xl:min-h-0 xl:flex-1 xl:overflow-hidden"
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
                  variant={recoveryActionButtonVariant(action.type)}
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

      <div className={graphMode === "compact"
        ? "grid min-h-[680px] flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,0.44fr)_minmax(36rem,1.56fr)]"
        : "grid min-h-[680px] flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]"}>
        <section
          aria-label={copy.executionFlow ?? "Execution flow"}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/75"
        >
          <div className="min-h-0 flex-1">
            <TaskWorkspacePlanContent
              label={label}
              graphPlan={graphPlan}
              isGraphPlanPending={isGraphPlanPending}
              plan={plan}
              acceptPlanError={acceptPlanError}
              planGenerationStatus={planGenerationStatus}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
              onGeneratePlan={() => onGeneratePlan()}
              onSelectedNodeChange={setSelectedNode}
            />
          </div>
          {plan && !isPlanAccepted ? (
            <div className={selectedNode ? "grid shrink-0 gap-2 border-t border-border/55 bg-muted/20 p-2 lg:grid-cols-[minmax(0,0.92fr)_minmax(22rem,1.08fr)]" : "grid shrink-0 gap-2 border-t border-border/55 bg-muted/20 p-2"}>
              <PlanNodeDetailCard node={selectedNode} copy={copy} />
              <PlanRevisionPanel
                copy={copy}
                canAcceptPlan={canAcceptPlan}
                isGeneratingPlan={isGeneratingPlan}
                visibleGenerationInstruction={visibleGenerationInstruction}
                acceptPlanError={acceptPlanError}
                revisionInstruction={regenerationInstruction}
                selectedNode={selectedNode}
                onInstructionChange={setRegenerationInstruction}
                onAcceptPlan={() => {
                  if (plan) void onApplyPlan(plan);
                }}
                onRevisePlan={() => onGeneratePlan({ userInstruction: regenerationInstruction, selectedNodeId: selectedNode?.id ?? null })}
              />
            </div>
          ) : selectedNode ? (
            <div className="shrink-0 border-t border-border/55 bg-muted/20 p-2">
              <PlanNodeDetailCard node={selectedNode} copy={copy} />
            </div>
          ) : null}
        </section>
        <TaskWorkspaceInspector
          key={commandCenterScopeKey}
          taskId={pageData.task.id}
          consoleView={consoleView}
          primaryAction={primaryAction}
          commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
          commandCenterActionHandlers={commandCenterActionHandlers}
          runtimeEvents={runtimeEvents}
          liveActivity={liveActivity}
          currentExecution={currentExecution}
          commandCenterCopy={commandCenterCopy}
          isPlanCompact={graphMode === "compact"}
          copy={copy}
          onAction={focusNodeActions}
        />
      </div>
    </section>
  );
}
