import { buildActivitySpec, UI_ACTION, type ToolDetailLabels, type UiDocument } from "@chrona/ui-protocol";
import {
  mergeWorkspaceActivity,
  runtimeEventsToWorkspaceActivity,
  type ExecutionOverviewCard,
  type PlanNodeDataModel,
  type TaskWorkspacePlanFlowState,
  type WorkspaceActivityItem,
  type WorkspaceArtifactItem,
} from "@features/task-workspace";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { CommandCenterPrimaryAction } from "./task-workspace-execution-overview";

type WorkspaceCopy = Record<string, string | undefined>;
type MutableElements = UiDocument["elements"];

export type ResultNodeFilter = "all" | string;

export type ResultNodeOption = {
  id: string;
  title: string;
  status?: string;
};

type AppendDocumentOptions = {
  selectedNodeId?: ResultNodeFilter;
  nodeOptions?: ResultNodeOption[];
  groupByNode?: boolean;
  fallbackNodeId?: string | null;
};

function elementSourceNodeId(element: UiDocument["elements"][string] | undefined) {
  const props = element?.props;
  if (!props || typeof props !== "object") return null;
  const record = props as Record<string, unknown>;
  return typeof record.xChronaSourceNodeId === "string"
    ? record.xChronaSourceNodeId
    : typeof record.sourceNodeId === "string"
      ? record.sourceNodeId
      : null;
}

function nodeTitleFor(nodeId: string, nodeOptions: ResultNodeOption[]) {
  return nodeOptions.find((node) => node.id === nodeId)?.title ?? nodeId;
}

function nodeStatusFor(nodeId: string, nodeOptions: ResultNodeOption[]) {
  return nodeOptions.find((node) => node.id === nodeId)?.status;
}

function descendantSourceNodeId(document: UiDocument, elementKey: string, visited = new Set<string>()): string | null {
  if (visited.has(elementKey)) return null;
  visited.add(elementKey);
  const direct = elementSourceNodeId(document.elements[elementKey]);
  if (direct) return direct;
  for (const child of document.elements[elementKey]?.children ?? []) {
    const childOwner = descendantSourceNodeId(document, child, visited);
    if (childOwner) return childOwner;
  }
  return null;
}

function filterDocumentRootChildren(document: UiDocument, selectedNodeId?: ResultNodeFilter) {
  const root = document.elements[document.root];
  const rootChildren = root?.children ?? [];
  if (!selectedNodeId || selectedNodeId === "all") return rootChildren;
  return rootChildren.filter((child) => {
    const owner = descendantSourceNodeId(document, child);
    return !owner || owner === selectedNodeId;
  });
}



function groupRootChildrenByNode(document: UiDocument, rootChildren: string[], nodeOptions: ResultNodeOption[], fallbackNodeId?: string | null) {
  const groups: Array<{ nodeId: string | null; children: string[] }> = [];
  for (const child of rootChildren) {
    const nodeId = descendantSourceNodeId(document, child) ?? fallbackNodeId ?? null;
    const previous = groups.at(-1);
    if (previous && previous.nodeId === nodeId) {
      previous.children.push(child);
    } else {
      groups.push({ nodeId, children: [child] });
    }
  }
  return groups.map((group, index) => ({
    key: group.nodeId ? `node-section:${group.nodeId}:${index}` : null,
    nodeId: group.nodeId,
    title: group.nodeId ? nodeTitleFor(group.nodeId, nodeOptions) : null,
    status: group.nodeId ? nodeStatusFor(group.nodeId, nodeOptions) : undefined,
    children: group.children,
  }));
}

const HOST_COLLAPSIBLE_RESULT_TYPES = new Set(["Card", "RichMarkdown", "Table", "JsonView", "FileRef"]);

function makeOpenCollapsibleResultElement(target: MutableElements, key: string) {
  const element = target[key];
  if (!element || !HOST_COLLAPSIBLE_RESULT_TYPES.has(element.type)) return;
  const props = element.props && typeof element.props === "object" ? element.props as Record<string, unknown> : {};
  if (props.collapsible === false || typeof props.defaultCollapsed === "boolean") return;
  target[key] = {
    ...element,
    props: { ...props, defaultCollapsed: false },
  };
}


