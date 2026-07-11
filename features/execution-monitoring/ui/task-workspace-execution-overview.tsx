import { useEffect, useMemo, useState } from "react";
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
import { buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec, type ResultNodeFilter, type ResultNodeOption } from "./build-execution-overview-spec";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../../task-workspace";
import { UiSurfaceFrame } from "./ui-surface-frame";
import { Button } from "../../../apps/web/src/components/ui/button";
import { Badge } from "../../../apps/web/src/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../apps/web/src/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../apps/web/src/components/ui/dropdown-menu";

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
type ResultCollapseCommandState = {
  mode: "collapse" | "expand";
  revision: number;
};


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




type ActivityLayout = "below" | "side";

export function TaskWorkspaceExecutionOverview({
  taskId,
  latestCompletedNode,
  nodes = [],
  artifacts,
  activity,
  currentExecution,
  runtimeEvents = [],
  liveActivity = [],
  copy: copyProp,
  commandCenter,
  activityLayout = "below",
  isExecutionRunning = false,
  executionOutputState = "empty",
  onAction,
}: {
  taskId: string;
  progress: ProgressSummary;
  readiness: ExecutionOverviewCard;
  /** Retained for callers; the Now tab derives its status card from readiness/attention. */
  latestResult?: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  latestCompletedNode: PlanNodeDataModel | null;
  nodes?: PlanNodeDataModel[];
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  currentExecution?: Pick<PlanExecutionResult, "status" | "planOutput"> | null;
  runtimeEvents?: WorkspaceRuntimeEvent[];
  liveActivity?: WorkspaceActivityItem[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  activityLayout?: ActivityLayout;
  isExecutionRunning?: boolean;
  executionOutputState?: "empty" | "partial";
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

  useEffect(() => {
    if (!trailStore) return;
    trailStore.set("/trail/items", mergedActivity);
    trailStore.set("/trail/liveCount", liveActivity.length + runtimeEvents.length);
    trailStore.set("/trail/savedCount", savedTrailActivity.length);
    trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
  }, [liveActivity.length, mergedActivity, runtimeEvents, savedTrailActivity.length, trailStore]);


  const nodeOptions = useMemo<ResultNodeOption[]>(() => {
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
  }, [artifacts, nodes]);
  const [selectedNodeId, setSelectedNodeId] = useState<ResultNodeFilter>("all");

  useEffect(() => {
    if (selectedNodeId !== "all" && !nodeOptions.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId("all");
    }
  }, [nodeOptions, selectedNodeId]);
  const [resultCollapseCommand, setResultCollapseCommand] = useState<ResultCollapseCommandState | null>(null);
  const issueResultCollapseCommand = (mode: ResultCollapseCommandState["mode"]) => {
    setResultCollapseCommand((current) => ({ mode, revision: (current?.revision ?? 0) + 1 }));
  };


  const locateHandlers = {
    "locate-workspace-node": (params: Record<string, unknown>) => {
      const nodeId = typeof params.nodeId === "string" ? params.nodeId : undefined;
      if (nodeId) onAction?.(nodeId);
    },
  };
  const resultSpec = buildNodeResultContentSpec(latestCompletedNode, ws.noResultYet);

  const outputSpec = useMemo(() => buildCommandCenterOutputTabSpec({
    latestCompletedNode,
    resultSpec,
    artifacts,
    copy: ws,
    apiArtifactsSpec: commandCenter?.documents.output ?? null,
    selectedNodeId,
    nodeOptions,
    outputOwnerNodeId: currentExecution?.planOutput?.updatedByNodeId ?? null,
  }), [artifacts, commandCenter?.documents.output, currentExecution?.planOutput?.updatedByNodeId, latestCompletedNode, nodeOptions, resultSpec, selectedNodeId, ws]);

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
    <section
      aria-label={isExecutionRunning ? (ws.liveOutputTitle ?? "Live output") : (ws.finalResultTitle ?? "Final result")}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="min-w-0 space-y-1">
          <h3 id="task-workspace-results-heading" className="font-heading text-base font-semibold text-foreground">
            {isExecutionRunning ? (ws.liveOutputTitle ?? "Live output") : (ws.finalResultTitle ?? "Final result")}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className={isExecutionRunning ? "bg-sky-500/10 text-sky-700 dark:text-sky-200" : "bg-violet-500/10 text-violet-700 dark:text-violet-200"}>{isExecutionRunning ? (executionOutputState === "partial" ? (ws.partialOutputBadge ?? "Partial output") : (ws.awaitingOutputBadge ?? "Awaiting output")) : (ws.aiGeneratedBadge ?? "AI generated")}</Badge>
            <span>{isExecutionRunning ? (executionOutputState === "partial" ? (ws.partialOutputDescription ?? "Output collected so far. Execution is still running.") : (ws.awaitingOutputDescription ?? "Execution is running. Output will appear when a step produces it.")) : (ws.validatedOutputDescription ?? "Validated output from task execution.")}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {nodeOptions.length > 1 ? (
            <Select value={selectedNodeId} onValueChange={(value) => setSelectedNodeId(value as ResultNodeFilter)}>
              <SelectTrigger aria-label={ws.resultNodeFilterLabel ?? "Filter results by node"} size="sm" className="max-w-full bg-background/90 text-xs">
                <SelectValue placeholder={ws.resultNodeFilterAll ?? "All nodes"} />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">{ws.resultNodeFilterAll ?? "All nodes"}</SelectItem>
                {nodeOptions.map((node) => (
                  <SelectItem key={node.id} value={node.id}>{node.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" />}>
              {ws.resultOptions ?? "Result options"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => issueResultCollapseCommand("collapse")}>{ws.collapseAllResults ?? "Collapse all"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => issueResultCollapseCommand("expand")}>{ws.expandAllResults ?? "Expand all"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <SpecRenderer
        spec={outputSpec}
        handlers={locateHandlers}
        resultCollapseCommand={resultCollapseCommand}
        resultCollapseStorageKey={`task:${taskId}:execution-result`}
      />
    </section>
  );

  const activityTimeline = (
    <UiSurfaceFrame
      kind="runtime-control"
      label={copy.trailTab}
      description={isExecutionRunning ? "Live execution status and activity." : ws.completedActivityDescription ?? "Execution events and tool activity for this completed run."}
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
      description={isExecutionRunning ? "Live execution status and activity." : ws.completedActivityDescription ?? "Execution events and tool activity for this completed run."}
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
