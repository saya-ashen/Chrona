import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import type { TaskPageData } from "./task-workspace-types";
import type { TaskWorkspaceOperationState } from "./task-workspace-operation-machine";

export type TaskPlanningReadiness = {
  status: "ready" | "warning" | "blocked";
  checks: Array<{
    id: string;
    label: string;
    state: "passed" | "missing" | "warning" | "blocked";
    helperText?: string;
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

export type RunPreview = {
  providerLabel: string;
  modeLabel: string;
  startNodeLabel: string;
  expectedStops: string[];
  outputDestinations: string[];
  previousResultLabel?: string;
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

export type TaskWorkspaceDisplayRule = {
  mode: TaskWorkspaceDisplayMode;
  description: string;
  layout: "workspace" | "result_focus";
  panels: Record<TaskWorkspacePanelKey, boolean>;
};

export type TaskWorkspaceDisplayState = TaskWorkspaceDisplayRule & {
  stage: TaskWorkspaceStage;
  readiness: TaskPlanningReadiness;
  planReviewSummary: PlanReviewSummary | null;
  runPreview: RunPreview | null;
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
    layout: "workspace",
    panels: panels(["stageBar", "readiness", "operationPanel"]),
  },
  planning: {
    mode: "planning",
    description: "Plan generation is active. Keep stage visible, hide review/run/result affordances.",
    layout: "workspace",
    panels: panels(["stageBar", "readiness", "operationPanel"]),
  },
  reviewing_plan: {
    mode: "reviewing_plan",
    description: "Draft plan needs user review. Show plan summary, diff, selected-node context, and revision controls.",
    layout: "workspace",
    panels: panels(["stageBar", "readiness", "planReviewSummary", "planDiffReview", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel"]),
  },
  ready_to_run: {
    mode: "ready_to_run",
    description: "Accepted plan is ready. Show run preview and selected-node context before start.",
    layout: "workspace",
    panels: panels(["stageBar", "planReviewSummary", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "runPreview", "operationPanel"]),
  },
  running: {
    mode: "running",
    description: "Execution is in progress. Prioritize current operation and selected-node context.",
    layout: "workspace",
    panels: panels(["stageBar", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel"]),
  },
  blocked: {
    mode: "blocked",
    description: "Execution needs handling. Keep blocker resolution, decision cards, and follow-up composer visible.",
    layout: "workspace",
    panels: panels(["stageBar", "selectedNodeDetails", "selectedNodeQuickActions", "decisionCards", "operationPanel", "followUpComposer"]),
  },
  completed: {
    mode: "completed",
    description: "Run completed but task result is not accepted as Done. Hide plan workbench and focus result review.",
    layout: "result_focus",
    panels: panels(["stageBar", "resultReview", "followUpComposer"]),
  },
  done: {
    mode: "done",
    description: "Task is closed. Hide plan workbench and show accepted result with lightweight follow-up only.",
    layout: "result_focus",
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
      label: "Title exists",
      state: task.title.trim() ? "passed" : "blocked",
      helperText: task.title.trim() ? undefined : "Add a title before planning.",
    },
    {
      id: "description",
      label: "Description exists",
      state: task.description?.trim() ? "passed" : "missing",
      helperText: task.description?.trim() ? undefined : "Describe the expected work so plan nodes are grounded.",
    },
    {
      id: "success_criteria",
      label: "Success criteria present",
      state: /success|done when|acceptance|验收|成功|完成标准/i.test(`${task.description ?? ""} ${task.runnabilitySummary ?? ""}`) ? "passed" : "warning",
      helperText: "Planning can continue, but explicit success criteria make review safer.",
    },
    {
      id: "output_format",
      label: "Output format specified",
      state: /report|summary|checklist|file|table|patch|pr|文档|报告|表格|清单/i.test(task.description ?? "") ? "passed" : "warning",
      helperText: "Tell Chrona whether the result should be a report, checklist, patch, file, or summary.",
    },
    {
      id: "schedule",
      label: "Schedule or due date set",
      state: task.dueAt || task.scheduledStartAt || task.currentWorkBlock ? "passed" : "warning",
      helperText: "Optional. Add a due date when timing matters.",
    },
    {
      id: "provider",
      label: "Provider configured",
      state: hasProvider ? "passed" : "blocked",
      helperText: hasProvider ? undefined : "Configure an AI provider before generating a plan.",
    },
  ];
  const hasBlocked = checks.some((check) => check.state === "blocked");
  const hasWarnings = checks.some((check) => check.state === "warning" || check.state === "missing");
  return {
    status: hasBlocked ? "blocked" : hasWarnings ? "warning" : "ready",
    checks,
    primaryAction: hasBlocked && !hasProvider ? "configure_provider" : hasBlocked ? "complete_brief" : "generate_plan",
  };
}

export function deriveTaskWorkspaceStage(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  operationState: TaskWorkspaceOperationState;
}): TaskWorkspaceStage {
  const { pageData, graphPlan, operationState } = input;
  const currentNode = operationState.currentNode ?? firstActionableNode(graphPlan);
  if (operationState.status === "execution-completed" || isCompletedStatus(pageData.task.status)) {
    const isDone = normalized(pageData.task.status) === "done";
    return {
      stage: "result",
      statusLabel: isDone ? "Task done" : "Result ready",
      nextActionLabel: isDone ? "Ask a follow-up or create a next task" : "Accept result or request changes",
      primaryActionId: isDone ? "ask_follow_up" : "accept_result",
      tone: isDone ? "success" : "info",
    };
  }
  if (operationState.status === "execution-running" || operationState.status === "execution-action" || operationState.status === "execution-blocked" || operationState.status === "task-action") {
    return {
      stage: "run",
      statusLabel: operationState.statusLabel ?? pageData.task.status,
      currentNodeLabel: currentNode?.title,
      nextActionLabel: operationState.description,
      primaryActionId: operationState.action,
      tone: operationState.tone,
    };
  }
  if (operationState.status === "plan-review") {
    return {
      stage: "review",
      statusLabel: operationState.statusLabel ?? "Plan review",
      nextActionLabel: operationState.canAcceptPlan ? "Review the summary, then accept the plan" : "Resolve plan review issue",
      primaryActionId: "accept_plan",
      tone: operationState.tone,
    };
  }
  if (operationState.status === "plan-ready-to-run") {
    return {
      stage: "run",
      statusLabel: operationState.statusLabel ?? "Ready to run",
      currentNodeLabel: currentNode?.title,
      nextActionLabel: "Review run preview, then start execution",
      primaryActionId: "start_run",
      tone: operationState.tone,
    };
  }
  return {
    stage: "brief",
    statusLabel: operationState.statusLabel ?? pageData.task.status,
    nextActionLabel: operationState.status === "plan-generating" ? "Wait for Chrona to finish drafting the plan" : "Generate a plan",
    primaryActionId: operationState.action,
    tone: operationState.tone,
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
  const stage = deriveTaskWorkspaceStage(input);
  const mode = displayModeFor({ pageData: input.pageData, operationState: input.operationState, stage });
  const rule = TASK_WORKSPACE_DISPLAY_RULES[mode];
  return {
    ...rule,
    stage,
    readiness: deriveTaskPlanningReadiness(input.pageData),
    planReviewSummary: derivePlanReviewSummary(input.graphPlan),
    runPreview: deriveRunPreview({ pageData: input.pageData, graphPlan: input.graphPlan, currentNode: input.currentNode }),
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
  currentNode: PlanNodeDataModel | null;
}): RunPreview | null {
  if (!input.graphPlan || input.graphPlan.nodes.length === 0) return null;
  const startNode = input.currentNode ?? firstActionableNode(input.graphPlan);
  const expectedStops = input.graphPlan.nodes
    .filter((node) => node.requiresHumanInput || nodeType(node) === "checkpoint" || node.status === "waiting_for_approval" || node.status === "waiting_for_user")
    .map((node) => node.title)
    .slice(0, 5);
  const artifactCount = input.pageData.artifacts.length;
  return {
    providerLabel: input.pageData.task.executionRuntime || input.pageData.defaultExecutionRuntime || "Default provider",
    modeLabel: expectedStops.length > 0 ? "Manual checkpoints" : "Auto where safe",
    startNodeLabel: startNode?.title ?? "First available step",
    expectedStops,
    outputDestinations: ["Task result", artifactCount > 0 ? `${artifactCount} existing artifacts` : "Artifacts", "Activity trail"],
    previousResultLabel: input.pageData.artifacts.length > 0 ? `${input.pageData.artifacts.length} artifact${input.pageData.artifacts.length === 1 ? "" : "s"} already exist` : undefined,
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
