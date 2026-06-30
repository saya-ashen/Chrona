import { UI_ACTION } from "../actions/actions";
import type { UiDocument } from "../document/document";

export type TaskHeaderTaskStatus = "completed" | "running" | "waiting" | "approval-needed" | "blocked";

export type TaskHeaderActionInput = {
  id: "start" | "pause" | "stop" | "accept-plan" | "generate-plan" | "edit" | "delete";
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
};

export type TaskHeaderOccurrenceOptionInput = {
  value: string;
  label: string;
  taskId: string;
  date: string | null;
  workBlockId: string | null;
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
  occurrenceValue?: string | null;
  occurrenceOptions?: TaskHeaderOccurrenceOptionInput[];
  sourceLabel?: string | null;
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

function appendAction(elements: MutableElements, children: string[], actionId: TaskHeaderActionInput["id"], label: string) {
  const key = `action:${actionId}`;
  const baseProps = {
    label,
    variant: buttonVariant(actionId),
    size: "sm",
  };
  const element: MutableElements[string] = {
    type: "Button",
    props: baseProps,
    on: { press: actionBinding({ id: actionId, label }) },
  };
  if (actionId === "start") {
    // `disabled` and the `title` tooltip are driven by the
    // `/execution/start-disabled*` state paths so the server can
    // toggle the button without re-emitting the whole spec on every
    // execution state transition.
    element.props = {
      ...baseProps,
      disabled: { $state: "/execution/start-disabled" },
      title: { $state: "/execution/start-disabled-reason" },
    };
    element.visible = { $state: "/execution/can-start" };
  } else if (actionId === "pause") {
    element.visible = { $state: "/execution/can-pause" };
  } else if (actionId === "stop") {
    element.visible = { $state: "/execution/can-stop" };
  } else if (actionId === "accept-plan") {
    element.visible = { $state: "/execution/show-accept-plan" };
  } else if (actionId === "generate-plan") {
    element.props = {
      ...baseProps,
      disabled: { $state: "/plan/generation/header-action-disabled" },
    };
    element.on = { press: { action: UI_ACTION.regeneratePlan, params: {} } };
    element.visible = { $state: "/execution/show-generate-plan" };
  }
  elements[key] = element;
  children.push(key);
}

function appendStopPlanGenerationAction(elements: MutableElements, children: string[]) {
  elements["action:stop-plan-generation"] = {
    type: "Button",
    props: {
      label: "Stop generation",
      variant: "danger",
      size: "sm",
      disabled: { $state: "/plan/generation/stop-disabled" },
    },
    visible: { $state: "/plan/generation/is-running" },
    on: { press: { action: UI_ACTION.stopPlanGeneration, params: {} } },
  };
  children.push("action:stop-plan-generation");
}

function appendOverflowMenu(elements: MutableElements, children: string[], actions: TaskHeaderActionInput[]) {
  if (actions.length === 0) return;
  elements["header-overflow"] = {
    type: "DropdownMenu",
    props: {
      label: "...",
      value: { $bindState: "/headerOverflowAction" },
      items: actions.map((action) => ({ label: action.label, value: action.id })),
    },
    on: { select: { action: "header-overflow-action", params: { actionId: { $state: "/headerOverflowAction" } } } },
  };
  children.push("header-overflow");
}

function statusTone(status: TaskHeaderTaskStatus): TaskHeaderBadgeInput["tone"] {
  if (status === "blocked") return "danger";
  if (status === "completed") return "success";
  if (status === "running" || status === "approval-needed") return "info";
  return "neutral";
}

function appendOccurrence(elements: MutableElements, children: string[], input: TaskHeaderSpecInput) {
  if (input.occurrenceOptions && input.occurrenceOptions.length > 1) {
    elements["occurrence-calendar"] = {
      type: "WorkspaceOccurrenceCalendar",
      props: {
        label: "Occurrence",
        value: input.occurrenceValue ?? input.occurrenceOptions.find((option) => option.label === input.occurrenceLabel)?.value ?? input.occurrenceOptions[0]?.value ?? "",
        options: input.occurrenceOptions,
      },
    };
    children.push("occurrence-calendar");
    return;
  }

  appendBadge(elements, children, input.occurrenceLabel ? { id: "occurrence", label: input.occurrenceLabel, tone: "neutral" } : null);
}

function appendSummary(elements: MutableElements, children: string[], text: string) {
  elements.summary = {
    type: "Text",
    props: {
      text,
      className: "min-w-0 truncate text-xs text-muted-foreground",
    },
  };
  children.push("summary");
}

function appendGuidance(elements: MutableElements, children: string[], text: string) {
  elements.guidance = {
    type: "Text",
    props: {
      text,
      className: "min-w-0 truncate text-xs text-muted-foreground",
    },
  };
  children.push("guidance");
}

export function buildTaskHeaderSpec(input: TaskHeaderSpecInput): UiDocument {
  const elements: MutableElements = {};
  const statusChildren: string[] = [];
  const metaChildren: string[] = [];
  const actionChildren: string[] = [];

  appendBadge(elements, statusChildren, input.workspaceStateLabel ? { id: "workspace-state", label: input.workspaceStateLabel, tone: "info" } : null);
  appendBadge(elements, statusChildren, { id: "primary-state", label: input.statusLabel, tone: statusTone(input.status) });
  appendBadge(elements, statusChildren, input.priorityLabel ? { id: "priority", label: input.priorityLabel, tone: input.priorityTone ?? "neutral" } : null);

  appendOccurrence(elements, metaChildren, input);
  appendBadge(elements, metaChildren, input.sourceLabel ? { id: "source", label: input.sourceLabel, tone: "neutral" } : null);
  appendSummary(elements, metaChildren, input.progressLabel);
  if (input.workspaceStateGuidance) {
    appendGuidance(elements, metaChildren, input.workspaceStateGuidance);
  }

  // Always materialise the five execution-flow action elements so the
  // server can toggle their visibility/disabled through the
  // `/execution/can-*` and `/execution/start-disabled*` state paths on
  // every state transition (no spec rebuild required). The
  // `input.actions` array is still accepted so existing call sites
  // and tests can describe the action surface; it is intentionally
  // unused here — visibility is driven by the live state store, not
  // by the spec build.
  appendAction(elements, actionChildren, "start", "Start");
  appendAction(elements, actionChildren, "pause", "Pause");
  appendAction(elements, actionChildren, "stop", "Stop");
  appendAction(elements, actionChildren, "accept-plan", "Accept plan");
  appendAction(elements, actionChildren, "generate-plan", "Generate plan");
  appendStopPlanGenerationAction(elements, actionChildren);
  appendOverflowMenu(elements, actionChildren, input.actions.filter((action) => action.id === "edit" || action.id === "delete"));

  elements.root = {
    type: "Card",
    props: { className: "relative z-30 min-w-0 overflow-visible rounded-[0.9rem] border-border/70 bg-card/90 p-2 shadow-sm backdrop-blur" },
    children: ["layout", "error-region"],
  };
  elements.layout = {
    type: "Stack",
    props: { direction: "horizontal", gap: "md", align: "center", justify: "between", className: "min-w-0 flex-wrap" },
    children: ["identity", "actions"],
  };
  elements.identity = { type: "Stack", props: { gap: "sm", className: "min-w-0 flex-1" }, children: ["title-row", "meta-row"] };
  elements["title-row"] = { type: "Stack", props: { direction: "horizontal", gap: "sm", align: "center", className: "min-w-0 flex-wrap" }, children: ["title", ...statusChildren] };
  elements.title = { type: "Heading", props: { text: input.title, level: "h1", className: "min-w-0 break-words text-base font-semibold leading-tight tracking-tight text-foreground lg:max-w-[42vw]" } };
  elements["meta-row"] = { type: "Stack", props: { direction: "horizontal", gap: "sm", align: "center", className: "min-w-0 flex-wrap" }, children: [...metaChildren] };
  elements.actions = { type: "Stack", props: { direction: "horizontal", gap: "sm", align: "center", justify: "end", className: "w-full flex-wrap sm:w-auto" }, children: actionChildren };

  // Inline error banner. Visibility + content are driven by `state.update`
  // pushes on `/plan/generation/error/*` from the workspace SSE bus. The
  // server picks which recovery buttons to enable by setting the matching
  // `error/button*` flag; missing/disabled buttons hide themselves.
  appendErrorRegion(elements);

  return {
    root: "root",
    elements,
    state: {
      headerOverflowAction: "",
      plan: {
        generation: {
          "header-action-disabled": false,
          "is-running": false,
          "stop-disabled": false,
        },
      },
    },
  };
}

function appendErrorRegion(elements: MutableElements) {
  elements["error-region"] = {
    type: "Stack",
    props: { direction: "vertical", gap: "sm", className: "mt-2" },
    visible: { $state: "/plan/generation/error/code" },
    children: ["error-alert", "error-actions"],
  };
  elements["error-alert"] = {
    type: "Alert",
    props: {
      title: { $state: "/plan/generation/error/code" },
      message: { $state: "/plan/generation/error/message" },
      type: "error",
    },
  };
  elements["error-actions"] = {
    type: "Stack",
    props: { direction: "horizontal", gap: "sm", className: "flex-wrap" },
    children: ["error-action-retry", "error-action-edit-instruction", "error-action-cancel"],
  };
  elements["error-action-retry"] = {
    type: "Button",
    props: { label: "Retry", variant: "primary", size: "sm" },
    visible: { $state: "/plan/generation/error/buttonRetry" },
    on: { press: { action: UI_ACTION.recoveryRetry, params: {} } },
  };
  elements["error-action-edit-instruction"] = {
    type: "Button",
    props: { label: "Edit instruction", variant: "secondary", size: "sm" },
    visible: { $state: "/plan/generation/error/buttonEditInstruction" },
    on: { press: { action: UI_ACTION.recoveryEditInstruction, params: {} } },
  };
  elements["error-action-cancel"] = {
    type: "Button",
    props: { label: "Dismiss", variant: "outline", size: "sm" },
    visible: { $state: "/plan/generation/error/buttonCancel" },
    on: { press: { action: UI_ACTION.recoveryCancel, params: {} } },
  };
}
