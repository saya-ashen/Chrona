import { buildActivitySpec, UI_ACTION, type ToolDetailLabels, type UiDocument } from "@chrona/ui-protocol";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../model/task-workspace-activity";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "../model/task-workspace-types";
import type { CommandCenterPrimaryAction } from "./task-workspace-execution-overview";

type WorkspaceCopy = Record<string, string | undefined>;
type MutableElements = UiDocument["elements"];

function appendDocument(
  target: MutableElements,
  children: string[],
  keyPrefix: string,
  document: UiDocument | null | undefined,
) {
  if (!document?.root || !document.elements[document.root]) return;
  for (const [key, element] of Object.entries(document.elements)) {
    target[`${keyPrefix}:${key}`] = {
      ...element,
      children: element.children?.map((child) => `${keyPrefix}:${child}`),
    };
  }
  children.push(`${keyPrefix}:${document.root}`);
}

function mergeDocumentState(target: UiDocument, document: UiDocument | null | undefined) {
  if (!document?.state) return;
  target.state = { ...(target.state ?? {}), ...document.state };
}

function normalizeTone(tone: ExecutionOverviewCard["tone"] | CommandCenterPrimaryAction["tone"] | undefined) {
  return tone === "critical" ? "danger" : (tone ?? "info");
}

function compactRuntimeText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function describeRuntimeEvent(event: WorkspaceRuntimeEvent): { label: string; detail: string } {
  const value = event.event;
  switch (value.type) {
    case "assistant_text_delta":
      return { label: "Assistant", detail: compactRuntimeText(value.text) };
    case "reasoning_delta":
      return { label: "Reasoning", detail: compactRuntimeText(value.text) };
    case "tool_started":
      return { label: "Tool", detail: compactRuntimeText(value.label) };
    case "tool_completed":
      return { label: "Tool", detail: compactRuntimeText(value.error ? `${value.label} failed` : `${value.label} completed`) };
    case "approval_required":
      return { label: "Approval", detail: "Approval required" };
    case "run_status":
      return { label: "Status", detail: compactRuntimeText(value.message ?? value.status) };
    case "raw_event":
      return { label: "Event", detail: compactRuntimeText(value.rawEventType ?? "Runtime event") };
  }
}

function primaryActionId(action: CommandCenterPrimaryAction) {
  return action.kind ?? action.label;
}

function buildPrimaryActionSpec(primaryAction: CommandCenterPrimaryAction | null | undefined, copy: WorkspaceCopy): UiDocument | null {
  if (!primaryAction?.onClick) return null;
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "sm" }, children: ["action"] },
      action: {
        type: "Button",
        props: {
          label: primaryAction.isLoading ? (copy.generating ?? "Generating...") : primaryAction.label,
          variant: primaryAction.tone === "critical" ? "danger" : "primary",
          ...((primaryAction.disabled || primaryAction.isLoading) && { disabled: true }),
        },
        on: { press: { action: UI_ACTION.commandCenterPrimary, params: { actionId: primaryActionId(primaryAction) } } },
      },
    },
  };
}

/**
 * Frontend fallback for the persistent action rail when the server does not
 * supply `commandCenter.documents.now`. Renders the current-operation status
 * card, recent live runtime events, and the resolved primary action (an
 * embedded action spec such as the accept/regenerate or checkpoint controls,
 * and/or a single primary button).
 */
