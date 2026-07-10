import { deriveWorkStateView, type WorkStateView } from "@chrona/domain";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import type { TaskPageData } from "./task-workspace-types";
import type { TaskWorkspaceOperationState } from "./task-workspace-operation-machine";

export type TaskPlanningReadiness = {
  status: "ready" | "warning" | "blocked";
  checks: Array<{
    id: string;
    label: string;
    level: "required" | "recommended" | "optional";
    state: "passed" | "missing" | "blocked";
    helperText?: string;
    action?: "edit_brief" | "configure_provider";
  }>;
  primaryAction: "generate_plan" | "complete_brief" | "configure_provider";
};

export type TaskWorkspaceStage = {
  stage: "brief" | "plan" | "review" | "run" | "result";
  statusLabel: string;
  currentNodeLabel?: string;
  nextActionLabel: string;
  primaryActionId: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
};

export type PlanReviewSummary = {
  stepCount: number;
  aiStepCount: number;
  checkpointCount: number;
  estimatedMinutes: number | null;
  outputIntents: string[];
  needsUser: string[];
  risks: string[];
  changeSummary: string | null;
};

export type RunLaunchExpectedStop = {
  id: string;
  label: string;
  kind: "input" | "approval";
};

export type RunLaunchView = {
  readiness: "ready" | "blocked" | "scheduled";
  startMode: "manual" | "automatic" | "scheduled";
  providerLabel: string;
  runtimeLabel: string;
  planVersionLabel: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  estimatedMinutes: number | null;
  stepCount: number;
  firstStepLabel: string;
  expectedStops: RunLaunchExpectedStop[];
  resultRequiresAcceptance: true;
  blockerSummary: string | null;
  recoveryAction: "connect_provider" | "edit_task" | null;
  canStartManually: boolean;
};

export type ResultReview = {
  title: string;
  description: string;
  actions: Array<{ id: "accept_result" | "ask_follow_up" | "request_changes" | "create_follow_up_task"; label: string; emphasis: "primary" | "secondary" }>;
};

export type FollowUpIntentKind = "ask_only" | "update_result" | "rerun_step" | "revise_plan" | "create_follow_up_task";

export const FOLLOW_UP_INTENTS: Array<{ id: FollowUpIntentKind; label: string; description: string }> = [
  { id: "ask_only", label: "Ask only", description: "Answer without changing task state." },
  { id: "update_result", label: "Update result", description: "Prepare a result patch for review." },
  { id: "rerun_step", label: "Rerun selected step", description: "Start from a chosen node after preview." },
  { id: "revise_plan", label: "Revise plan", description: "Generate a plan change preview." },
  { id: "create_follow_up_task", label: "Create follow-up task", description: "Draft a new task linked to this result." },
];

export type TaskWorkspaceDisplayMode =
  | "briefing"
  | "planning"
  | "reviewing_plan"
  | "ready_to_run"
  | "running"
  | "blocked"
  | "completed"
  | "done";

export type TaskWorkspacePanelKey =
  | "stageBar"
  | "readiness"
  | "planReviewSummary"
  | "planDiffReview"
  | "selectedNodeDetails"
  | "selectedNodeQuickActions"
  | "decisionCards"
  | "runPreview"
  | "operationPanel"
  | "resultReview"
  | "followUpComposer";

export type TaskWorkspacePrimarySurface = "brief" | "plan" | "execution" | "decision" | "result";

export type TaskWorkspacePrimaryAction =
  | "generate_plan"
  | "cancel_generation"
  | "accept_plan"
  | "start_run"
  | "runtime_action"
  | "recover"
  | "accept_result"
  | "follow_up";

export type TaskWorkspaceContextRail = "readiness" | "plan_review" | "run_readiness" | "current_operation" | "recovery" | "result_review" | "continuation";

export type TaskWorkspaceDisplayRule = {
  mode: TaskWorkspaceDisplayMode;
  description: string;
  layout: "brief_focus" | "plan_workbench" | "execution_focus" | "decision_focus" | "result_focus";
  primarySurface: TaskWorkspacePrimarySurface;
  primaryAction: TaskWorkspacePrimaryAction;
  contextRail: TaskWorkspaceContextRail;
  collapsedByDefault: Array<"activity" | "diagnostics" | "execution_history">;
  panels: Record<TaskWorkspacePanelKey, boolean>;
};

