"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { ExecutionActionInput, PlanExecutionResult, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskAction } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n/react";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { CommandCenterCopy } from "../../../../../../../features/execution-monitoring/ui/task-workspace-execution-overview";
import { useActionSpecRenderConfig } from "../../../../../../../features/execution-monitoring/ui/action-tab";
import { TaskWorkspaceInspector } from "../../../../../../../features/execution-monitoring/ui/task-workspace-inspector";
import { TaskWorkspacePlanContent } from "./task-workspace-plan-content";
import { TaskWorkspaceOperationPanel } from "./task-workspace-operation-panel";
import type { PlanGenerationRequest, WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import {
  createTaskWorkspaceExecutionConsoleView,
  type TaskExecutionDispatchResult,
} from "../../../../../../../features/task-workspace";
import {
  deriveTaskWorkspaceDisplayState,
  dispatchInputForPrimaryAction,
  FOLLOW_UP_INTENTS,
  resolveTaskWorkspaceOperationState,
} from "../../../../../../../features/task-workspace";
import type { TaskPageData, TaskPlanGenerationStatus, TaskWorkspaceDisplayState, WorkspaceActivityItem } from "../../../../../../../features/task-workspace";
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
        {node.availableActions?.length ? (
          <div className="space-y-1.5 rounded-lg border border-border/55 bg-background/70 p-2" data-ui-surface-kind="runtime-control">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick actions</p>
            <div className="flex flex-wrap gap-1.5">
              {node.availableActions.map((action) => (
                <Button key={action.id} type="button" size="sm" variant={action.emphasis === "primary" ? "default" : action.emphasis === "danger" ? "destructive" : "outline"} className="h-7 px-2 text-xs">
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {node.options?.length || node.branchLabels?.length ? (
          <div className="space-y-1.5 rounded-lg border border-border/55 bg-muted/25 p-2" data-ui-surface-kind="runtime-control">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision options</p>
            <div className="flex flex-wrap gap-1.5">
              {[...(node.options ?? []), ...(node.branchLabels ?? [])].map((option) => <Badge key={option} variant="outline">{option}</Badge>)}
            </div>
          </div>
        ) : null}
        <NodeDetailRow label="Required info" value={requiredInfo} />
      </CardContent>
    </Card>
  );
}

function StageBarCard({ stage }: { stage: TaskWorkspaceDisplayState["stage"] }) {
  const stages: Array<{ id: typeof stage.stage; label: string }> = [
    { id: "brief", label: "Brief" },
    { id: "plan", label: "Plan" },
    { id: "review", label: "Review" },
    { id: "run", label: "Run" },
    { id: "result", label: "Result" },
  ];
  const activeIndex = stages.findIndex((item) => item.id === stage.stage);
  return (
    <Card size="sm" className="border-border bg-card py-4 text-foreground" data-ui-surface-kind="runtime-control">
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]" aria-label="Task stage">
          {stages.map((item, index) => (
            <span
              key={item.id}
              className={index === activeIndex ? "rounded-full bg-brand-lavender px-2.5 py-1 text-foreground" : index < activeIndex ? "rounded-full bg-background px-2.5 py-1 text-foreground" : "text-muted-foreground"}
            >
              {item.label}{index < stages.length - 1 ? " →" : ""}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-heading text-xl font-medium leading-tight tracking-[-0.04em] text-foreground">{stage.statusLabel}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">Next: {stage.nextActionLabel}</p>
          </div>
          {stage.currentNodeLabel ? (
            <Badge variant={stage.tone === "critical" ? "destructive" : stage.tone === "success" ? "secondary" : "outline"} className="bg-background/75">
              {stage.currentNodeLabel}
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessPanel({ readiness, onGeneratePlan }: { readiness: TaskWorkspaceDisplayState["readiness"]; onGeneratePlan: () => void }) {
  return (
    <Card size="sm" className="border-transparent bg-brand-ochre/80 py-4 text-foreground" data-ui-surface-kind="product-authored">
      <CardHeader className="px-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Ready to plan?</CardTitle>
          <Badge variant={readiness.status === "blocked" ? "destructive" : readiness.status === "ready" ? "secondary" : "outline"} className="bg-background/80">{readiness.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {readiness.checks.map((check) => (
            <div key={check.id} className="rounded-2xl border border-background/70 bg-background/55 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span aria-hidden>{check.state === "passed" ? "✓" : check.state === "blocked" ? "×" : "!"}</span>
                <span>{check.label}</span>
              </div>
              {check.state !== "passed" && check.helperText ? <p className="mt-0.5 text-[11px] text-foreground/70">{check.helperText}</p> : null}
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-dashed border-foreground/25 bg-background/45 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/65">Plan intent presets</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["Research", "Build", "Review", "Monitor", "Write report"].map((preset) => <Badge key={preset} variant="outline" className="bg-background/70">{preset}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onGeneratePlan} disabled={readiness.primaryAction === "configure_provider"}>
            {readiness.primaryAction === "configure_provider" ? "Configure provider" : "Generate plan"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="bg-background/70">Improve task brief</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {(items.length > 0 ? items : [empty]).map((item) => <li key={item}>- {item}</li>)}
      </ul>
    </div>
  );
}

function PlanReviewSummaryCard({ summary }: { summary: NonNullable<TaskWorkspaceDisplayState["planReviewSummary"]> }) {
  return (
    <Card size="sm" className="border-transparent bg-brand-peach/80 py-4" data-ui-surface-kind="product-authored">
      <CardHeader className="px-4 pb-1">
        <CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Plan review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-xs">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="bg-background/75">{summary.stepCount} plan steps</Badge>
          <Badge variant="outline" className="bg-background/75">{summary.aiStepCount} AI steps</Badge>
          <Badge variant="outline" className="bg-background/75">{summary.checkpointCount} checkpoints</Badge>
          {summary.estimatedMinutes ? <Badge variant="outline" className="bg-background/75">~{summary.estimatedMinutes} min</Badge> : null}
        </div>
        {summary.changeSummary ? (
          <div className="rounded-2xl border border-background/70 bg-background/60 p-3">
            <p className="font-semibold text-foreground">Plan diff review</p>
            <p className="mt-1 text-foreground/70">{summary.changeSummary}</p>
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-3">
          <SummaryList title="Will produce" items={summary.outputIntents} empty="Task result" />
          <SummaryList title="Needs you" items={summary.needsUser} empty="No planned manual stop" />
          <SummaryList title="Potential risks" items={summary.risks} empty="No obvious risk flagged" />
        </div>
      </CardContent>
    </Card>
  );
}

function RunPreviewCard({ preview }: { preview: NonNullable<TaskWorkspaceDisplayState["runPreview"]> }) {
  return (
    <Card size="sm" className="border-transparent bg-brand-mint/80 py-4" data-ui-surface-kind="runtime-control">
      <CardHeader className="px-4 pb-1"><CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Run contract preview</CardTitle></CardHeader>
      <CardContent className="grid gap-3 px-4 text-xs sm:grid-cols-2">
        <NodeDetailRow label="Plan" value={preview.planVersionLabel} />
        <NodeDetailRow label="Trigger" value={preview.triggerLabel} />
        <NodeDetailRow label="Provider/runtime" value={preview.providerLabel} />
        <NodeDetailRow label="Work block" value={preview.scheduleLabel} />
        <NodeDetailRow label="Automation readiness" value={preview.automationReadinessLabel} />
        <NodeDetailRow label="Mode" value={preview.modeLabel} />
        <NodeDetailRow label="Will start at" value={preview.startNodeLabel} />
        <NodeDetailRow label="Result policy" value={preview.resultPolicyLabel} />
        <NodeDetailRow label="Previous result" value={preview.previousResultLabel ?? "No previous artifact"} />
        <SummaryList title="Expected stops" items={preview.expectedStops} empty="No planned stop" />
        <SummaryList title="Controls" items={preview.capabilityLabels} empty="Cancel and retry" />
        <SummaryList title="Output destination" items={preview.outputDestinations} empty="Task result" />
      </CardContent>
    </Card>
  );
}

function ResultReviewCard({
  review,
  onAcceptResult,
  onRequestChanges,
  isAcceptingResult = false,
  acceptResultError,
}: {
  review: NonNullable<TaskWorkspaceDisplayState["resultReview"]>;
  onAcceptResult?: () => Promise<void> | void;
  onRequestChanges?: () => void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
}) {
  return (
    <Card size="sm" className="border-transparent bg-brand-teal py-5 text-white" data-ui-surface-kind="runtime-control">
      <CardHeader className="px-5 pb-1"><CardTitle className="font-heading text-2xl font-medium tracking-[-0.04em] text-white">{review.title}</CardTitle></CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <p className="text-white/78">{review.description}</p>
        <div className="flex flex-wrap gap-2" aria-label="Result review actions">
          {review.actions.map((action) => {
            const isAccept = action.id === "accept_result";
            const isRequestChanges = action.id === "request_changes";
            return (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={action.emphasis === "primary" ? "secondary" : "outline"}
                className={action.emphasis === "primary" ? "bg-background text-foreground hover:bg-background/90" : "border-white/35 bg-transparent text-white hover:bg-white/10 hover:text-white"}
                disabled={isAccept ? isAcceptingResult || !onAcceptResult : false}
                onClick={isAccept ? () => void onAcceptResult?.() : isRequestChanges ? onRequestChanges : undefined}
              >
                {isAccept && isAcceptingResult ? "Accepting result..." : action.label}
              </Button>
            );
          })}
        </div>
        {acceptResultError ? <p role="alert" className="text-xs font-medium text-white">{acceptResultError}</p> : null}
      </CardContent>
    </Card>
  );
}

function FollowUpComposerCard({ textareaRef }: { textareaRef?: Ref<HTMLTextAreaElement> }) {
  return (
    <Card size="sm" className="border-transparent bg-card py-4" data-ui-surface-kind="product-authored">
      <CardHeader className="px-4 pb-1"><CardTitle className="font-heading text-xl font-medium tracking-[-0.03em]">Continue from result</CardTitle></CardHeader>
      <CardContent className="space-y-3 px-4 text-xs">
        <Textarea ref={textareaRef} placeholder="Ask a follow-up, request a result update, rerun a step, or create a linked follow-up task." className="min-h-24 rounded-2xl bg-background" />
        <div className="flex flex-wrap gap-1.5" aria-label="Follow-up intent">
          {FOLLOW_UP_INTENTS.map((intent) => <Badge key={intent.id} variant="outline" title={intent.description}>{intent.label}</Badge>)}
        </div>
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
  onAcceptResult?: () => Promise<void> | void;
  isAcceptingResult?: boolean;
  acceptResultError?: string | null;
};

export function TaskWorkspacePlanSection({
  label,
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
  onAcceptResult,
  isAcceptingResult = false,
  acceptResultError,
}: TaskWorkspacePlanSectionProps) {
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [submittedRevisionInstruction, setSubmittedRevisionInstruction] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<PlanNodeDataModel | null>(null);
  const followUpComposerRef = useRef<HTMLTextAreaElement>(null);
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
  useEffect(() => {
    setSubmittedRevisionInstruction(null);
  }, [plan?.id, plan?.revision]);
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
  const persistedGenerationInstruction = plan?.prompt?.trim() || generationUserInstruction?.trim() || null;
  const visibleGenerationInstruction = submittedRevisionInstruction ?? persistedGenerationInstruction;
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
  const currentOperationSpec = apiCurrentOperationSpec ?? currentOperationAction.spec;
  const currentOperationHandlers = useMemo(() => ({
    ...commandCenterActionHandlers,
    ...currentOperationAction.handlers,
  }), [commandCenterActionHandlers, currentOperationAction.handlers]);
  const operationState = resolveTaskWorkspaceOperationState({
    plan,
    planGenerationStatus,
    canAcceptPlan,
    acceptPlanError,
    generationUserInstruction,
    graphPlan,
    pageData,
    currentNode: currentOperationNode,
    selectedNode,
    hasTaskCompleted,
    hasGraphExecutionStarted,
    hasCurrentOperationControls,
    shouldShowCurrentOperation: shouldShowCurrentOperation && Boolean(currentOperationNode),
    currentOperationSpec,
    currentOperationHandlers,
    onCurrentOperationStateChange: currentOperationAction.onStateChange,
    shouldUseTaskPrimaryAction,
    taskPrimaryAction,
    runtimeEvents,
  });
  const displayState = deriveTaskWorkspaceDisplayState({
    pageData,
    graphPlan,
    operationState,
    currentNode: currentOperationNode ?? selectedNode,
  });
  const focusNodeActions = (nodeId?: string) => {
    if (!nodeId) return;

    const actionsPanel = document.getElementById("task-workspace-node-actions");
    if (typeof actionsPanel?.scrollIntoView === "function") {
      actionsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  const revisionPanel = plan ? (
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
        void onApplyPlan(plan);
      }}
      onRevisePlan={() => {
        const userInstruction = regenerationInstruction.trim();
        setSubmittedRevisionInstruction(userInstruction || null);
        setRegenerationInstruction("");
        onGeneratePlan({ userInstruction, selectedNodeId: selectedNode?.id ?? null });
      }}
    />
  ) : null;


  return (
    <section
      aria-label={copy.executionWorkspaceAria ?? "Task execution workspace"}
      className="relative flex flex-col overflow-visible rounded-[2rem] border border-border bg-surface-soft/80 p-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden"
    >
      {stateMessage ? (
        <div
          className="relative mb-3 rounded-2xl border border-warning/40 bg-warning/20 px-4 py-3 text-sm text-warning-foreground"
          role="status"
        >
          {stateMessage}
        </div>
      ) : null}

      {recoveryIssue ? (
        <div
          className="relative mb-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
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

      {displayState.panels.stageBar || displayState.panels.readiness ? (
        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.6fr)]">
          {displayState.panels.stageBar ? <StageBarCard stage={displayState.stage} /> : null}
          {displayState.panels.readiness ? <ReadinessPanel readiness={displayState.readiness} onGeneratePlan={() => onGeneratePlan()} /> : null}
        </div>
      ) : null}

      {displayState.layout === "result_focus" ? (
        <div className="grid min-h-[560px] flex-1 gap-3 xl:min-h-0">
          <TaskWorkspaceInspector
            key={commandCenterScopeKey}
            taskId={pageData.task.id}
            consoleView={consoleView}
            commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
            commandCenterActionHandlers={commandCenterActionHandlers}
            runtimeEvents={runtimeEvents}
            liveActivity={liveActivity}
            currentExecution={currentExecution}
            isPlanCompact
            copy={copy}
            onAction={focusNodeActions}
            operationPanel={(
              <div className="space-y-3">
                {displayState.panels.resultReview && displayState.resultReview ? <ResultReviewCard review={displayState.resultReview} onAcceptResult={onAcceptResult} onRequestChanges={() => followUpComposerRef.current?.focus()} isAcceptingResult={isAcceptingResult} acceptResultError={acceptResultError} /> : null}
                {displayState.panels.followUpComposer ? <FollowUpComposerCard textareaRef={followUpComposerRef} /> : null}
              </div>
            )}
          />
        </div>
      ) : (
        <div className={graphMode === "compact"
          ? "grid min-h-[560px] flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,0.42fr)_minmax(36rem,1.58fr)]"
          : "grid min-h-[560px] flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)]"}>
          <section
            aria-label={copy.executionFlow ?? "Execution flow"}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background/70"
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
              {displayState.panels.planReviewSummary || displayState.panels.runPreview ? (
                <div className="space-y-3 border-t border-border bg-card/65 p-3">
                  {displayState.panels.planReviewSummary && displayState.planReviewSummary ? <PlanReviewSummaryCard summary={displayState.planReviewSummary} /> : null}
                  {displayState.panels.runPreview && displayState.runPreview ? <RunPreviewCard preview={displayState.runPreview} /> : null}
                </div>
              ) : null}
            </div>
            {selectedNode && displayState.panels.selectedNodeDetails ? (
              <div className="shrink-0 border-t border-border bg-card/65 p-3">
                <PlanNodeDetailCard node={selectedNode} copy={copy} />
              </div>
            ) : null}
          </section>
          <TaskWorkspaceInspector
            key={commandCenterScopeKey}
            taskId={pageData.task.id}
            consoleView={consoleView}
            commandCenter={isGeneratingPlan ? null : commandCenter ?? null}
            commandCenterActionHandlers={commandCenterActionHandlers}
            runtimeEvents={runtimeEvents}
            liveActivity={liveActivity}
            currentExecution={currentExecution}
            isPlanCompact={graphMode === "compact"}
            copy={copy}
            onAction={focusNodeActions}
            operationPanel={(
              <div className="space-y-2">
                {displayState.panels.operationPanel ? (
                  <TaskWorkspaceOperationPanel
                    taskId={pageData.task.id}
                    state={operationState}
                    workState={displayState.workState}
                    copy={copy}
                    onGeneratePlan={() => onGeneratePlan()}
                    onStartPlan={() => void onDispatchExecutionAction({ action: "start_manual" })}
                    onRestartPlan={() => void onDispatchExecutionAction({ action: "restart_from_beginning" })}
                    onTaskPrimaryAction={primaryActionDispatch ? () => void onDispatchExecutionAction(primaryActionDispatch) : undefined}
                    revisionPanel={revisionPanel}
                  />
                ) : null}
                {displayState.panels.resultReview && displayState.resultReview ? <ResultReviewCard review={displayState.resultReview} onAcceptResult={onAcceptResult} onRequestChanges={() => followUpComposerRef.current?.focus()} isAcceptingResult={isAcceptingResult} acceptResultError={acceptResultError} /> : null}
                {displayState.panels.followUpComposer ? <FollowUpComposerCard textareaRef={followUpComposerRef} /> : null}
              </div>
            )}
          />
        </div>
      )}
    </section>
  );
}
