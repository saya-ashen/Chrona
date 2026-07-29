import { buildResultSpec, type UiDocument } from "@chrona/ui-protocol";
import {
  mergeWorkspaceActivity,
  type PlanNodeDataModel,
  type WorkspaceActivityItem,
} from "@features/task-workspace/public/workspace-integration";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { ResultNodeOption } from "./build-execution-overview-spec";

export type CommandCenterCopy = {
  nowTab: string;
  outputTab: string;
  trailTab: string;
};

export const DEFAULT_COMMAND_CENTER_COPY: CommandCenterCopy = {
  nowTab: "Now",
  outputTab: "Results",
  trailTab: "Activity",
};

export const TRAIL_ACTIVITY_LIMIT = 300;

export type LiveResult = {
  content: string;
  ownerNodeId: string | null;
};

export type ExecutionActivityState = {
  activityItems: WorkspaceActivityItem[];
  activitySummary: string;
  executionIsActive: boolean;
  executionIsLive: boolean;
  executionIsWaitingForHuman: boolean;
  executionHasFatalFailure: boolean;
  failureSummary: string | null;
  finalizationFailed: boolean;
  finalizationReady: boolean;
  finalizationRunning: boolean;
};

export function commandCenterTrailItems(
  commandCenter?: { documents: { trail: UiDocument } } | null,
): WorkspaceActivityItem[] {
  const items = commandCenter?.documents.trail.state?.trail;
  if (!items || typeof items !== "object" || Array.isArray(items)) return [];
  const trailItems = (items as { items?: unknown }).items;
  return Array.isArray(trailItems) ? trailItems as WorkspaceActivityItem[] : [];
}

export function hasCommandCenterOutput(document: UiDocument | null | undefined) {
  if (!document?.root) return false;
  const root = document.elements[document.root];
  const children = root?.children ?? [];
  if (children.length !== 1) return children.length > 0;
  const onlyChild = document.elements[children[0]!];
  return onlyChild?.type !== "WorkspaceArtifactList" || (onlyChild.children?.length ?? 0) > 0;
}

export function buildNodeResultContentSpec(
  node: PlanNodeDataModel | null,
  emptyMessage: string,
) {
  const summary = node?.result?.outputSummary?.trim() || node?.completionSummary?.trim();
  if (!summary) return buildResultSpec([], { emptyMessage });
  return buildResultSpec([{ kind: "markdown", title: node?.title, content: summary }]);
}

function isAssistantTextEvent(
  runtimeEvent: WorkspaceRuntimeEvent,
): runtimeEvent is WorkspaceRuntimeEvent & {
  event: Extract<WorkspaceRuntimeEvent["event"], { type: "assistant_text_delta" }>;
} {
  return runtimeEvent.event.type === "assistant_text_delta";
}

export function collectLiveResult(runtimeEvents: WorkspaceRuntimeEvent[]): LiveResult | null {
  let text = "";
  let ownerNodeId: string | null = null;
  for (const runtimeEvent of runtimeEvents) {
    if (!isAssistantTextEvent(runtimeEvent)) continue;
    text += runtimeEvent.event.text;
    ownerNodeId = runtimeEvent.nodeId ?? null;
  }
  const content = text.trim();
  return content ? { content, ownerNodeId } : null;
}

export function sameLiveResult(left: LiveResult | null, right: LiveResult | null) {
  return left?.content === right?.content && left?.ownerNodeId === right?.ownerNodeId;
}

function isSameToolActivity(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  return left.sourceNodeId === right.sourceNodeId
    && left.runId === right.runId
    && left.nativeRunId === right.nativeRunId
    && left.tool?.name === right.tool?.name;
}

function hasCompletedToolActivity(item: WorkspaceActivityItem, items: WorkspaceActivityItem[]) {
  if (item.tool?.state !== "started") return false;
  return items.some((candidate) => candidate.kind === "tool_completed"
    && candidate.tool?.state !== "started"
    && isSameToolActivity(item, candidate));
}

function isRunningActivity(item: WorkspaceActivityItem, items: WorkspaceActivityItem[]) {
  if (item.tool?.state === "started") return !hasCompletedToolActivity(item, items);
  if (item.rawEventType === "turn_start" || item.rawEventType === "turn_end") return false;
  return item.kind === "provider_run" && item.tone === "info";
}

