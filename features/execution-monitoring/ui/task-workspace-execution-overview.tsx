import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type {
	ExecutionOverviewCard,
	PlanNodeDataModel,
	ProgressSummary,
	WorkspaceActivityItem,
	WorkspaceArtifactItem,
} from "@features/task-workspace/public/workspace-integration";
import {
	ExecutionEvidence,
	ExecutionOverviewContent,
} from "./execution-overview-content";
import {
	DEFAULT_COMMAND_CENTER_COPY,
	resultStatusFor,
	type CommandCenterCopy,
} from "./execution-overview-model";
import {
	useExecutionOverviewActivity,
	useExecutionOverviewOutput,
} from "./execution-overview-hooks";

type OverviewAction = (nodeId?: string) => void;
type ActivityLayout = "below" | "side";

export type { CommandCenterCopy } from "./execution-overview-model";

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

export type TaskWorkspaceExecutionOverviewProps = {
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
	onRetryFinalization?: () => Promise<void> | void;
	isRetryingFinalization?: boolean;
	finalizationRetryError?: string | null;
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
};

function ExecutionFailureAlert({
	summary,
}: {
	summary: string | null;
}): ReactNode {
	if (!summary) return null;
	return (
		<div
			className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2"
			role="alert"
		>
			<TriangleAlert
				className="mt-0.5 size-4 shrink-0 text-destructive"
				aria-hidden
			/>
			<div className="min-w-0">
				<p className="text-xs font-semibold text-destructive">
					Run had a failure
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
			</div>
		</div>
	);
}

export function TaskWorkspaceExecutionEvidence({
	activity,
	commandCenter,
	currentExecution,
	isExecutionRunning = false,
	liveActivity = [],
	nodes = [],
	runtimeEvents = [],
}: Pick<
	TaskWorkspaceExecutionOverviewProps,
	| "activity"
	| "commandCenter"
	| "currentExecution"
	| "isExecutionRunning"
	| "liveActivity"
	| "nodes"
	| "runtimeEvents"
>) {
	const { messages } = useI18n();
	const activityState = useExecutionOverviewActivity({
		activity,
		commandCenter,
		currentExecution,
		isExecutionRunning,
		liveActivity,
		nodes,
		runtimeEvents,
	});
	return (
		<ExecutionEvidence
			items={activityState.activityItems}
			runtimeEvents={runtimeEvents}
			isLive={activityState.executionIsLive}
			activitySummary={activityState.activitySummary}
			copy={messages.components.taskWorkspace}
		/>
	);
}

export function TaskWorkspaceExecutionOverview({
	taskId,
	latestCompletedNode,
	nodes = [],
	artifacts,
	activity,
	currentExecution,
	onRetryFinalization,
	isRetryingFinalization = false,
	finalizationRetryError,
	runtimeEvents = [],
	liveActivity = [],
	copy: copyProp,
	commandCenter,
	isExecutionRunning = false,
	executionResultState = "waiting",
	onAction,
}: TaskWorkspaceExecutionOverviewProps) {
	const { messages } = useI18n();
	const workspaceCopy = messages.components.taskWorkspace;
	const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };
	const activityState = useExecutionOverviewActivity({
		activity,
		commandCenter,
		currentExecution,
		isExecutionRunning,
		liveActivity,
		nodes,
		runtimeEvents,
	});
	const output = useExecutionOverviewOutput({
		artifacts,
		commandCenter,
		currentExecution,
		executionIsActive: activityState.executionIsActive,
		latestCompletedNode,
		nodes,
		onAction,
		runtimeEvents,
		workspaceCopy,
	});

	return (
		<ExecutionOverviewContent
			taskId={taskId}
			workspaceCopy={workspaceCopy}
			copy={copy}
			executionIsActive={activityState.executionIsActive}
			failureAlert={
				activityState.executionHasFatalFailure ? (
					<ExecutionFailureAlert summary={activityState.failureSummary} />
				) : null
			}
			status={resultStatusFor(activityState)}
			hasAvailableResult={
				Boolean(output.liveResultSpec) || executionResultState === "available"
			}
			finalizationRetryError={finalizationRetryError}
			onRetryFinalization={onRetryFinalization}
			isRetryingFinalization={isRetryingFinalization}
			nodeOptions={output.nodeOptions}
			selectedNodeId={output.selectedNodeId}
			onSelectedNodeIdChange={output.setSelectedNodeId}
			onCollapseCommand={output.onCollapseCommand}
			outputSpec={output.outputSpec}
			handlers={output.handlers}
			resultCollapseCommand={output.resultCollapseCommand}
			waitingForHuman={activityState.executionIsWaitingForHuman}
			isLive={activityState.executionIsLive}
			activityItems={activityState.activityItems}
			activitySummary={activityState.activitySummary}
			provider={runtimeEvents.at(-1)?.provider.label}
			runtimeEvents={runtimeEvents}
		/>
	);
}
