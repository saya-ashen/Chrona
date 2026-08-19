import { useEffect, useMemo, useState } from "react";
import { createStateStore } from "@json-render/react";
import { type UiDocument } from "@chrona/ui-protocol";
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
	commandCenterTrailItems,
	hasCommandCenterOutput,
	RESULT_FINALIZATION_STALE_MS,
	TRAIL_ACTIVITY_LIMIT,
} from "./execution-overview-model";

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
	const finalization = currentExecution?.planOutput?.finalization;
	const finalizationStartedAt =
		finalization?.status === "Running" ? finalization.startedAt : undefined;
	const [finalizationNow, setFinalizationNow] = useState(() => Date.now());
	useEffect(() => {
		if (!finalizationStartedAt) return;
		const startedAtMs = Date.parse(finalizationStartedAt);
		if (!Number.isFinite(startedAtMs)) return;
		const timeout = setTimeout(
			() => setFinalizationNow(Date.now()),
			Math.max(0, startedAtMs + RESULT_FINALIZATION_STALE_MS - Date.now()),
		);
		return () => clearTimeout(timeout);
	}, [finalizationStartedAt]);
	const executionActivity = useMemo(
		() =>
			buildExecutionActivityState({
				nodes,
				liveActivity,
				liveRuntimeActivity,
				savedTrailActivity,
				runtimeEvents,
				executionStatus: currentExecution?.status,
				isExecutionRunning,
				finalization,
				nowMs: finalizationNow,
			}),
		[
			currentExecution?.status,
			finalization,
			finalizationNow,
			isExecutionRunning,
			liveActivity,
			liveRuntimeActivity,
			nodes,
			runtimeEvents,
			savedTrailActivity,
		],
	);

	useEffect(() => {
		if (!trailStore) return;
		trailStore.set("/trail/items", executionActivity.activityItems);
		trailStore.set(
			"/trail/liveCount",
			liveActivity.length + runtimeEvents.length,
		);
		trailStore.set("/trail/savedCount", savedTrailActivity.length);
		trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
	}, [
		executionActivity.activityItems,
		liveActivity.length,
		runtimeEvents,
		savedTrailActivity.length,
		trailStore,
	]);

	return executionActivity;
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
	executionIsActive: _executionIsActive,
	latestCompletedNode,
	nodes,
	onAction,
	workspaceCopy,
	runtimeEvents: _runtimeEvents,
}: ExecutionOutputInput) {
	const nodeOptions = useMemo(
		() => buildResultNodeOptions(nodes, artifacts),
		[artifacts, nodes],
	);
	const [selectedNodeId, setSelectedNodeId] = useState<ResultNodeFilter>("all");
	useEffect(() => {
		if (
			selectedNodeId !== "all" &&
			!nodeOptions.some((node) => node.id === selectedNodeId)
		)
			setSelectedNodeId("all");
	}, [nodeOptions, selectedNodeId]);
	const [resultCollapseCommand, setResultCollapseCommand] = useState<{
		mode: "collapse" | "expand";
		revision: number;
	} | null>(null);
	const onCollapseCommand = (mode: "collapse" | "expand") => {
		setResultCollapseCommand((current) => ({
			mode,
			revision: (current?.revision ?? 0) + 1,
		}));
	};
	const handlers = useMemo(
		() => ({
			"locate-workspace-node": (params: Record<string, unknown>) => {
				const nodeId =
					typeof params.nodeId === "string" ? params.nodeId : undefined;
				if (nodeId) onAction?.(nodeId);
			},
		}),
		[onAction],
	);
	const liveResultSpec = null;
	const resultSpec = useMemo(
		() =>
			buildNodeResultContentSpec(
				latestCompletedNode,
				workspaceCopy.noResultYet ?? "",
			),
		[latestCompletedNode, workspaceCopy.noResultYet],
	);
	const finalizedResultReady =
		currentExecution?.planOutput?.finalization?.status === "Ready";
	const finalizedResultSpec = finalizedResultReady
		? (commandCenter?.documents.output ??
			currentExecution?.planOutput?.finalizedResult?.spec ??
			null)
		: null;
	const outputSpec = useMemo(() => {
		if (finalizedResultSpec) return finalizedResultSpec;
		return buildCommandCenterOutputTabSpec({
			latestCompletedNode,
			resultSpec,
			artifacts,
			copy: workspaceCopy,
			liveResultSpec,
			liveResultOwnerNodeId: null,
			apiArtifactsSpec: hasCommandCenterOutput(commandCenter?.documents.output)
				? (commandCenter?.documents.output ?? null)
				: null,
			selectedNodeId,
			nodeOptions,
			outputOwnerNodeId: currentExecution?.planOutput?.updatedByNodeId ?? null,
		});
	}, [
		artifacts,
		commandCenter?.documents.output,
		currentExecution?.planOutput?.updatedByNodeId,
		finalizedResultReady,
		finalizedResultSpec,
		latestCompletedNode,
		nodeOptions,
		resultSpec,
		selectedNodeId,
		workspaceCopy,
	]);

	return {
		handlers,
		liveResultSpec,
		nodeOptions,
		onCollapseCommand,
		outputSpec,
		resultCollapseCommand,
		selectedNodeId,
		setSelectedNodeId,
	};
}