export type TaskWorkspaceDisplayState = TaskWorkspaceDisplayRule & {
  stage: TaskWorkspaceStage;
  workState: WorkStateView;
  readiness: TaskPlanningReadiness;
  planReviewSummary: PlanReviewSummary | null;
  runPreview: RunLaunchView | null;
  resultReview: ResultReview | null;
};

const ALL_PANEL_KEYS: TaskWorkspacePanelKey[] = [
  "stageBar",
  "readiness",
  "planReviewSummary",
  "planDiffReview",
  "selectedNodeDetails",
  "selectedNodeQuickActions",
  "decisionCards",
  "runPreview",
  "operationPanel",
  "resultReview",
  "followUpComposer",
];

function panels(enabled: TaskWorkspacePanelKey[]): Record<TaskWorkspacePanelKey, boolean> {
  return Object.fromEntries(ALL_PANEL_KEYS.map((key) => [key, enabled.includes(key)])) as Record<TaskWorkspacePanelKey, boolean>;
}

export const TASK_WORKSPACE_DISPLAY_RULES: Record<TaskWorkspaceDisplayMode, TaskWorkspaceDisplayRule> = {
  briefing: {
    mode: "briefing",
    description: "Task has no usable plan yet. Show brief quality, intent presets, and plan generation only.",
    layout: "brief_focus",
    primarySurface: "brief",
    primaryAction: "generate_plan",
    contextRail: "readiness",
    collapsedByDefault: ["activity", "diagnostics"],
    panels: panels(["stageBar", "readiness", "operationPanel"]),
  },
  planning: {
    mode: "planning",
    description: "Plan generation is active. Keep stage visible, hide review/run/result affordances.",
    layout: "brief_focus",
    primarySurface: "brief",
    primaryAction: "cancel_generation",
    contextRail: "readiness",
    collapsedByDefault: ["activity", "diagnostics"],
    panels: panels(["stageBar", "readiness", "operationPanel"]),
  },
  reviewing_plan: {
    mode: "reviewing_plan",
    description: "Draft plan needs user review. Show plan summary, diff, selected-node context, and revision controls.",
    layout: "plan_workbench",
    primarySurface: "plan",
    primaryAction: "accept_plan",
    contextRail: "plan_review",
    collapsedByDefault: ["activity"],
    panels: panels(["stageBar", "readiness", "planReviewSummary", "planDiffReview", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel"]),
  },
  ready_to_run: {
    mode: "ready_to_run",
    description: "Accepted plan is ready. Show run preview and selected-node context before start.",
    layout: "plan_workbench",
    primarySurface: "plan",
    primaryAction: "start_run",
    contextRail: "run_readiness",
    collapsedByDefault: ["activity"],
    panels: panels(["stageBar", "selectedNodeDetails", "runPreview"]),
  },
  running: {
    mode: "running",
    description: "Execution is in progress. Prioritize current operation and selected-node context.",
    layout: "execution_focus",
    primarySurface: "execution",
    primaryAction: "runtime_action",
    contextRail: "current_operation",
    collapsedByDefault: ["activity", "diagnostics"],
    panels: panels(["stageBar", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel"]),
  },
  blocked: {
    mode: "blocked",
    description: "Execution needs handling. Keep blocker resolution, decision cards, and follow-up composer visible.",
    layout: "decision_focus",
    primarySurface: "decision",
    primaryAction: "recover",
    contextRail: "recovery",
    collapsedByDefault: ["diagnostics"],
    panels: panels(["stageBar", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel", "followUpComposer"]),
  },
  completed: {
    mode: "completed",
    description: "Run completed but task result is not accepted as Done. Hide plan workbench and focus result review.",
    layout: "result_focus",
    primarySurface: "result",
    primaryAction: "accept_result",
    contextRail: "result_review",
    collapsedByDefault: ["execution_history", "activity"],
    panels: panels(["stageBar", "resultReview", "followUpComposer"]),
  },
  done: {
    mode: "done",
    description: "Task is closed. Hide plan workbench and show accepted result with lightweight follow-up only.",
    layout: "result_focus",
    primarySurface: "result",
    primaryAction: "follow_up",
    contextRail: "continuation",
    collapsedByDefault: ["execution_history", "activity"],
    panels: panels(["stageBar", "resultReview", "followUpComposer"]),
  },
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isCompletedStatus(status: string | null | undefined) {
  const value = normalized(status);
  return value === "completed" || value === "done" || value === "complete";
}

function nodeType(node: PlanNodeDataModel) {
  return node.type ?? node.displayType ?? node.kind;
}

function isAiNode(node: PlanNodeDataModel) {
  const executor = normalized(node.executor ?? node.executionMode ?? "");
  return executor.includes("ai") || executor.includes("agent") || executor.includes("auto") || executor.includes("hermes") || executor.includes("omp");
}

function nodeOutputIntent(node: PlanNodeDataModel) {
  const text = [node.title, node.summary, node.objective, node.nextAction, ...(node.badges ?? [])].join(" ").toLowerCase();
  if (text.includes("file") || text.includes("artifact") || text.includes("patch") || text.includes("pr")) return node.title;
  if (text.includes("report") || text.includes("summary") || text.includes("result") || text.includes("output")) return node.title;
  if (node.result || node.completionSummary) return node.title;
  return null;
}

function nodeRisk(node: PlanNodeDataModel) {
  const text = [node.title, node.summary, node.objective, node.nextAction, ...(node.badges ?? [])].join(" ").toLowerCase();
  if (text.includes("delete") || text.includes("write") || text.includes("commit") || text.includes("deploy")) return `${node.title}: may change external state`;
  if (text.includes("web") || text.includes("network") || text.includes("api") || text.includes("github")) return `${node.title}: depends on external data`;
  if (nodeType(node) === "condition") return `${node.title}: branches execution`;
  return null;
}

function firstActionableNode(graphPlan: TaskPlanGraphPlan | null) {
  const nodes = graphPlan?.nodes ?? [];
  return nodes.find((node) => node.active || node.status === "active" || node.status === "in_progress")
    ?? nodes.find((node) => node.status === "ready" || node.status === "pending" || node.status === "idle")
    ?? nodes[0]
    ?? null;
}

export function deriveTaskPlanningReadiness(pageData: Pick<TaskPageData, "task" | "availableAiClients">): TaskPlanningReadiness {
  const task = pageData.task;
  const hasProvider = Boolean(task.aiClientId || (pageData.availableAiClients ?? []).length > 0 || task.executionRuntime);
  const checks: TaskPlanningReadiness["checks"] = [
    {
      id: "title",
      label: "Task title",
      level: "required",
      state: task.title.trim() ? "passed" : "blocked",
      helperText: task.title.trim() ? undefined : "Add a title before planning.",
      action: task.title.trim() ? undefined : "edit_brief",
    },
    {
      id: "description",
      label: "Task description",
      level: "recommended",
      state: task.description?.trim() ? "passed" : "missing",
      helperText: task.description?.trim() ? undefined : "Describe the expected work so plan steps are grounded.",
      action: task.description?.trim() ? undefined : "edit_brief",
    },
    {
      id: "success_criteria",
      label: "Success criteria",
      level: "recommended",
      state: /success|done when|acceptance|验收|成功|完成标准/i.test(`${task.description ?? ""} ${task.runnabilitySummary ?? ""}`) ? "passed" : "missing",
      helperText: "Explain how Chrona should decide that the result is complete.",
      action: "edit_brief",
    },
    {
      id: "output_format",
      label: "Output format",
      level: "recommended",
      state: /report|summary|checklist|file|table|patch|pr|文档|报告|表格|清单/i.test(task.description ?? "") ? "passed" : "missing",
      helperText: "Choose a report, checklist, patch, file, table, or summary.",
      action: "edit_brief",
    },
    {
      id: "schedule",
      label: "Schedule or due date",
      level: "optional",
      state: task.dueAt || task.scheduledStartAt || task.currentWorkBlock ? "passed" : "missing",
      helperText: "Optional. Timing can be configured before execution.",
      action: "edit_brief",
    },
    {
      id: "provider",
      label: "AI provider",
      level: "required",
      state: hasProvider ? "passed" : "blocked",
      helperText: hasProvider ? undefined : "Connect an AI provider before generating a plan.",
      action: hasProvider ? undefined : "configure_provider",
    },
  ];
  const hasBlocked = checks.some((check) => check.state === "blocked");
  const hasWarnings = checks.some((check) => check.level === "recommended" && check.state === "missing");
  return {
    status: hasBlocked ? "blocked" : hasWarnings ? "warning" : "ready",
    checks,
    primaryAction: hasBlocked && !hasProvider ? "configure_provider" : hasBlocked ? "complete_brief" : "generate_plan",
  };
}

function toneFromWorkState(tone: WorkStateView["tone"]): TaskWorkspaceStage["tone"] {
  return tone === "danger" ? "critical" : tone;
}

export function deriveTaskWorkStateView(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  operationState: TaskWorkspaceOperationState;
  currentNode?: PlanNodeDataModel | null;
}): WorkStateView {
  const planStatus = input.pageData.task.savedPlan?.status ?? null;
  const hasPlan = Boolean(input.pageData.task.savedPlan ?? input.graphPlan);
  const hasAcceptedPlan = planStatus === "accepted" || input.operationState.status === "plan-ready-to-run";
  const currentNode = input.currentNode ?? input.operationState.currentNode ?? firstActionableNode(input.graphPlan);
  return deriveWorkStateView({
    taskStatus: input.pageData.task.status,
    executionStatus: input.pageData.latestRunSummary?.executionState ?? input.pageData.latestRunSummary?.status ?? input.pageData.task.executionSummary?.executionState ?? currentNode?.status ?? null,
    planStatus,
    planGenerationStatus: input.pageData.task.aiPlanGenerationStatus ?? null,
    hasPlan,
    hasAcceptedPlan,
    isRunnable: input.pageData.task.isRunnable,
    disabledReason: input.pageData.task.runnabilityState === "blocked" ? input.pageData.task.runnabilitySummary : null,
    currentNodeId: currentNode?.id ?? input.pageData.task.executionSummary?.currentNodeId ?? input.pageData.task.blockReason?.nodeId ?? null,
    currentNodeLabel: currentNode?.title ?? null,
    blockReason: input.pageData.task.blockReason,
  });
}

export function deriveTaskWorkspaceStage(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  operationState: TaskWorkspaceOperationState;
}): TaskWorkspaceStage {
  const workState = deriveTaskWorkStateView(input);
  return {
    stage: workState.stage,
    statusLabel: workState.label,
    currentNodeLabel: workState.currentNodeLabel ?? undefined,
    nextActionLabel: workState.nextActionLabel,
    primaryActionId: workState.primaryActionId ?? "none",
    tone: toneFromWorkState(workState.tone),
  };
}

function displayModeFor(input: { pageData: TaskPageData; operationState: TaskWorkspaceOperationState; stage: TaskWorkspaceStage }): TaskWorkspaceDisplayMode {
  const taskStatus = normalized(input.pageData.task.status);
  if (taskStatus === "done") return "done";
  if (input.stage.stage === "result") return "completed";
  if (input.operationState.status === "execution-blocked" || taskStatus === "blocked") return "blocked";
  if (input.operationState.status === "execution-running" || input.operationState.status === "execution-action" || input.operationState.status === "task-action") return "running";
  if (input.operationState.status === "plan-ready-to-run") return "ready_to_run";
  if (input.operationState.status === "plan-review") return "reviewing_plan";
  if (input.operationState.status === "plan-generating") return "planning";
  return "briefing";
}

export function deriveTaskWorkspaceDisplayState(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  operationState: TaskWorkspaceOperationState;
  currentNode: PlanNodeDataModel | null;
}): TaskWorkspaceDisplayState {
  const workState = deriveTaskWorkStateView(input);
  const stage = deriveTaskWorkspaceStage(input);
  const mode = displayModeFor({ pageData: input.pageData, operationState: input.operationState, stage });
  const rule = TASK_WORKSPACE_DISPLAY_RULES[mode];
  return {
    ...rule,
    stage,
    workState,
    readiness: deriveTaskPlanningReadiness(input.pageData),
    planReviewSummary: derivePlanReviewSummary(input.graphPlan),
    runPreview: deriveRunPreview({ pageData: input.pageData, graphPlan: input.graphPlan }),
    resultReview: deriveResultReview(input.pageData),
  };
}

export function derivePlanReviewSummary(graphPlan: TaskPlanGraphPlan | null): PlanReviewSummary | null {
  if (!graphPlan || graphPlan.nodes.length === 0) return null;
  const nodes = graphPlan.nodes;
  const estimated = nodes.reduce((sum, node) => sum + (typeof node.estimatedMinutes === "number" ? node.estimatedMinutes : 0), 0);
  const needsUser = nodes
    .filter((node) => node.requiresHumanInput || nodeType(node) === "checkpoint" || node.intent === "approval" || node.intent === "input")
    .map((node) => node.title)
    .slice(0, 5);
  const outputIntents = nodes.map(nodeOutputIntent).filter((value): value is string => Boolean(value)).slice(0, 5);
  const risks = nodes.map(nodeRisk).filter((value): value is string => Boolean(value)).slice(0, 5);
  const changeSummary = graphPlan.changeSummary?.trim() || graphPlan.summary?.trim() || null;
  return {
    stepCount: nodes.length,
    aiStepCount: nodes.filter(isAiNode).length,
    checkpointCount: nodes.filter((node) => nodeType(node) === "checkpoint").length,
    estimatedMinutes: estimated > 0 ? estimated : null,
    outputIntents: outputIntents.length > 0 ? outputIntents : ["Task result"],
    needsUser,
    risks,
    changeSummary,
  };
}

export function deriveRunPreview(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
}): RunLaunchView | null {
  if (!input.graphPlan || input.graphPlan.nodes.length === 0) return null;

  const { task } = input.pageData;
  const firstStep = firstActionableNode(input.graphPlan);
  const runtimeLabel = task.executionRuntime || input.pageData.defaultExecutionRuntime || "Default runtime";
  const selectedClient = input.pageData.availableAiClients?.find((client) => client.id === task.aiClientId);
  const providerLabel = selectedClient?.name ?? task.aiClientId ?? "No AI provider";
  const providerUnavailable = !selectedClient || !selectedClient.enabled;
  const scheduled = Boolean(task.scheduledStartAt);
  const startMode = scheduled ? "scheduled" : task.autoExecute ? "automatic" : "manual";
  const blocked = task.isRunnable === false;
  const expectedStops = input.graphPlan.nodes
    .filter((node) => node.requiresHumanInput || nodeType(node) === "checkpoint" || node.intent === "approval" || node.intent === "input")
    .map((node): RunLaunchExpectedStop => ({
      id: node.id,
      label: node.title,
      kind: node.intent === "approval"
        || node.interactionType === "approve"
        || node.status === "waiting_for_approval"
        ? "approval"
        : "input",
    }));
  const estimatedMinutes = input.graphPlan.nodes.reduce(
    (sum, node) => sum + (typeof node.estimatedMinutes === "number" ? node.estimatedMinutes : 0),
    0,
  );

  return {
    readiness: blocked ? "blocked" : scheduled && task.autoExecute ? "scheduled" : "ready",
    startMode,
    providerLabel,
    runtimeLabel,
    planVersionLabel: task.savedPlan ? `Revision ${task.savedPlan.revision}` : "Current accepted plan",
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : null,
    stepCount: input.graphPlan.nodes.length,
    firstStepLabel: firstStep?.title ?? "First available step",
    expectedStops,
    resultRequiresAcceptance: true,
    blockerSummary: blocked ? task.runnabilitySummary || "Task setup is incomplete" : null,
    recoveryAction: blocked ? (task.aiClientId && providerUnavailable ? "connect_provider" : "edit_task") : null,
    canStartManually: !blocked,
  };
}

export function deriveResultReview(pageData: TaskPageData): ResultReview | null {
  if (!isCompletedStatus(pageData.task.status) && normalized(pageData.latestRunSummary?.status) !== "completed") return null;
  const isDone = normalized(pageData.task.status) === "done";
  return {
    title: isDone ? "Result accepted" : "Result ready for review",
    description: isDone
      ? "Task is closed. Use follow-up only when the accepted result needs a new question or next task."
      : pageData.artifacts.length > 0
        ? `${pageData.artifacts.length} artifact${pageData.artifacts.length === 1 ? "" : "s"} available. Review output and artifacts, then accept the result or request changes.`
        : "Execution completed. Review the output and activity trail, then accept the result or request changes.",
    actions: isDone
      ? [
        { id: "ask_follow_up", label: "Ask follow-up", emphasis: "primary" },
        { id: "create_follow_up_task", label: "Create follow-up task", emphasis: "secondary" },
      ]
      : [
        { id: "accept_result", label: "Accept result", emphasis: "primary" },
        { id: "request_changes", label: "Request changes", emphasis: "secondary" },
      ],
  };
}
