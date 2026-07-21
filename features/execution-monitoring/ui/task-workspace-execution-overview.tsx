import { Activity, TerminalSquare, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createStateStore } from "@json-render/react";
import { buildResultSpec, type UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type {
  ExecutionOverviewCard,
  PlanNodeDataModel,
  ProgressSummary,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "@features/task-workspace";
import { ActivityTimeline, mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity, SpecRenderer } from "@features/task-workspace";
import {
  buildCommandCenterOutputTabSpec,
  type ResultNodeFilter,
  type ResultNodeOption,
} from "./build-execution-overview-spec";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shared/ui";

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
  actionHandlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
  onActionStateChange?: (
    changes: Array<{ path: string; value: unknown }>,
  ) => void;
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

const TRAIL_ACTIVITY_LIMIT = 300;
type ResultCollapseCommandState = {
  mode: "collapse" | "expand";
  revision: number;
};

function commandCenterTrailItems(
  commandCenter?: { documents: { trail: UiDocument } } | null,
) {
  const items = commandCenter?.documents.trail.state?.trail;
  if (!items || typeof items !== "object" || Array.isArray(items)) return [];
  const trailItems = (items as { items?: unknown }).items;
  return Array.isArray(trailItems)
    ? (trailItems as WorkspaceActivityItem[])
    : [];
}

function hasCommandCenterOutput(document: UiDocument | null | undefined) {
  if (!document?.root) return false;
  const root = document.elements[document.root];
  const children = root?.children ?? [];
  if (children.length !== 1) return children.length > 0;
  const onlyChild = document.elements[children[0]!];
  return onlyChild?.type !== "WorkspaceArtifactList"
    || (onlyChild.children?.length ?? 0) > 0;
}

function buildNodeResultContentSpec(
  node: PlanNodeDataModel | null,
  emptyMessage: string,
) {
  const summary = node?.result?.outputSummary?.trim()
    || node?.completionSummary?.trim();
  if (!summary) return buildResultSpec([], { emptyMessage });
  return buildResultSpec([
    { kind: "markdown", title: node?.title, content: summary },
  ]);
}

function isAssistantTextEvent(
  runtimeEvent: WorkspaceRuntimeEvent,
): runtimeEvent is WorkspaceRuntimeEvent & {
  event: Extract<WorkspaceRuntimeEvent["event"], { type: "assistant_text_delta" }>;
} {
  return runtimeEvent.event.type === "assistant_text_delta";
}

function buildLiveResultContentSpec(runtimeEvents: WorkspaceRuntimeEvent[], title: string) {
  const text = runtimeEvents
    .filter(isAssistantTextEvent)
    .map((runtimeEvent) => runtimeEvent.event.text)
    .join("")
    .trim();
  if (!text) return null;
  return buildResultSpec([
    { kind: "markdown", title, content: text },
  ]);
}

function isSameToolActivity(
  left: WorkspaceActivityItem,
  right: WorkspaceActivityItem,
) {
  return (
    left.sourceNodeId === right.sourceNodeId &&
    left.runId === right.runId &&
    left.nativeRunId === right.nativeRunId &&
    left.tool?.name === right.tool?.name
  );
}

function hasCompletedToolActivity(
  item: WorkspaceActivityItem,
  items: WorkspaceActivityItem[],
) {
  if (item.tool?.state !== "started") return false;
  return items.some(
    (candidate) =>
      candidate.kind === "tool_completed" &&
      candidate.tool?.state !== "started" &&
      isSameToolActivity(item, candidate),
  );
}

function isRunningActivity(
  item: WorkspaceActivityItem,
  items: WorkspaceActivityItem[],
) {
  if (item.tool?.state === "started")
    return !hasCompletedToolActivity(item, items);
  if (item.rawEventType === "turn_start" || item.rawEventType === "turn_end") return false;
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
  isExecutionRunning = false,
  executionResultState = "waiting",
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
  executionResultState?: "waiting" | "available";
  onAction?: OverviewAction;
  commandCenter?: {
    documents: {
      now: UiDocument;
      output: UiDocument;
      trail: UiDocument;
    };
  } | null;
  commandCenterActionHandlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
}) {
  const { messages } = useI18n();
  const ws = messages.components.taskWorkspace;
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };

  const trailStore = useMemo(
    () =>
      commandCenter?.documents.trail
        ? createStateStore(commandCenter.documents.trail.state ?? {})
        : null,
    [commandCenter?.documents.trail],
  );
  const savedTrailActivity = useMemo(
    () =>
      commandCenter?.documents.trail
        ? commandCenterTrailItems(commandCenter)
        : activity,
    [activity, commandCenter],
  );
  const liveRuntimeActivity = useMemo(
    () => runtimeEventsToWorkspaceActivity(runtimeEvents, TRAIL_ACTIVITY_LIMIT),
    [runtimeEvents],
  );
  const mergedActivity = useMemo(
    () =>
      mergeWorkspaceActivity(
        [...liveActivity, ...liveRuntimeActivity, ...savedTrailActivity],
        TRAIL_ACTIVITY_LIMIT,
      ),
    [liveActivity, liveRuntimeActivity, savedTrailActivity],
  );
  const activeActivity = mergedActivity.find((item) =>
    isRunningActivity(item, mergedActivity),
  );
  const executionIsWaitingForHuman = currentExecution?.status === "waiting_for_user"
    || currentExecution?.status === "waiting_for_approval";
  const executionIsLive = !executionIsWaitingForHuman && (
    isExecutionRunning
    || currentExecution?.status === "running"
    || currentExecution?.status === "started"
  );
  const executionIsActive = executionIsLive || executionIsWaitingForHuman;
  const activityHeartbeat = useMemo<WorkspaceActivityItem | null>(() => {
    if (!executionIsLive || activeActivity) return null;
    const latestRuntime = runtimeEvents.at(-1);
    return {
      id: "execution-live-heartbeat",
      kind: "provider_run",
      title: "AI is working",
      summary: latestRuntime?.nodeTitle
        ? `Working on ${latestRuntime.nodeTitle}`
        : "Working on the current step",
      description: "Execution is active. Waiting for the provider's next progress update.",
      tone: "info",
      timestamp: latestRuntime?.timestamp ?? null,
      sourceNodeId: latestRuntime?.nodeId,
      sourceNodeTitle: latestRuntime?.nodeTitle,
      provider: latestRuntime?.provider,
      runtimeName: latestRuntime?.runtimeName,
    };
  }, [activeActivity, executionIsLive, runtimeEvents]);
  const displayedActivity = useMemo(
    () => activityHeartbeat
      ? mergeWorkspaceActivity([activityHeartbeat, ...mergedActivity], TRAIL_ACTIVITY_LIMIT)
      : mergedActivity,
    [activityHeartbeat, mergedActivity],
  );
  const runningResultActivity = activeActivity ?? activityHeartbeat;
  const currentActivityDetail = runningResultActivity?.tool?.preview
    ?? runningResultActivity?.assistant?.text
    ?? runningResultActivity?.summary
    ?? runningResultActivity?.description;
  const currentActivityInput = runningResultActivity?.tool?.inputSummary;
  const currentActivityTitle = runningResultActivity?.tool?.label
    ?? runningResultActivity?.tool?.name
    ?? runningResultActivity?.title
    ?? ws.executionWorkingFallback
    ?? "AI is working";
  const showLiveStatus = executionIsLive;
  const activityItems = useMemo(
    () => [...displayedActivity].reverse(),
    [displayedActivity],
  );
  const failedActivityCount = activityItems.filter((item) => item.tone === "danger").length;
  const activitySummary = executionIsLive
    ? `${activityItems.length} events · live`
    : `${activityItems.length} events${failedActivityCount > 0 ? ` · ${failedActivityCount} failed` : ""}`;
  const failedActivity = activityItems.find((item) => item.tone === "danger");
  const failedNode = nodes.find((node) => node.status === "failed");
  const failedNodeError = failedNode?.result?.error?.trim()
    || (typeof failedNode?.metadata?.error === "string" ? failedNode.metadata.error.trim() : "")
    || null;
  const executionHasFatalFailure = currentExecution?.status === "failed"
    || currentExecution?.status === "blocked";
  const failureSummary = failedNodeError
    || failedActivity?.summary
    || (failedNode ? `${failedNode.title} failed.` : null);
  const failureAlert = executionHasFatalFailure && failureSummary ? (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2" role="alert">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-destructive">Run had a failure</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{failureSummary}</p>
      </div>
    </div>
  ) : null;
  const activityContent = (
    <ActivityTimeline
      items={activityItems}
      density="detailed"
      active={showLiveStatus}
      transcript
    />
  );

  useEffect(() => {
    if (!trailStore) return;
    trailStore.set("/trail/items", displayedActivity);
    trailStore.set(
      "/trail/liveCount",
      liveActivity.length + runtimeEvents.length,
    );
    trailStore.set("/trail/savedCount", savedTrailActivity.length);
    trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
  }, [
    displayedActivity,
    liveActivity.length,
    runtimeEvents,
    savedTrailActivity.length,
    trailStore,
  ]);

  const nodeOptions = useMemo<ResultNodeOption[]>(() => {
    const byId = new Map<string, ResultNodeOption>();
    for (const node of nodes) {
      byId.set(node.id, {
        id: node.id,
        title: node.title,
        status: node.statusLabel ?? node.status,
      });
    }
    for (const artifact of artifacts) {
      if (artifact.sourceNodeId && !byId.has(artifact.sourceNodeId)) {
        byId.set(artifact.sourceNodeId, {
          id: artifact.sourceNodeId,
          title: artifact.sourceNodeId,
        });
      }
    }
    return Array.from(byId.values());
  }, [artifacts, nodes]);
  const [selectedNodeId, setSelectedNodeId] = useState<ResultNodeFilter>("all");

  useEffect(() => {
    if (
      selectedNodeId !== "all" &&
      !nodeOptions.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId("all");
    }
  }, [nodeOptions, selectedNodeId]);
  const [resultCollapseCommand, setResultCollapseCommand] =
    useState<ResultCollapseCommandState | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const issueResultCollapseCommand = (
    mode: ResultCollapseCommandState["mode"],
  ) => {
    setResultCollapseCommand((current) => ({
      mode,
      revision: (current?.revision ?? 0) + 1,
    }));
  };

  const locateHandlers = {
    "locate-workspace-node": (params: Record<string, unknown>) => {
      const nodeId =
        typeof params.nodeId === "string" ? params.nodeId : undefined;
      if (nodeId) onAction?.(nodeId);
    },
  };
  const latestLiveResultEvent = [...runtimeEvents]
    .reverse()
    .find((runtimeEvent) => runtimeEvent.event.type === "assistant_text_delta");
  const liveResultSpec = executionIsActive
    ? buildLiveResultContentSpec(
      runtimeEvents,
      ws.currentStepOutputTitle ?? "Current step output",
    )
    : null;
  const resultSpec = buildNodeResultContentSpec(
    latestCompletedNode,
    ws.noResultYet,
  );

  const outputSpec = useMemo(
    () =>
      buildCommandCenterOutputTabSpec({
        latestCompletedNode,
        resultSpec,
        artifacts,
        copy: ws,
        liveResultSpec,
        liveResultOwnerNodeId: latestLiveResultEvent?.nodeId ?? null,
        apiArtifactsSpec: hasCommandCenterOutput(commandCenter?.documents.output)
          ? (commandCenter?.documents.output ?? null)
          : null,
        selectedNodeId,
        nodeOptions,
        outputOwnerNodeId:
          currentExecution?.planOutput?.updatedByNodeId ?? null,
      }),
    [
      artifacts,
      commandCenter?.documents.output,
      currentExecution?.planOutput?.updatedByNodeId,
      latestLiveResultEvent?.nodeId,
      liveResultSpec,
      latestCompletedNode,
      nodeOptions,
      resultSpec,
      selectedNodeId,
      ws,
    ],
  );


  const results = (
    <section
      aria-label={
        executionIsActive
          ? (ws.stageResultsTitle ?? "Stage results")
          : (ws.finalResultTitle ?? "Final result")
      }
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="min-w-0 space-y-1">
          <h3
            id="task-workspace-results-heading"
            className="font-heading text-base font-semibold text-foreground"
          >
            {executionIsActive
              ? (ws.stageResultsTitle ?? "Stage results")
              : (ws.finalResultTitle ?? "Final result")}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={
                executionIsActive
                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-200"
                  : "bg-violet-500/10 text-violet-700 dark:text-violet-200"
              }
            >
              {executionIsActive
                ? liveResultSpec || executionResultState === "available"
                  ? (ws.resultsAvailableBadge ?? "Results available")
                  : (ws.resultsPendingBadge ?? "No result yet")
                : (ws.aiGeneratedBadge ?? "AI generated")}
            </Badge>
            <span>
              {executionIsActive
                ? liveResultSpec || executionResultState === "available"
                  ? (ws.resultsAvailableDescription ??
                    "Current output and completed step results collected during this run.")
                  : (ws.resultsPendingDescription ??
                    "The current step has not produced viewable output yet. Follow execution activity for live progress.")
                : (ws.validatedOutputDescription ??
                  "Validated output from task execution.")}
            </span>
          </div>
          {showLiveStatus ? (
            <div
              className="mt-3 flex items-start gap-3 rounded-xl border border-sky-300/70 bg-sky-500/5 px-3 py-3 text-sm"
              role="status"
              aria-live="polite"
              aria-label={
                ws.executionProducingOutputAria ??
                "Execution is producing output"
              }
            >
              <span
                className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-600 motion-reduce:animate-none"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-200">
                  {ws.currentActivity ?? "Current activity"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{currentActivityTitle}</p>
                  {runningResultActivity?.tool?.state ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {runningResultActivity.tool.state}
                    </Badge>
                  ) : null}
                </div>
                {currentActivityDetail ? (
                  <p className="max-w-3xl whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {currentActivityDetail}
                  </p>
                ) : null}
                {currentActivityInput ? (
                  <div className="mt-1 rounded-lg border border-sky-300/50 bg-background/70 px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Input</p>
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
                      {currentActivityInput}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {nodeOptions.length > 1 ? (
            <Select
              value={selectedNodeId}
              onValueChange={(value) =>
                setSelectedNodeId(value as ResultNodeFilter)
              }
            >
              <SelectTrigger
                aria-label={
                  ws.resultNodeFilterLabel ?? "Filter results by node"
                }
                size="sm"
                className="max-w-full bg-background/90 text-xs"
              >
                <SelectValue
                  placeholder={ws.resultNodeFilterAll ?? "All nodes"}
                />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">
                  {ws.resultNodeFilterAll ?? "All nodes"}
                </SelectItem>
                {nodeOptions.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                />
              }
            >
              {ws.resultOptions ?? "Result options"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => issueResultCollapseCommand("collapse")}
              >
                {ws.collapseAllResults ?? "Collapse all"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => issueResultCollapseCommand("expand")}
              >
                {ws.expandAllResults ?? "Expand all"}
              </DropdownMenuItem>
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

  const activityHeader = (
    <div className="border-b border-border/60 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-primary" aria-hidden />
            <h3 className="font-heading text-base font-semibold text-foreground">Agent transcript</h3>
            <Badge variant={executionIsLive ? "default" : "secondary"}>
              {executionIsLive ? "Live" : executionIsWaitingForHuman ? "Paused" : "Completed"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{activitySummary}</p>
        </div>
        {runtimeEvents.at(-1)?.provider ? (
          <span className="text-xs font-medium text-muted-foreground">{runtimeEvents.at(-1)?.provider}</span>
        ) : null}
      </div>
    </div>
  );

  const activityTimeline = (
    <section
      aria-label={copy.trailTab}
      className="min-h-0 overflow-y-auto rounded-xl border border-border/60 bg-background/70 p-4"
    >
      {activityHeader}
      <div className="mt-3">{activityContent}</div>
    </section>
  );

  const completedActivitySheet = !executionIsActive ? (
    <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="fixed right-0 top-1/2 z-40 h-auto min-w-11 -translate-y-1/2 touch-manipulation rounded-r-none border-r-0 bg-background/95 px-2.5 py-3 shadow-lg backdrop-blur transition-colors supports-[backdrop-filter]:bg-background/85"
            aria-label={`Open Agent transcript · ${activityItems.length} events`}
          />
        }
      >
        <span className="flex flex-col items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          <span className="[writing-mode:vertical-rl] text-[10px] font-semibold tracking-[0.08em]">Agent transcript</span>
          <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px]">{activityItems.length}</Badge>
        </span>
      </SheetTrigger>
      <SheetContent className="w-[92vw] max-w-[62rem] overflow-y-auto data-[side=right]:sm:w-[72vw] data-[side=right]:sm:max-w-[62rem]">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle>Agent transcript</SheetTitle>
          <SheetDescription>Intent, tool calls, results, and execution state in chronological order.</SheetDescription>
        </SheetHeader>
        <div className="px-5 pb-8 pt-4">{activityHeader}<div className="mt-4">{activityContent}</div></div>
      </SheetContent>
    </Sheet>
  ) : null;


  return (
    <section
      aria-label={ws.executionOverviewAria}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {failureAlert}
      {executionIsActive ? (
        <Tabs defaultValue="activity" className="min-h-0 flex-1 xl:hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="results">{copy.outputTab}</TabsTrigger>
            <TabsTrigger value="activity">{copy.trailTab}</TabsTrigger>
          </TabsList>
          <TabsContent value="results" className="min-h-0 overflow-y-auto pt-3">{results}</TabsContent>
          <TabsContent value="activity" className="min-h-0 overflow-y-auto pt-3">{activityTimeline}</TabsContent>
        </Tabs>
      ) : null}
      {!executionIsActive ? completedActivitySheet : null}
      <div className={executionIsActive ? "hidden min-h-0 flex-1 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] xl:gap-4" : "min-h-0 flex-1"}>
        {results}
        {executionIsActive ? activityTimeline : null}
      </div>
    </section>
  );
}
