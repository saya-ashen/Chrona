import { useEffect, useMemo, useRef, useState } from "react";
import { createStateStore } from "@json-render/react";
import { buildResultSpec, type UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts";
import {
  runtimeEventsToWorkspaceActivity,
  type PlanNodeDataModel,
  type WorkspaceActivityItem,
  type WorkspaceArtifactItem,
} from "@features/task-workspace/public/workspace-integration";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import {
  buildCommandCenterOutputTabSpec,
  type ResultNodeFilter,
} from "./build-execution-overview-spec";
import {
  buildExecutionActivityState,
  buildNodeResultContentSpec,
  buildResultNodeOptions,
  collectLiveResult,
  commandCenterTrailItems,
  hasCommandCenterOutput,
  sameLiveResult,
  TRAIL_ACTIVITY_LIMIT,
} from "./execution-overview-model";

const LIVE_RESULT_UPDATE_INTERVAL_MS = 100;

type TrailCommandCenter = {
  documents: {
    trail: UiDocument;
    output: UiDocument;
  };
};

type ExecutionActivityInput = {
  activity: WorkspaceActivityItem[];
  commandCenter?: TrailCommandCenter | null;
  isExecutionRunning: boolean;
  liveActivity: WorkspaceActivityItem[];
  nodes: PlanNodeDataModel[];
  runtimeEvents: WorkspaceRuntimeEvent[];
  currentExecution?: Pick<PlanExecutionResult, "status" | "planOutput"> | null;
};

export function useExecutionOverviewActivity({
  activity,
  commandCenter,
  currentExecution,
  isExecutionRunning,
  liveActivity,
  nodes,
  runtimeEvents,
}: ExecutionActivityInput) {
  const trailStore = useMemo(
    () => commandCenter?.documents.trail
      ? createStateStore(commandCenter.documents.trail.state ?? {})
      : null,
    [commandCenter?.documents.trail],
  );
  const savedTrailActivity = useMemo(
    () => commandCenter?.documents.trail ? commandCenterTrailItems(commandCenter) : activity,
    [activity, commandCenter],
  );
  const liveRuntimeActivity = useMemo(
    () => runtimeEventsToWorkspaceActivity(runtimeEvents, TRAIL_ACTIVITY_LIMIT),
    [runtimeEvents],
  );
  const executionActivity = useMemo(
    () => buildExecutionActivityState({
      nodes,
      liveActivity,
      liveRuntimeActivity,
      savedTrailActivity,
      runtimeEvents,
      executionStatus: currentExecution?.status,
      isExecutionRunning,
      finalizationStatus: currentExecution?.planOutput?.finalization?.status,
    }),
    [currentExecution?.planOutput?.finalization?.status, currentExecution?.status, isExecutionRunning, liveActivity, liveRuntimeActivity, nodes, runtimeEvents, savedTrailActivity],
  );

  useEffect(() => {
    if (!trailStore) return;
    trailStore.set("/trail/items", executionActivity.activityItems);
    trailStore.set("/trail/liveCount", liveActivity.length + runtimeEvents.length);
    trailStore.set("/trail/savedCount", savedTrailActivity.length);
    trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
  }, [executionActivity.activityItems, liveActivity.length, runtimeEvents, savedTrailActivity.length, trailStore]);

  return executionActivity;
}

function useBufferedLiveResult(runtimeEvents: WorkspaceRuntimeEvent[]) {
  const nextResult = useMemo(() => collectLiveResult(runtimeEvents), [runtimeEvents]);
  const [publishedResult, setPublishedResult] = useState(nextResult);
  const publishedResultRef = useRef(publishedResult);
  const latestResultRef = useRef(nextResult);
  const lastPublishedAtRef = useRef(performance.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestResultRef.current = nextResult;

  useEffect(() => {
    if (sameLiveResult(publishedResultRef.current, nextResult)) return;
    const publish = () => {
      timerRef.current = null;
      const latestResult = latestResultRef.current;
      if (sameLiveResult(publishedResultRef.current, latestResult)) return;
      publishedResultRef.current = latestResult;
      lastPublishedAtRef.current = performance.now();
      setPublishedResult(latestResult);
    };
    const elapsed = performance.now() - lastPublishedAtRef.current;
    if (publishedResultRef.current === null || nextResult === null || elapsed >= LIVE_RESULT_UPDATE_INTERVAL_MS) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      publish();
      return;
    }
    if (timerRef.current === null) timerRef.current = setTimeout(publish, LIVE_RESULT_UPDATE_INTERVAL_MS - elapsed);
  }, [nextResult]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return publishedResult;
}

type ExecutionOutputInput = {
  artifacts: WorkspaceArtifactItem[];
  commandCenter?: TrailCommandCenter | null;
  currentExecution?: Pick<PlanExecutionResult, "status" | "planOutput"> | null;
  executionIsActive: boolean;
  latestCompletedNode: PlanNodeDataModel | null;
  nodes: PlanNodeDataModel[];
  onAction?: (nodeId?: string) => void;
  workspaceCopy: Record<string, string | undefined>;
  runtimeEvents: WorkspaceRuntimeEvent[];
};

export function useExecutionOverviewOutput({
  artifacts,
  commandCenter,
  currentExecution,
  executionIsActive,
  latestCompletedNode,
  nodes,
  onAction,
  runtimeEvents,
  workspaceCopy,
}: ExecutionOutputInput) {
  const nodeOptions = useMemo(() => buildResultNodeOptions(nodes, artifacts), [artifacts, nodes]);
  const [selectedNodeId, setSelectedNodeId] = useState<ResultNodeFilter>("all");
  useEffect(() => {
    if (selectedNodeId !== "all" && !nodeOptions.some((node) => node.id === selectedNodeId)) setSelectedNodeId("all");
  }, [nodeOptions, selectedNodeId]);
  const [resultCollapseCommand, setResultCollapseCommand] = useState<{
    mode: "collapse" | "expand";
    revision: number;
  } | null>(null);
  const onCollapseCommand = (mode: "collapse" | "expand") => {
    setResultCollapseCommand((current) => ({ mode, revision: (current?.revision ?? 0) + 1 }));
  };
  const handlers = useMemo(() => ({
    "locate-workspace-node": (params: Record<string, unknown>) => {
      const nodeId = typeof params.nodeId === "string" ? params.nodeId : undefined;
      if (nodeId) onAction?.(nodeId);
    },
  }), [onAction]);
  const liveResult = useBufferedLiveResult(runtimeEvents);
  const liveResultSpec = useMemo(
    () => executionIsActive && liveResult ? buildResultSpec([{
      kind: "markdown",
      title: workspaceCopy.currentStepOutputTitle ?? "Current step output",
      content: liveResult.content,
    }]) : null,
    [executionIsActive, liveResult?.content, workspaceCopy.currentStepOutputTitle],
  );
  const resultSpec = useMemo(
    () => buildNodeResultContentSpec(latestCompletedNode, workspaceCopy.noResultYet ?? ""),
    [latestCompletedNode, workspaceCopy.noResultYet],
  );
  const outputSpec = useMemo(() => buildCommandCenterOutputTabSpec({
    latestCompletedNode,
    resultSpec,
    artifacts,
    copy: workspaceCopy,
    liveResultSpec,
    liveResultOwnerNodeId: liveResult?.ownerNodeId ?? null,
    apiArtifactsSpec: hasCommandCenterOutput(commandCenter?.documents.output)
      ? commandCenter?.documents.output ?? null
      : null,
    selectedNodeId,
    nodeOptions,
    outputOwnerNodeId: currentExecution?.planOutput?.updatedByNodeId ?? null,
  }), [artifacts, commandCenter?.documents.output, currentExecution?.planOutput?.updatedByNodeId, latestCompletedNode, liveResult?.ownerNodeId, liveResultSpec, nodeOptions, resultSpec, selectedNodeId, workspaceCopy]);

  return { handlers, liveResultSpec, nodeOptions, onCollapseCommand, outputSpec, resultCollapseCommand, selectedNodeId, setSelectedNodeId };
}