function appendDocument(
  target: MutableElements,
  children: string[],
  keyPrefix: string,
  document: UiDocument | null | undefined,
  options: AppendDocumentOptions = {},
) {
  if (!document?.root || !document.elements[document.root]) return;
  for (const [key, element] of Object.entries(document.elements)) {
    target[`${keyPrefix}:${key}`] = {
      ...element,
      children: element.children?.map((child) => `${keyPrefix}:${child}`),
    };
  }

  const rootChildren = filterDocumentRootChildren(document, options.selectedNodeId);
  if (rootChildren.length === 0) return;

  if (options.groupByNode) {
    for (const group of groupRootChildrenByNode(document, rootChildren, options.nodeOptions ?? [], options.fallbackNodeId)) {
      if (!group.nodeId || !group.key) {
        children.push(...group.children.map((child) => `${keyPrefix}:${child}`));
        continue;
      }
      for (const child of group.children) {
        makeOpenCollapsibleResultElement(target, `${keyPrefix}:${child}`);
      }
      const sectionKey = `${keyPrefix}:${group.key}`;
      target[sectionKey] = {
        type: "NodeResultSection",
        props: {
          nodeId: group.nodeId,
          nodeTitle: group.title ?? group.nodeId,
          ...(group.status ? { status: group.status } : {}),
          defaultCollapsed: false,
          itemCount: group.children.length,
        },
        children: group.children.map((child) => `${keyPrefix}:${child}`),
      };
      children.push(sectionKey);
    }
    return;
  }

  children.push(rootChildren.length === document.elements[document.root]?.children?.length ? `${keyPrefix}:${document.root}` : `${keyPrefix}:${document.root}:filtered`);
  if (rootChildren.length !== document.elements[document.root]?.children?.length) {
    target[`${keyPrefix}:${document.root}:filtered`] = {
      ...document.elements[document.root],
      children: rootChildren.map((child) => `${keyPrefix}:${child}`),
    };
  }
}

function mergeDocumentState(target: UiDocument, document: UiDocument | null | undefined) {
  if (!document?.state) return;
  target.state = { ...(target.state ?? {}), ...document.state };
}

function normalizeTone(tone: ExecutionOverviewCard["tone"] | CommandCenterPrimaryAction["tone"] | undefined) {
  return tone === "critical" ? "danger" : (tone ?? "info");
}

/**
 * Spec 019 — "Current operation" card has 4 distinct variants, one per
 * `TaskWorkspacePlanFlowState` (`idle` / `generating` / `waiting_acceptance`
 * / `accepted`). This pure helper computes the per-state card copy + visual
 * (title, description, statusLabel, tone, icon).
 *
 * When `planFlow` is `null` (caller doesn't track plan state — e.g. legacy
 * `<TaskWorkspaceActionRail>`) the helper returns `null` and the wrapper
 * falls back to the legacy `attention ?? readiness` path. The split is
 * contained inside this helper so the wrapper has no branching.
 *
 * Pure: no React, no IO, no module state. Truncates `planSummary` to 120
 * chars with `…` if longer. See `specs/019-plan-card-and-accept-tests/plan.md` §1.
 */
/**
 * Per-state card copy + visual for the "Current operation" slot. The
 * generator and review variants share a description template that
 * optionally uses the plan summary.
 */
type CardSpec = {
  title: string;
  description: string;
  statusLabel: string;
  tone: "info" | "success";
  icon: "sparkles" | "check";
};

const PLAN_CARDS: Record<TaskWorkspacePlanFlowState["status"], Omit<CardSpec, "description"> & { descriptionIfSummary: string; fallbackDescription: string }> = {
  idle: {
    title: "No plan yet",
    statusLabel: "Idle",
    tone: "info",
    icon: "sparkles",
    descriptionIfSummary: "",
    fallbackDescription: "Generate a plan to start this task.",
  },
  generating: {
    title: "Generating plan…",
    statusLabel: "Generating",
    tone: "info",
    icon: "sparkles",
    descriptionIfSummary: "",
    fallbackDescription: "Chrona is drafting a plan for this task.",
  },
  waiting_acceptance: {
    title: "Plan ready for review",
    statusLabel: "Waiting for acceptance",
    tone: "info",
    icon: "sparkles",
    descriptionIfSummary: "",
    fallbackDescription: "Review the generated plan and accept it to enable execution.",
  },
  accepting: {
    // The accept button is in flight; show the same card as
    // `waiting_acceptance` so the user sees context while we wait for the
    // server's 202. Only the status label differs.
    title: "Plan ready for review",
    statusLabel: "Accepting",
    tone: "info",
    icon: "sparkles",
    descriptionIfSummary: "",
    fallbackDescription: "Review the generated plan and accept it to enable execution.",
  },
  accepted: {
    title: "Plan accepted",
    statusLabel: "Accepted",
    tone: "success",
    icon: "check",
    descriptionIfSummary: "",
    fallbackDescription: "Execution will start when the block is due.",
  },
  failed: {
    // `failed` carries `error` text; surface it instead of the generic
    // copy. Plan revision actions render separately and show the `<Alert>` from
    // `acceptPlanError`.
    title: "Couldn't accept the plan",
    statusLabel: "Accept failed",
    tone: "info",
    icon: "sparkles",
    descriptionIfSummary: "",
    fallbackDescription: "",
  },
};

