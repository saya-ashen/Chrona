import { useEffect, useMemo } from "react";
import { useI18n } from "@chrona/i18n/react";
import { createStateStore } from "@json-render/react";
import { buildResultSpec, type UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts/ai";
import type { PlanNodeDataModel } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import { taskWorkspaceActivityMessages } from "../../../apps/web/src/lib/i18n/messages";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type {
  ExecutionOverviewCard,
  ProgressSummary,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "../../task-workspace";
import { SpecRenderer } from "../../../apps/web/src/components/tasks/workspace/catalog/spec-renderer";
import { buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec } from "./build-execution-overview-spec";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../../task-workspace";
import { UiSurfaceFrame } from "./ui-surface-frame";

type OverviewAction = (nodeId?: string) => void;

export type CommandCenterPrimaryAction = {
  kind?: string;
  label: string;
  description: string;
  statusLabel?: string;
  tone?: ExecutionOverviewCard["tone"];
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  actionSpec?: UiDocument | null;
  actionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  onActionStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
  suppressAttentionCard?: boolean;
};

export type CommandCenterCopy = {
  nowTab: string;
  outputTab: string;
  trailTab: string;
};

const DEFAULT_COMMAND_CENTER_COPY: CommandCenterCopy = {
  nowTab: "Now",
  outputTab: "Results",
  trailTab: "Activity",
};

const TRAIL_ACTIVITY_LIMIT = 100;

function commandCenterTrailItems(commandCenter?: { documents: { trail: UiDocument } } | null) {
  const items = commandCenter?.documents.trail.state?.trail;
  if (!items || typeof items !== "object" || Array.isArray(items)) return [];
  const trailItems = (items as { items?: unknown }).items;
  return Array.isArray(trailItems) ? trailItems as WorkspaceActivityItem[] : [];
}

function buildNodeResultContentSpec(_node: PlanNodeDataModel | null, emptyMessage: string) {
  return buildResultSpec([], { emptyMessage });
}

function withActivityStreamProps(spec: UiDocument, props: { density?: "rail"; active?: boolean }): UiDocument {
  const elements = Object.fromEntries(
    Object.entries(spec.elements).map(([key, element]) => [
      key,
      element.type === "ActivityStream"
        ? { ...element, props: { ...element.props, ...props } }
        : element,
    ]),
  );
  return { ...spec, elements };
}
function isSameToolActivity(left: WorkspaceActivityItem, right: WorkspaceActivityItem) {
  return left.sourceNodeId === right.sourceNodeId
    && left.runId === right.runId
    && left.nativeRunId === right.nativeRunId
    && left.tool?.name === right.tool?.name;
}

function hasCompletedToolActivity(item: WorkspaceActivityItem, items: WorkspaceActivityItem[]) {
  if (item.tool?.state !== "started") return false;
  return items.some((candidate) => candidate.kind === "tool_completed" && candidate.tool?.state !== "started" && isSameToolActivity(item, candidate));
}

function isRunningActivity(item: WorkspaceActivityItem, items: WorkspaceActivityItem[]) {
  if (item.tool?.state === "started") return !hasCompletedToolActivity(item, items);
  return item.kind === "provider_run" && item.tone === "info";
}


function runningActivityText(item: WorkspaceActivityItem | undefined) {
  if (!item) return null;
  return item.tool?.label ?? item.sourceNodeTitle ?? item.summary ?? item.title;
}


type ActivityLayout = "below" | "side";

export function TaskWorkspaceExecutionOverview({
  readiness,
  attention,
  latestCompletedNode,
  artifacts,
  activity,
  currentExecution,
  runtimeEvents = [],
  liveActivity = [],
  primaryAction,
  copy: copyProp,
  commandCenter,
  activityLayout = "below",
  onAction,
}: {
  taskId: string;
  progress: ProgressSummary;
  readiness: ExecutionOverviewCard;
  /** Retained for callers; the Now tab derives its status card from readiness/attention. */
  latestResult?: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  latestCompletedNode: PlanNodeDataModel | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  currentExecution?: Pick<PlanExecutionResult, "status"> | null;
  runtimeEvents?: WorkspaceRuntimeEvent[];
  liveActivity?: WorkspaceActivityItem[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  activityLayout?: ActivityLayout;
  onAction?: OverviewAction;
  commandCenter?: {
    documents: {
      now: UiDocument;
      output: UiDocument;
      trail: UiDocument;
    };
  } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
}) {
  const { messages } = useI18n();
  const ws = messages.components.taskWorkspace;
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };

  const trailStore = useMemo(
    () => commandCenter?.documents.trail ? createStateStore(commandCenter.documents.trail.state ?? {}) : null,
    [commandCenter?.documents.trail],
  );
  const savedTrailActivity = useMemo(
    () => commandCenter?.documents.trail ? commandCenterTrailItems(commandCenter) : activity,
    [activity, commandCenter],
  );
  const liveRuntimeActivity = useMemo(() => runtimeEventsToWorkspaceActivity(runtimeEvents, TRAIL_ACTIVITY_LIMIT), [runtimeEvents]);
  const mergedActivity = useMemo(
    () => mergeWorkspaceActivity([...liveActivity, ...liveRuntimeActivity, ...savedTrailActivity], TRAIL_ACTIVITY_LIMIT),
    [liveActivity, liveRuntimeActivity, savedTrailActivity],
  );
  const activeActivity = mergedActivity.find((item) => isRunningActivity(item, mergedActivity));
  const showLiveStatus = currentExecution?.status === "running" && Boolean(activeActivity);
  const liveStatusLabel = primaryAction?.statusLabel ?? attention?.statusLabel ?? readiness.statusLabel ?? ws.liveStatusRunning;
  const liveStatusText = showLiveStatus ? runningActivityText(activeActivity) : null;

  useEffect(() => {
    if (!trailStore) return;
    trailStore.set("/trail/items", mergedActivity);
    trailStore.set("/trail/liveCount", liveActivity.length + runtimeEvents.length);
    trailStore.set("/trail/savedCount", savedTrailActivity.length);
    trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
  }, [liveActivity.length, mergedActivity, runtimeEvents, savedTrailActivity.length, trailStore]);


  const locateHandlers = {
    "locate-workspace-node": (params: Record<string, unknown>) => {
      const nodeId = typeof params.nodeId === "string" ? params.nodeId : undefined;
      if (nodeId) onAction?.(nodeId);
    },
  };
  const resultSpec = buildNodeResultContentSpec(latestCompletedNode, ws.noResultYet);

  const trailSpec = withActivityStreamProps(commandCenter?.documents.trail ?? buildCommandCenterTrailTabSpec({
    activity,
    runtimeEvents,
    copy: {
      ...ws,
      activityTitle: taskWorkspaceActivityMessages.taskTitle,
      activityEmpty: taskWorkspaceActivityMessages.taskEmpty,
    },
    toolLabels: taskWorkspaceActivityMessages.toolLabels,
  }), { active: showLiveStatus });

  const results = (
    <UiSurfaceFrame
      kind="ai-authored"
      label="AI generated execution results"
      description="Validated output from task execution. Product controls stay outside this surface."
      className="min-h-0 flex-1 overflow-y-auto"
      bodyClassName="min-w-0"
    >
      <h3 id="task-workspace-results-heading" className="sr-only">
        {copy.outputTab}
      </h3>
      {showLiveStatus ? (
        <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary-soft/50 px-3 py-2 text-xs text-foreground" role="status" aria-live="polite">
          <span className="mt-0.5 size-3 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-semibold">{ws.liveStatusRunning ?? "Running now"}</span>
            <span className="mt-0.5 block truncate text-muted-foreground">{liveStatusText ?? liveStatusLabel}</span>
          </span>
        </div>
      ) : null}
      <SpecRenderer
        spec={buildCommandCenterOutputTabSpec({ latestCompletedNode, resultSpec, artifacts, copy: ws, apiArtifactsSpec: commandCenter?.documents.output ?? null })}
        handlers={locateHandlers}
      />
    </UiSurfaceFrame>
  );

  const activityTimeline = (
    <UiSurfaceFrame
      kind="runtime-control"
      label={copy.trailTab}
      description="Live execution status and activity."
      className="min-h-0 overflow-y-auto border-l border-l-sky-300/65 pl-2.5"
      bodyClassName="min-w-0"
    >
      <h3 id="task-workspace-activity-heading" className="sr-only">
        {copy.trailTab}
      </h3>
      <SpecRenderer spec={withActivityStreamProps(trailSpec, { density: "rail", active: showLiveStatus })} store={trailStore ?? undefined} />
    </UiSurfaceFrame>
  );

  const activityBelow = (
    <UiSurfaceFrame
      kind="runtime-control"
      label={copy.trailTab}
      description="Live execution status and activity."
      className="mt-2.5 shrink-0"
      bodyClassName="min-w-0"
    >
      <details>
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
          {copy.trailTab}
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto pr-1">
          <SpecRenderer spec={trailSpec} store={trailStore ?? undefined} />
        </div>
      </details>
    </UiSurfaceFrame>
  );

  return (
    <section
      aria-label={ws.executionOverviewAria}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">



        {activityLayout === "side" ? (
          <div className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(10rem,0.28fr)]">
            {results}
            {activityTimeline}
          </div>
        ) : (
          <>
            {results}
            {activityBelow}
          </>
        )}
      </div>
    </section>
  );
}
