import { UI_ACTION } from "../actions/actions";
import type { UiDocument } from "../document/document";

export type TaskHeaderExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled"
  | "no_plan";

export type TaskHeaderTaskStatus = "completed" | "running" | "waiting" | "approval-needed" | "blocked";

export type TaskHeaderActionInput = {
  id: "start" | "pause" | "stop" | "accept-plan" | "generate-plan" | "edit" | "delete";
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
};

export type TaskHeaderBadgeInput = {
  id: string;
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export type TaskHeaderSpecInput = {
  title: string;
  status: TaskHeaderTaskStatus;
  statusLabel: string;
  progressLabel: string;
  priorityLabel?: string | null;
  priorityTone?: TaskHeaderBadgeInput["tone"];
  workspaceStateLabel?: string | null;
  workspaceStateGuidance?: string | null;
  occurrenceLabel?: string | null;
  sourceLabel?: string | null;
  executionStatus?: {
    status: TaskHeaderExecutionStatus;
    label?: string | null;
    message?: string | null;
  } | null;
  actions: TaskHeaderActionInput[];
};

type MutableElements = UiDocument["elements"];

function badgeVariant(tone: TaskHeaderBadgeInput["tone"]) {
  if (tone === "danger") return "destructive";
  if (tone === "neutral") return "outline";
  return "secondary";
}

function buttonVariant(actionId: TaskHeaderActionInput["id"]) {
  if (actionId === "stop" || actionId === "delete") return "danger";
  if (actionId === "start" || actionId === "accept-plan" || actionId === "generate-plan") return "primary";
  return "secondary";
}

function actionBinding(action: TaskHeaderActionInput) {
  if (action.id === "edit") return { action: "edit-task", params: {} };
  if (action.id === "delete") return { action: "delete-task", params: {} };
  if (action.id === "accept-plan") return { action: UI_ACTION.acceptPlan, params: {} };
  if (action.id === "generate-plan") return { action: UI_ACTION.regeneratePlan, params: {} };
  return { action: UI_ACTION.dispatchExecution, params: { actionId: action.id } };
}

function appendBadge(elements: MutableElements, children: string[], badge: TaskHeaderBadgeInput | null | undefined) {
  if (!badge?.label) return;
  const key = `badge:${badge.id}`;
  elements[key] = { type: "Badge", props: { text: badge.label, variant: badgeVariant(badge.tone ?? "neutral") } };
  children.push(key);
}

function appendButton(elements: MutableElements, children: string[], action: TaskHeaderActionInput) {
  const key = `action:${action.id}`;
  elements[key] = {
    type: "Button",
    props: {
      label: action.loading ? `${action.label}...` : action.label,
      variant: buttonVariant(action.id),
      size: "sm",
      ...(action.disabled ? { disabled: true } : {}),
      ...(action.disabledReason ? { title: action.disabledReason } : {}),
    },
    on: { press: actionBinding(action) },
  };
  children.push(key);
}

function statusTone(status: TaskHeaderTaskStatus): TaskHeaderBadgeInput["tone"] {
  if (status === "blocked") return "danger";
  if (status === "completed") return "success";
  if (status === "running" || status === "approval-needed") return "info";
  return "neutral";
}

function executionTone(status: TaskHeaderExecutionStatus): TaskHeaderBadgeInput["tone"] {
  if (status === "failed" || status === "blocked" || status === "cancelled") return "danger";
  if (status === "completed") return "success";
  if (status === "waiting_for_user" || status === "waiting_for_approval") return "warning";
  return "info";
}

export function buildTaskHeaderSpec(input: TaskHeaderSpecInput): UiDocument {
  const elements: MutableElements = {};
  const statusChildren: string[] = [];
  const metaChildren: string[] = [];
  const actionChildren: string[] = [];

  appendBadge(elements, statusChildren, input.workspaceStateLabel ? { id: "workspace-state", label: input.workspaceStateLabel, tone: "info" } : null);
  appendBadge(elements, statusChildren, { id: "primary-state", label: input.statusLabel, tone: statusTone(input.status) });
  appendBadge(elements, statusChildren, input.priorityLabel ? { id: "priority", label: input.priorityLabel, tone: input.priorityTone ?? "neutral" } : null);

  if (input.executionStatus?.label && input.executionStatus.label !== input.statusLabel) {
    appendBadge(elements, statusChildren, { id: "execution", label: input.executionStatus.label, tone: executionTone(input.executionStatus.status) });
  }
  if (input.executionStatus?.message && input.executionStatus.status !== "completed") {
    elements["execution-message"] = { type: "Text", props: { text: input.executionStatus.message, variant: "caption" } };
    metaChildren.push("execution-message");
  }
  appendBadge(elements, metaChildren, input.occurrenceLabel ? { id: "occurrence", label: input.occurrenceLabel, tone: "neutral" } : null);
  appendBadge(elements, metaChildren, input.sourceLabel ? { id: "source", label: input.sourceLabel, tone: "neutral" } : null);

  for (const action of input.actions) appendButton(elements, actionChildren, action);

  elements.root = {
    type: "Card",
    props: { className: "relative z-30 min-w-0 overflow-visible rounded-[0.9rem] border-border/70 bg-card/90 p-2 shadow-sm backdrop-blur" },
    children: ["layout"],
  };
  elements.layout = {
    type: "Stack",
    props: { direction: "horizontal", gap: "md", align: "center", justify: "between", className: "min-w-0 flex-wrap" },
    children: ["identity", "actions"],
  };
  elements.identity = { type: "Stack", props: { gap: "xs", className: "min-w-0 flex-1" }, children: ["title-row", "meta-row"] };
  elements["title-row"] = { type: "Stack", props: { direction: "horizontal", gap: "xs", align: "center", className: "min-w-0 flex-wrap" }, children: ["title", ...statusChildren] };
  elements.title = { type: "Heading", props: { text: input.title, level: "h1", className: "min-w-0 break-words text-base font-semibold leading-tight tracking-tight text-foreground lg:max-w-[42vw]" } };
  elements["meta-row"] = { type: "Stack", props: { direction: "horizontal", gap: "xs", align: "center", className: "min-w-0 flex-wrap" }, children: ["summary", ...metaChildren, ...(input.workspaceStateGuidance ? ["guidance"] : [])] };
  elements.summary = { type: "Text", props: { text: input.progressLabel, variant: "caption" } };
  if (input.workspaceStateGuidance) {
    elements.guidance = { type: "Text", props: { text: input.workspaceStateGuidance, variant: "caption", className: "min-w-0 truncate lg:max-w-[38vw]" } };
  }
  elements.actions = { type: "Stack", props: { direction: "horizontal", gap: "xs", align: "center", justify: "end", className: "w-full flex-wrap sm:w-auto" }, children: actionChildren };

  return { root: "root", elements };
}