export function resolveCurrentOperationCardSpec(input: {
  planFlow: TaskWorkspacePlanFlowState | null;
  planSummary: string | null;
}): CardSpec | null {
  if (!input.planFlow) return null;

  const card = PLAN_CARDS[input.planFlow.status];
  const summary = input.planSummary?.trim() ?? "";
  const truncated = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;

  // `generating` / `waiting_acceptance` / `accepting` surface the plan
  // summary when one is available; other states always show their
  // fallback copy.
  let description = card.fallbackDescription;
  if ((input.planFlow.status === "generating" || input.planFlow.status === "waiting_acceptance" || input.planFlow.status === "accepting") && truncated.length > 0) {
    description = truncated;
  } else if (input.planFlow.status === "failed") {
    description = input.planFlow.error;
  }

  return {
    title: card.title,
    description,
    statusLabel: card.statusLabel,
    tone: card.tone,
    icon: card.icon,
  };
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

function buildPrimaryActionSpec(primaryAction: CommandCenterPrimaryAction | null | undefined): UiDocument | null {
  if (!primaryAction?.onClick) return null;
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: { gap: "sm" }, children: ["action"] },
      action: {
        type: "Button",
        props: {
          label: primaryAction.label,
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
  /**
   * Spec 019 — when supplied, the "Current operation" card uses one of the
   * 4 plan-state variants from `resolveCurrentOperationCardSpec`. When
   * omitted, the wrapper falls back to the legacy
   * `input.attention ?? input.readiness` path so existing callers
   * (e.g. `<TaskWorkspaceActionRail>`) are unaffected.
   */
  planFlow?: TaskWorkspacePlanFlowState | null;
  /**
   * Spec 019 — `savedPlan.summary` for the `generating` / `waiting_acceptance`
   * / `accepting` / `failed` cards. Truncated to 120 chars by the helper.
   */
  planSummary?: string | null;
}): UiDocument {
  const elements: MutableElements = {};
  const rootChildren: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };

  // Spec 019 — when `planFlow` is provided, drive the card from the plan
  // state. Otherwise fall back to the legacy `attention ?? readiness`.
  const planCard = resolveCurrentOperationCardSpec({
    planFlow: input.planFlow ?? null,
    planSummary: input.planSummary ?? null,
  });
  const statusCardProps: {
    title: string;
    description: string;
    statusLabel: string | undefined;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    icon: "sparkles" | "warning" | "check";
  } = planCard
    ? {
        title: planCard.title,
        description: planCard.description,
        statusLabel: planCard.statusLabel,
        tone: planCard.tone,
        icon: planCard.icon,
      }
    : (() => {
        const statusCard = input.attention ?? input.readiness;
        return {
          title: statusCard.title,
          description: statusCard.description,
          statusLabel: statusCard.statusLabel,
          tone: normalizeTone(statusCard.tone),
          icon: input.attention ? ("warning" as const) : ("sparkles" as const),
        };
      })();
  elements["status-card"] = {
    type: "WorkspaceSummaryCard",
    props: {
      eyebrow: input.copy.currentOperation ?? "Current operation",
      title: statusCardProps.title,
      description: statusCardProps.description,
      statusLabel: statusCardProps.statusLabel,
      tone: statusCardProps.tone,
      icon: statusCardProps.icon,
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
      props: { gap: "sm" },
      children: ["live-header", ...eventChildren],
    };
    rootChildren.push("live-stack");
  }

  appendDocument(elements, rootChildren, "primary-action", input.primaryAction?.actionSpec);
  appendDocument(elements, rootChildren, "primary-button", buildPrimaryActionSpec(input.primaryAction));

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


export function buildCommandCenterOutputTabSpec(input: {
  latestCompletedNode: PlanNodeDataModel | null;
  resultSpec: UiDocument;
  artifacts: WorkspaceArtifactItem[];
  liveResultSpec?: UiDocument | null;
  liveResultOwnerNodeId?: string | null;
  copy: WorkspaceCopy;
  apiArtifactsSpec?: UiDocument | null;
  selectedNodeId?: ResultNodeFilter;
  nodeOptions?: ResultNodeOption[];
  outputOwnerNodeId?: string | null;
}): UiDocument {
  const elements: MutableElements = {};
  const children: string[] = [];
  elements.root = { type: "Stack", props: { gap: "sm" }, children };

  appendDocument(elements, children, "output", input.apiArtifactsSpec ?? input.resultSpec, {
    selectedNodeId: input.selectedNodeId,
    nodeOptions: input.nodeOptions,
    groupByNode: true,
    fallbackNodeId: input.nodeOptions && input.nodeOptions.length <= 1 ? input.outputOwnerNodeId ?? input.latestCompletedNode?.id ?? null : null,
  });

  if (input.liveResultSpec) {
    appendDocument(elements, children, "live-output", input.liveResultSpec, {
      selectedNodeId: input.selectedNodeId,
      nodeOptions: input.nodeOptions,
      groupByNode: true,
      fallbackNodeId: input.liveResultOwnerNodeId ?? null,
    });
  }

  if (input.artifacts.length > 0) {
    const filteredArtifacts = !input.selectedNodeId || input.selectedNodeId === "all"
      ? input.artifacts
      : input.artifacts.filter((artifact) => !artifact.sourceNodeId || artifact.sourceNodeId === input.selectedNodeId);
    if (filteredArtifacts.length > 0) {
      appendDocument(elements, children, "artifacts", buildArtifactsSpec({ artifacts: filteredArtifacts, copy: input.copy, onLocate: true }));
    }
  }

  if (children.length === 0) {
    appendDocument(elements, children, "empty", emptyTextSpec(input.copy.noResultYet ?? "No output yet."));
  }

  return { root: "root", elements };
}



function activityAuditCategory(item: WorkspaceActivityItem): string {
  if (item.kind === "artifact") return "artifacts/results";
  if (item.kind === "tool_started" || item.kind === "tool_completed") return "provider/tool activity";
  if (item.kind === "approval" || item.rawEventType?.includes("approval")) return "approvals";
  if (item.tone === "danger" || item.rawEventType?.includes("fail") || item.title.toLowerCase().includes("fail")) return "failures/retries";
  if (item.activityGroup?.kind === "plan_generation") return "plan generation";
  if (item.activityGroup?.kind === "execution_node" || item.sourceNodeId) return "node attempts";
  return "run lifecycle";
}

function activityAuditSummary(items: WorkspaceActivityItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(activityAuditCategory(item), (counts.get(activityAuditCategory(item)) ?? 0) + 1);
  return Array.from(counts.entries()).map(([category, count]) => `${category}: ${count}`);
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
  elements.title = { type: "Heading", props: { text: input.copy.activityTitle ?? "Execution activity", level: "h3" } };
  elements.stats = {
    type: "Text",
    props: { text: `${items.length} shown · ${input.runtimeEvents.length} live · ${input.activity.length} saved`, variant: "caption" },
  };
  elements.groups = {
    type: "Text",
    props: { text: `Audit groups · ${activityAuditSummary(items).join(" · ") || "none yet"}`, variant: "caption" },
  };
  children.push("title", "stats", "groups");
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


const FILE_PREVIEW_KINDS = new Set(["markdown", "json", "text", "csv"]);

function artifactContentKind(type: string): "markdown" | "json" | "text" | "csv" | undefined {
  return FILE_PREVIEW_KINDS.has(type) ? type as "markdown" | "json" | "text" | "csv" : undefined;
}

export function buildArtifactsSpec(input: {
  artifacts: WorkspaceArtifactItem[];
  copy: WorkspaceCopy;
  onLocate?: boolean;
}): UiDocument {
  const elements: UiDocument["elements"] = {};
  const artifactChildren: string[] = [];
  elements["artifact-title"] = {
    type: "Heading",
    props: { text: input.copy.artifactsLabel ?? "Artifacts", level: "h3" },
  };


  input.artifacts.forEach((artifact) => {
    const key = `artifact:${artifact.id}`;
    elements[key] = {
      type: "WorkspaceArtifactItem",
      props: {
        title: artifact.title,
        type: artifact.type,
        uri: artifact.uri,
        contentKind: artifactContentKind(artifact.type),
        contentPreview: artifact.content,
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

  const rootChildren = ["artifact-title", "artifact-list"];
  elements.root = { type: "Stack", props: { gap: "sm" }, children: rootChildren };
  return { root: "root", elements };
}