function buildActivityHeartbeat(runtimeEvents: WorkspaceRuntimeEvent[]): WorkspaceActivityItem {
  const latestRuntime = runtimeEvents.at(-1);
  return {
    id: "execution-live-heartbeat",
    kind: "provider_run",
    title: "AI is working",
    summary: latestRuntime?.nodeTitle ? `Working on ${latestRuntime.nodeTitle}` : "Working on the current step",
    description: "Execution is active. Waiting for the provider's next progress update.",
    tone: "info",
    timestamp: latestRuntime?.timestamp ?? null,
    sourceNodeId: latestRuntime?.nodeId,
    sourceNodeTitle: latestRuntime?.nodeTitle,
    provider: latestRuntime?.provider,
    runtimeName: latestRuntime?.runtimeName,
  };
}

function deriveExecutionState(status: string | undefined, isExecutionRunning: boolean) {
  const executionIsWaitingForHuman = status === "waiting_for_user" || status === "waiting_for_approval";
  const executionIsLive = !executionIsWaitingForHuman && (isExecutionRunning || status === "running" || status === "started");
  return { executionIsWaitingForHuman, executionIsLive, executionIsActive: executionIsLive || executionIsWaitingForHuman };
}

function failedNodeError(node: PlanNodeDataModel | undefined) {
  return node?.result?.error?.trim()
    || (typeof node?.metadata?.error === "string" ? node.metadata.error.trim() : "")
    || null;
}

function activitySummary(activityItems: WorkspaceActivityItem[], executionIsLive: boolean) {
  const failedActivityCount = activityItems.filter((item) => item.tone === "danger").length;
  return executionIsLive
    ? `${activityItems.length} events · live`
    : `${activityItems.length} events${failedActivityCount > 0 ? ` · ${failedActivityCount} failed` : ""}`;
}

function finalizationState(isExecutionActive: boolean, status: string | undefined) {
  const inactive = !isExecutionActive;
  return {
    finalizationFailed: inactive && status === "Failed",
    finalizationReady: inactive && status === "Ready",
    finalizationRunning: inactive && status === "Running",
  };
}

export function buildExecutionActivityState({
  nodes,
  liveActivity,
  liveRuntimeActivity,
  savedTrailActivity,
  runtimeEvents,
  executionStatus,
  isExecutionRunning,
  finalizationStatus,
}: {
  nodes: PlanNodeDataModel[];
  liveActivity: WorkspaceActivityItem[];
  liveRuntimeActivity: WorkspaceActivityItem[];
  savedTrailActivity: WorkspaceActivityItem[];
  runtimeEvents: WorkspaceRuntimeEvent[];
  executionStatus: string | undefined;
  isExecutionRunning: boolean;
  finalizationStatus: string | undefined;
}): ExecutionActivityState {
  const execution = deriveExecutionState(executionStatus, isExecutionRunning);
  const mergedActivity = mergeWorkspaceActivity(
    [...liveActivity, ...liveRuntimeActivity, ...savedTrailActivity],
    TRAIL_ACTIVITY_LIMIT,
  );
  const activeActivity = mergedActivity.find((item) => isRunningActivity(item, mergedActivity));
  const activityItems = execution.executionIsLive && !activeActivity
    ? mergeWorkspaceActivity([buildActivityHeartbeat(runtimeEvents), ...mergedActivity], TRAIL_ACTIVITY_LIMIT)
    : mergedActivity;
  const failedActivity = activityItems.find((item) => item.tone === "danger");
  const failedNode = nodes.find((node) => node.status === "failed");
  const executionHasFatalFailure = executionStatus === "failed" || executionStatus === "blocked";
  const failureSummary = failedNodeError(failedNode)
    || failedActivity?.summary
    || (failedNode ? `${failedNode.title} failed.` : null);
  return {
    ...execution,
    activityItems,
    activitySummary: activitySummary(activityItems, execution.executionIsLive),
    executionHasFatalFailure,
    failureSummary,
    ...finalizationState(execution.executionIsActive, finalizationStatus),
  };
}

export function buildResultNodeOptions(
  nodes: PlanNodeDataModel[],
  artifacts: Array<{ sourceNodeId?: string | null }>,
): ResultNodeOption[] {
  const byId = new Map<string, ResultNodeOption>();
  for (const node of nodes) {
    byId.set(node.id, { id: node.id, title: node.title, status: node.statusLabel ?? node.status });
  }
  for (const artifact of artifacts) {
    if (artifact.sourceNodeId && !byId.has(artifact.sourceNodeId)) {
      byId.set(artifact.sourceNodeId, { id: artifact.sourceNodeId, title: artifact.sourceNodeId });
    }
  }
  return Array.from(byId.values());
}

export function resultStatusFor(activity: ExecutionActivityState) {
  if (activity.executionIsActive) return "active" as const;
  if (activity.finalizationFailed) return "failed" as const;
  if (activity.finalizationRunning) return "running" as const;
  if (activity.finalizationReady) return "ready" as const;
  return "unavailable" as const;
}
