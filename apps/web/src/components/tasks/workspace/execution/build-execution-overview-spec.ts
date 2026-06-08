import type { UiDocument } from "@chrona/ui-protocol";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { ExecutionOverviewCard, WorkspaceArtifactItem } from "../model/task-workspace-types";
import type { CommandCenterPrimaryAction } from "./task-workspace-execution-overview";

type WorkspaceCopy = Record<string, string | undefined>;

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

export function buildNowTabSpec(input: {
  primaryAction?: CommandCenterPrimaryAction | null;
  readiness: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
  copy: WorkspaceCopy;
}): UiDocument {
  const elements: UiDocument["elements"] = {};
  const rootChildren: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };

  // Show attention card if present, otherwise show readiness card
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

  // Show live runtime events (real content, last 8)
  if (input.runtimeEvents.length > 0) {
    const recentEvents = input.runtimeEvents.slice(-8);
    const eventChildren: string[] = [];
    recentEvents.forEach((event, i) => {
      const key = `event-${i}`;
      const { label, detail } = describeRuntimeEvent(event);
      elements[key] = {
        type: "Text",
        props: {
          text: detail ? `${label}: ${detail}` : label,
          variant: "muted",
        },
      };
      eventChildren.push(key);
    });
    elements["live-header"] = {
      type: "Text",
      props: {
        text: input.copy.liveEvents ?? "Live",
        variant: "caption",
      },
    };
    elements["live-stack"] = {
      type: "Stack",
      props: { gap: "xs" },
      children: ["live-header", ...eventChildren],
    };
    rootChildren.push("live-stack");
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