export function buildCommandCenterNowSpec(input: {
  primaryAction?: CommandCenterPrimaryAction | null;
  readiness: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  copy: WorkspaceCopy;
}): UiDocument {
  const elements: MutableElements = {};
  const rootChildren: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };

  const statusCard = input.attention ?? input.readiness;
  const statusIcon = input.attention ? "warning" : "sparkles";
  elements["status-card"] = {
    type: "WorkspaceSummaryCard",
    props: {
      eyebrow: input.copy.currentOperation ?? "Current operation",
      title: statusCard.title,
      description: statusCard.description,
      statusLabel: statusCard.statusLabel,
      tone: normalizeTone(statusCard.tone),
      icon: statusIcon,
    },
  };
  rootChildren.push("status-card");

  if (input.runtimeEvents.length > 0) {
    const recentEvents = input.runtimeEvents.slice(-8);
    const eventChildren: string[] = [];
    recentEvents.forEach((event, i) => {
      const key = `event-${i}`;
      const { label, detail } = describeRuntimeEvent(event);
      elements[key] = {
        type: "Text",
        props: { text: detail ? `${label}: ${detail}` : label, variant: "muted" },
      };
      eventChildren.push(key);
    });
    elements["live-header"] = {
      type: "Text",
      props: { text: input.copy.liveEvents ?? "Live", variant: "caption" },
    };
    elements["live-stack"] = {
      type: "Stack",
      props: { gap: "xs" },
      children: ["live-header", ...eventChildren],
    };
    rootChildren.push("live-stack");
  }

  appendDocument(elements, rootChildren, "primary-action", input.primaryAction?.actionSpec);
  appendDocument(elements, rootChildren, "primary-button", buildPrimaryActionSpec(input.primaryAction, input.copy));

  const spec: UiDocument = { root: "root", elements };
  mergeDocumentState(spec, input.primaryAction?.actionSpec);
  return spec;
}


function emptyTextSpec(message: string): UiDocument {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "sm" }, children: ["empty"] },
      empty: { type: "Text", props: { text: message, variant: "muted" } },
    },
  };
}

function resultSourceSpec(node: PlanNodeDataModel, copy: WorkspaceCopy): UiDocument {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "xs" }, children: ["source", "locate"] },
      source: { type: "Text", props: { text: `${copy.from ?? "from"}: ${node.title}`, variant: "caption" } },
      locate: {
        type: "Button",
        props: { label: copy.locateSourceNode ?? "Locate source node", variant: "secondary" },
        on: { press: { action: UI_ACTION.locateWorkspaceNode, params: { nodeId: node.id } } },
      },
    },
  };
}


export function buildCommandCenterOutputTabSpec(input: {
  latestCompletedNode: PlanNodeDataModel | null;
  resultSpec: UiDocument;
  artifacts: WorkspaceArtifactItem[];
  copy: WorkspaceCopy;
  apiArtifactsSpec?: UiDocument | null;
}): UiDocument {
  const elements: MutableElements = {};
  const children: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children };

  if (input.latestCompletedNode) {
    appendDocument(elements, children, "source", resultSourceSpec(input.latestCompletedNode, input.copy));
  }
  appendDocument(elements, children, "result", input.resultSpec);
  if (input.artifacts.length > 0 || input.apiArtifactsSpec) {
    appendDocument(elements, children, "artifacts", input.apiArtifactsSpec ?? buildArtifactsSpec({ artifacts: input.artifacts, copy: input.copy, onLocate: true }));
  }

  if (children.length === 0) {
    appendDocument(elements, children, "empty", emptyTextSpec(input.copy.noResultYet ?? "No output yet."));
  }

  return { root: "root", elements };
}

export function buildCommandCenterTrailTabSpec(input: {
  activity: WorkspaceActivityItem[];
  runtimeEvents: WorkspaceRuntimeEvent[];
  copy: WorkspaceCopy;
  toolLabels: ToolDetailLabels;
  limit?: number;
}): UiDocument {
  const limit = input.limit ?? 30;
  const items = mergeWorkspaceActivity([...runtimeEventsToWorkspaceActivity(input.runtimeEvents, limit), ...input.activity], limit);
  const latestProvider = input.runtimeEvents.at(-1)?.provider;
  const elements: MutableElements = {};
  const children: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children };
  elements.title = { type: "Heading", props: { text: input.copy.activityTitle ?? "Execution activity", level: 3 } };
  elements.stats = {
    type: "Text",
    props: { text: `${items.length} shown · ${input.runtimeEvents.length} live · ${input.activity.length} saved`, variant: "caption" },
  };
  children.push("title", "stats");
  if (latestProvider) {
    elements.provider = { type: "Badge", props: { label: latestProvider, variant: "secondary" } };
    children.push("provider");
  }
  if (items.length === 0) {
    elements.empty = { type: "Alert", props: { title: input.copy.activityEmpty ?? "Activity will appear after planning or execution starts.", type: "info" } };
    children.push("empty");
  } else {
    appendDocument(elements, children, "activity", buildActivitySpec(items, input.toolLabels));
  }
  return { root: "root", elements };
}


export function buildArtifactsSpec(input: {
  artifacts: WorkspaceArtifactItem[];
  copy: WorkspaceCopy;
  onLocate?: boolean;
}): UiDocument {
  const elements: UiDocument["elements"] = {};
  const artifactChildren: string[] = [];

  input.artifacts.forEach((artifact) => {
    const key = `artifact:${artifact.id}`;
    elements[key] = {
      type: "WorkspaceArtifactItem",
      props: {
        title: artifact.title,
        type: artifact.type,
        uri: artifact.uri,
        locateLabel: input.copy.locateSourceNode ?? "Locate source node",
      },
      ...(artifact.sourceNodeId && input.onLocate
        ? { on: { locate: { action: "locate-workspace-node", params: { nodeId: artifact.sourceNodeId } } } }
        : {}),
    };
    artifactChildren.push(key);
  });

  elements["artifact-list"] = {
    type: "WorkspaceArtifactList",
    props: {
      emptyLabel: input.copy.noArtifacts ?? "No artifacts yet.",
      maxCollapsed: 4,
      showAllLabel: input.copy.showAllArtifacts,
      showFewerLabel: input.copy.showFewerArtifacts,
    },
    children: artifactChildren,
  };

  const rootChildren = ["artifact-list"];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };
  return { root: "root", elements };
}

export function buildAcceptOrRegenerateSpec(input: {
  copy: WorkspaceCopy;
  canAcceptPlan?: boolean;
  isGeneratingPlan: boolean;
  visibleGenerationInstruction: string | null;
  acceptPlanError: string | null;
  regenerationInstruction: string;
}): UiDocument {
  const { copy } = input;
  const children: string[] = [];
  const elements: UiDocument["elements"] = {
    root: { type: "Stack", props: { gap: "sm" }, children },
    instruction: {
      type: "Textarea",
      props: {
        label: copy.instructionAria ?? "Plan regeneration instruction",
        name: "instruction",
        value: { $bindState: "/instruction" },
        placeholder: copy.instructionPlaceholder ?? "Tell Chrona what to change in the regenerated plan...",
      },
    },
    actions: { type: "Stack", props: { gap: "xs" }, children: ["accept", "regenerate"] },
    accept: {
      type: "Button",
      props: { label: copy.accept ?? "Accept plan", variant: "primary", ...(!input.canAcceptPlan && { disabled: true }) },
      on: { press: { action: "accept-plan" } },
    },
    regenerate: {
      type: "Button",
      props: {
        label: input.isGeneratingPlan ? (copy.generating ?? "Generating...") : (copy.regenerateWithInstruction ?? "Regenerate with instruction"),
        variant: "secondary",
        ...(input.isGeneratingPlan && { disabled: true }),
      },
      on: { press: { action: "regenerate-plan", params: { instruction: { $state: "/instruction" } } } },
    },
  };

  if (input.visibleGenerationInstruction) {
    elements["visible-instruction"] = {
      type: "Stack",
      props: { gap: "xs" },
      children: ["visible-instruction-label", "visible-instruction-body"],
    };
    elements["visible-instruction-label"] = {
      type: "Text",
      props: { text: copy.instructionLabel ?? "User instruction for this plan revision", variant: "caption" },
    };
    elements["visible-instruction-body"] = {
      type: "Text",
      props: { text: input.visibleGenerationInstruction },
    };
    children.push("visible-instruction");
  }

  children.push("instruction", "actions");

  if (input.acceptPlanError) {
    elements["accept-error"] = { type: "Alert", props: { title: input.acceptPlanError, type: "error" } };
    children.push("accept-error");
  }

  return { root: "root", elements, state: { instruction: input.regenerationInstruction } };
}
