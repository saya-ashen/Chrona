import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
	type SetStateAction,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@shared/http";
import { useI18n } from "@chrona/i18n";
import { taskPlanReadModelToGraphPlan } from "../plan/task-plan-view-model";
import type { TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import {
	acceptTaskResult,
	dispatchTaskExecutionAction,
	fetchCurrentTaskExecution,
	fetchTaskPlanState,
	retryTaskResultFinalization,
	submitTaskCheckpointAction,
	taskWorkspaceQueryKeys,
	type TaskPlanState,
} from "../model/task-workspace-query";
import {
	canAcceptPlanFromFlow,
	clearPlanFlowError,
	createPlanFlowFromSnapshot,
	failPlanAccept,
	getAcceptPlanErrorFromFlow,
	getPlanGenerationStatusFromFlow,
	isAcceptingPlanFromFlow,
	startPlanAccept,
} from "../model/task-workspace-plan-flow-machine";
import {
	mergeWorkspaceActivity,
	workspaceEventToWorkspaceActivity,
} from "../model/task-workspace-activity";
import type {
	TaskConfigAiClient,
	TaskData,
	TaskPageData,
	WorkspaceActivityItem,
} from "../model/task-workspace-types";
import {
	reconcileTaskPlanGenerationSession,
	stopTaskPlanGenerationSession,
	useTaskPlanGenerationSession,
	type TaskPlanSessionState,
} from "./task-plan-generation-session-store";
import {
	settleWorkspaceCommand,
	shouldPollExecutionFinalization,
	shouldPollPlanSettlement,
	type PendingWorkspaceCommand,
} from "../model/task-workspace-settlement";
import type { TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import type {
	ExecutionActionInput,
	PublicExecutionCheckpoint,
	PublicPlanExecutionResult,
	PlanExecutionSSEEvent,
	SubmitCheckpointActionInput,
	TaskPlanReadModel,
} from "@chrona/contracts";

function fallbackManualFormMessage(key: string) {
	return key === "pages.tasks.manualFormPreparing"
		? "Preparing manual completion form"
		: key === "pages.tasks.manualFormCompleteContinue"
			? "Complete and continue"
			: key === "pages.tasks.manualFormGenerate"
				? "Generate completion form"
				: key === "pages.tasks.manualFormRegenerate"
					? "Regenerate form"
					: key;
}

const STARTING_NODE_STATUS_LABEL = "Starting";
const STARTING_NODE_NEXT_ACTION = "Starting execution...";
export const FINALIZATION_POLL_MAX_ATTEMPTS = 6;
const FINALIZATION_POLL_EXHAUSTED_MESSAGE =
	"Result finalization is still pending. Retry finalization to check again.";

export type WorkspaceRuntimeEvent = Extract<
	PlanExecutionSSEEvent,
	{ type: "runtime_event" }
>;
type WorkspaceExecutionRuntimeSseEvent = TaskWorkspaceSseEvent &
	Omit<WorkspaceRuntimeEvent, "type"> & { type: "execution.runtime_event" };
export type PlanGenerationRequest = {
	userInstruction?: string | null;
	selectedNodeId?: string | null;
	replaceActiveExecution?: boolean;
};

function compactActivityText(value: string) {
	return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

function getRuntimeActivity(event: WorkspaceRuntimeEvent | undefined) {
	if (!event) return null;
	const value = event.event;
	switch (value.type) {
		case "tool_started":
		case "tool_progress":
			return compactActivityText(`Running ${value.label}`);
		case "tool_completed":
			return compactActivityText(
				value.error ? `${value.label} failed` : `${value.label} completed`,
			);
		case "approval_required":
			return "Approval required";
		case "run_status":
			return compactActivityText(value.status);
	}
}

export function appendRuntimeEvent(
	events: WorkspaceRuntimeEvent[],
	event: WorkspaceRuntimeEvent,
) {
	return [...events, event];
}

function isFullRuntimeSseEvent(
	event: TaskWorkspaceSseEvent,
): event is WorkspaceExecutionRuntimeSseEvent {
	return (
		event.type === "execution.runtime_event" &&
		"event" in event &&
		typeof event.event === "object" &&
		event.event !== null &&
		"runtime" in event &&
		typeof event.runtime === "object" &&
		event.runtime !== null &&
		"provider" in event &&
		typeof event.provider === "object" &&
		event.provider !== null
	);
}

function shouldRefreshExecutionSnapshot(event: TaskWorkspaceSseEvent) {
	return (
		event.type === "execution.state.updated" ||
		event.type === "execution.result" ||
		event.type === "checkpoint.result" ||
		event.type === "task_workspace_updated" ||
		event.type === "task_projection_updated"
	);
}

function isPlanGenerationCompletionEvent(event: TaskWorkspaceSseEvent) {
	return (
		event.type === "task_workspace_updated" &&
		event.reason === "plan_generation.completed"
	);
}

function activitySummaryFromPhase(
	phase: TaskPlanSessionState["phase"],
): string {
	switch (phase) {
		case "starting":
		case "loading_task":
		case "requesting_provider":
		case "streaming":
		case "extracting_tool_payload":
		case "compiling":
		case "saving":
			return "Generating plan";
		case "completed":
			return "Plan updated";
		case "error":
		case "done":
			return "Plan generation failed";
		case "idle":
		case "connecting":
			return "Plan ready";
	}
}

function derivePlanStatus(
	savedPlan: TaskData["savedPlan"] | null,
	isGenerationRunning: boolean,
	currentStatus?: TaskPlanState["aiPlanGenerationStatus"],
) {
	if (isGenerationRunning || currentStatus === "generating") {
		return "generating" as const;
	}

	if (savedPlan?.status === "accepted") {
		return "accepted" as const;
	}

	return savedPlan ? ("waiting_acceptance" as const) : ("idle" as const);
}

function comparePlanUpdatedAt(
	pagePlan: NonNullable<TaskData["savedPlan"]>,
	planStatePlan: NonNullable<TaskData["savedPlan"]>,
) {
	const pageUpdatedAt = Date.parse(pagePlan.updatedAt);
	const planStateUpdatedAt = Date.parse(planStatePlan.updatedAt);
	if (!Number.isFinite(pageUpdatedAt) || !Number.isFinite(planStateUpdatedAt))
		return 0;
	return Math.sign(pageUpdatedAt - planStateUpdatedAt);
}

function selectAcceptedPlan(
	pagePlan: NonNullable<TaskData["savedPlan"]>,
	planStatePlan: NonNullable<TaskData["savedPlan"]>,
) {
	if (planStatePlan.status === "accepted" && pagePlan.status !== "accepted")
		return planStatePlan;
	if (pagePlan.status === "accepted" && planStatePlan.status !== "accepted")
		return pagePlan;
	return undefined;
}

/**
 * Reconciles the "true" saved plan from two async sources that can disagree:
 * the page query (`task.savedPlan`) and the plan-state query (`planFlow.savedPlan`).
 * Precedence:
 *   1. If only one side has a plan, use it.
 *   2. Different plan ids → trust the plan-state query (the plan-scoped endpoint
 *      is authoritative for which plan is current).
 *   3. Same id → newer `updatedAt` wins.
 *   4. updatedAt tie → prefer whichever side is `accepted`; otherwise honor
 *      `preferPagePlanOnTie` (page query wins) else the plan-state query.
 * Keep this aligned with the work-block scope resolution: both queries are keyed
 * by the same `selectedWorkBlockId`, so this never mixes plans across work blocks.
 */
function selectWorkspacePlan(
	pagePlan: TaskData["savedPlan"] | null | undefined,
	planStatePlan: TaskData["savedPlan"] | null | undefined,
	options: { preferPagePlanOnTie?: boolean } = {},
) {
	if (!pagePlan) return planStatePlan ?? null;
	if (!planStatePlan) return pagePlan;
	if (pagePlan.id !== planStatePlan.id) return planStatePlan;

	const updatedAtOrder = comparePlanUpdatedAt(pagePlan, planStatePlan);
	if (updatedAtOrder < 0) return planStatePlan;
	if (updatedAtOrder > 0) return pagePlan;

	const acceptedPlan = selectAcceptedPlan(pagePlan, planStatePlan);
	if (acceptedPlan) return acceptedPlan;
	if (options.preferPagePlanOnTie) return pagePlan;

	return planStatePlan;
}

function checkpointActionEmphasis(
	style: PublicExecutionCheckpoint["availableActions"][number]["style"],
) {
	if (style === "primary") return "primary" as const;
	if (style === "danger") return "danger" as const;
	return "default" as const;
}

function checkpointActionKind(
	actionId: PublicExecutionCheckpoint["availableActions"][number]["id"],
) {
	if (actionId === "retry_node") return "retry" as const;
	if (actionId === "resume_after_unblock") return "resolve" as const;
	if (actionId === "cancel_session" || actionId === "fail_task")
		return "trigger" as const;
	return "input" as const;
}

function checkpointFormFields(checkpoint: PublicExecutionCheckpoint) {
	return (
		checkpoint.form?.inputFields.map((field) => {
			const legacy = !("kind" in field);
			const control = legacy
				? field.type === "select"
					? ("select" as const)
					: field.type === "text"
						? ("text" as const)
						: ("textarea" as const)
				: field.kind === "choice"
					? ("choice" as const)
					: field.kind === "boolean"
						? ("boolean" as const)
						: field.multiline
							? ("textarea" as const)
							: ("text" as const);
			const value =
				"value" in field && field.value !== undefined
					? field.value
					: !legacy && field.kind === "choice"
						? (field.defaultValue ?? (field.selection === "multiple" ? [] : ""))
						: !legacy && field.kind === "boolean"
							? (field.defaultValue ?? false)
							: !legacy && field.kind === "text"
								? (field.defaultValue ?? "")
								: "";
			return {
				key: field.name,
				label: field.label,
				description: "description" in field ? field.description : undefined,
				placeholder: !legacy && field.kind === "text" ? field.placeholder : undefined,
				value,
				control,
				required: "required" in field ? field.required : false,
				options: legacy
					? field.options
					: field.kind === "choice"
						? field.options.map((option) => option.value)
						: undefined,
				selection:
					!legacy && field.kind === "choice" ? field.selection : undefined,
			};
		}) ?? []
	);
}

function withCanonicalExecutionActions(
	graphPlan: TaskPlanGraphPlan | null,
	checkpoint: PublicExecutionCheckpoint | null,
	manualFormCopy: {
		completeAndContinue: string;
		generate: string;
		regenerate: string;
	},
) {
	if (!graphPlan) return graphPlan;

	const clearNode = (node: TaskPlanGraphPlan["nodes"][number]) => ({
		...node,
		checkpoint: undefined,
		availableActions: [],
		interactiveFields: [],
		actionable: false,
	});

	if (!checkpoint?.nodeId) {
		return {
			...graphPlan,
			nodes: graphPlan.nodes.map(clearNode),
			steps: graphPlan.steps.map(clearNode),
		} satisfies TaskPlanGraphPlan;
	}

	const decorateNode = (node: TaskPlanGraphPlan["nodes"][number]) => {
		const clearedNode = clearNode(node);
		if (node.id !== checkpoint.nodeId) return clearedNode;
		const actions = checkpoint.availableActions.map((action) => ({
			id: action.id,
			label: action.id === "mark_node_completed"
				? manualFormCopy.completeAndContinue
				: action.id === "retry_node" && action.label === "Generate completion form"
					? manualFormCopy.generate
					: action.id === "retry_node" && action.label === "Regenerate form"
						? manualFormCopy.regenerate
						: action.label,
			kind: checkpointActionKind(action.id),
			emphasis: checkpointActionEmphasis(action.style),
			checkpointId: checkpoint.id,
			checkpointAction: action.id,
			requiresPayload: action.requiresPayload,
		}));
		return {
			...clearedNode,
			checkpoint,
			nextAction: checkpoint.message || node.nextAction,
			interactiveFields: checkpointFormFields(checkpoint),
			availableActions: actions,
			actionable: actions.length > 0,
			metadata: {
				...node.metadata,
				...(checkpoint.form
					? {
							manualCompletionFormSource: checkpoint.form.source,
							manualCompletionFormValidated: checkpoint.form.validated,
							formSurfaceKind: "ai-authored",
							actionSurfaceKind: "runtime-control",
						}
					: {}),
			},
		};
	};

	return {
		...graphPlan,
		nodes: graphPlan.nodes.map(decorateNode),
		steps: graphPlan.steps.map(decorateNode),
	} satisfies TaskPlanGraphPlan;
}

function hasExecutionStartEvidence(
	currentExecution: PublicPlanExecutionResult,
) {
	return Boolean(currentExecution.executionScope);
}

function withStartingReadyNode(
	graphPlan: TaskPlanGraphPlan | null,
	currentExecution: PublicPlanExecutionResult | null,
) {
	if (!graphPlan || !currentExecution) return graphPlan;
	if (
		currentExecution.status !== "running" &&
		currentExecution.status !== "started"
	)
		return graphPlan;
	if (!hasExecutionStartEvidence(currentExecution)) return graphPlan;
	if (
		graphPlan.nodes.some(
			(node) => node.status === "active" || node.status === "in_progress",
		)
	)
		return graphPlan;

	const startingNodeId =
		currentExecution.currentNodeId ??
		graphPlan.currentStepId ??
		graphPlan.nodes.find((node) => node.status === "ready")?.id ??
		null;
	if (!startingNodeId) return graphPlan;

	const target = graphPlan.nodes.find((node) => node.id === startingNodeId);
	if (!target || target.status !== "ready") return graphPlan;

	const decorateNode = (node: TaskPlanGraphPlan["nodes"][number]) => {
		if (node.id !== startingNodeId) return node;
		return {
			...node,
			status: "active" as const,
			group: "active" as const,
			statusLabel: STARTING_NODE_STATUS_LABEL,
			nextAction: STARTING_NODE_NEXT_ACTION,
			interactionType: "observe" as const,
			active: true,
			actionable: false,
			availableActions: [],
			metadata: {
				...node.metadata,
				launchState: "starting",
			},
		} satisfies TaskPlanGraphPlan["nodes"][number];
	};
	const activeNodeIds = Array.from(
		new Set([startingNodeId, ...graphPlan.analytics.activeNodeIds]),
	);

	return {
		...graphPlan,
		nodes: graphPlan.nodes.map(decorateNode),
		steps: graphPlan.steps.map(decorateNode),
		currentStepId: startingNodeId,
		analytics: {
			...graphPlan.analytics,
			activeNodeIds,
			reachableFromActiveIds: Array.from(
				new Set([
					startingNodeId,
					...graphPlan.analytics.reachableFromActiveIds,
				]),
			),
		},
	} satisfies TaskPlanGraphPlan;
}

function samePlanFlowSnapshot(
	left: ReturnType<typeof createPlanFlowFromSnapshot>,
	right: ReturnType<typeof createPlanFlowFromSnapshot>,
) {
	if (left.status !== right.status || left.savedPlan !== right.savedPlan) {
		return false;
	}

	if (left.status === "accepting" && right.status === "accepting") {
		return left.planId === right.planId;
	}

	if (left.status === "failed" && right.status === "failed") {
		return left.planId === right.planId && left.error === right.error;
	}

	return true;
}

type WorkspaceCommandAck = {
	commandId: string;
	taskId: string;
	acceptedAt: string;
};

async function dispatchWorkspaceCommand(
	taskId: string,
	body: Record<string, unknown>,
) {
	return apiJson<WorkspaceCommandAck>(
		`/api/work/${encodeURIComponent(taskId)}/commands`,
		{
			method: "POST",
			body: JSON.stringify(body),
		},
	);
}

function isWorkspaceEventInSelectedScope(
	event: TaskWorkspaceSseEvent,
	selectedWorkBlockId: string | null,
) {
	return (event.workBlockId ?? null) === selectedWorkBlockId;
}

export function useTaskWorkspacePlanState(
	task: TaskData,
	refreshWorkspace: () => Promise<void>,
	workspaceEvents: TaskWorkspaceSseEvent[] = [],
	availableAiClients?: TaskConfigAiClient[],
) {
	const queryClient = useQueryClient();
	const i18n = useI18n();
	const translate = typeof i18n.t === "function" ? i18n.t : fallbackManualFormMessage;
	const selectedWorkBlockId = task.currentWorkBlock?.id ?? null;
	const selectedWorkBlockKey = selectedWorkBlockId ?? "__task__";
	const previousWorkBlockKeyRef = useRef(selectedWorkBlockKey);
	const lastWorkspaceEventSequenceRef = useRef(0);
	const [acceptResultError, setAcceptResultError] = useState<string | null>(
		null,
	);
	const [isAcceptingResult, setIsAcceptingResult] = useState(false);
	const [finalizationRetryError, setFinalizationRetryError] = useState<
		string | null
	>(null);
	const [isRetryingFinalization, setIsRetryingFinalization] = useState(false);
	const [pendingCommand, setPendingCommand] =
		useState<PendingWorkspaceCommand | null>(null);
	const acceptingPlanCommandRef = useRef<{
		commandId: string;
		planId: string;
	} | null>(null);
	// A workspace SSE reconnect has no replayable command outcome. Once its
	// durable snapshot is loaded, a draft plan proves an in-flight acceptance
	// did not settle and must not leave the UI permanently accepting.
	const reconcileAcceptingPlanFromSnapshotRef = useRef(false);

	const planStateQuery = useQuery({
		queryKey: taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId),
		queryFn: () => fetchTaskPlanState(task.id, selectedWorkBlockId),
		initialData: {
			taskId: task.id,
			aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
			savedPlan: task.savedPlan ?? null,
			generationSession: null,
		} satisfies TaskPlanState,
	});
	const currentExecutionQuery = useQuery({
		queryKey: taskWorkspaceQueryKeys.currentExecution(
			task.id,
			selectedWorkBlockId,
		),
		queryFn: () => fetchCurrentTaskExecution(task.id, selectedWorkBlockId),
	});
	const planState = planStateQuery.data;
	const [generationUserInstruction, setGenerationUserInstruction] = useState<
		string | null
	>(null);
	// `isGeneratingPlan` flips to true when EITHER:
	//  (a) the shared `useTaskPlanGenerationSession` store — kept current by
	//      the workspace SSE pipeline — reports a running session, OR
	//  (b) the persisted `/api/tasks/:taskId/plan` snapshot reports
	//      `aiPlanGenerationStatus === "generating"`.
	// Source (b) is the only signal that survives a hard page refresh. The
	// page loader and the `fetchTaskPlanState` query both read
	// `isTaskPlanGenerationRunning` on the server, so the moment a generation
	// is in flight the spec API surfaces "generating" — the button must
	// honour it on the very first render after the refresh, before the SSE
	// snapshot or session-store hydrate has a chance to fire.
	const generationSession = useTaskPlanGenerationSession(
		task.id,
		selectedWorkBlockId,
	);
	const planHeadStateVersion =
		generationSession.headStateVersion ??
		planStateQuery.data.generationSession?.headStateVersion ??
		null;
	const shouldPollGeneration = shouldPollPlanSettlement(
		planState ?? {},
		generationSession.sessionStatus,
	);
	const isGeneratingPlan = Boolean(
		shouldPollGeneration &&
			(generationSession.sessionStatus === "running" ||
				planState?.aiPlanGenerationStatus === "generating"),
	);

	// A durable snapshot is authoritative over an in-memory session that may
	// have missed its terminal SSE event (for example after a browser sleep).
	useEffect(() => {
		if (!planState) return;
		reconcileTaskPlanGenerationSession(task.id, selectedWorkBlockId, planState);
	}, [planState, selectedWorkBlockId, task.id]);

	useEffect(() => {
		if (
			generationSession.sessionStatus !== "completed" &&
			generationSession.sessionStatus !== "failed" &&
			generationSession.sessionStatus !== "cancelled"
		)
			return;
		void planStateQuery.refetch();
	}, [generationSession.sessionStatus, planStateQuery.refetch]);

	useEffect(() => {
		if (!shouldPollGeneration) return;
		const interval = window.setInterval(() => {
			void planStateQuery.refetch();
		}, 5000);
		return () => window.clearInterval(interval);
	}, [planStateQuery.refetch, shouldPollGeneration]);
	const generationActivitySummary = isGeneratingPlan
		? (generationSession.statusMessage ??
			activitySummaryFromPhase(generationSession.phase))
		: null;
	const [planFlow, setPlanFlow] = useState(() =>
		createPlanFlowFromSnapshot(planStateQuery.data),
	);
	const [runtimeEvents, setRuntimeEvents] = useState<WorkspaceRuntimeEvent[]>(
		[],
	);
	const [liveActivity, setLiveActivity] = useState<WorkspaceActivityItem[]>([]);
	const currentExecution = currentExecutionQuery.data ?? null;
	const latestCheckpoint = currentExecution?.checkpoint ?? null;
	const isFinalizationUnsettled = shouldPollExecutionFinalization(currentExecution);
	const latestActivitySummary =
		getRuntimeActivity(runtimeEvents.at(-1)) ?? generationActivitySummary;
	const [graphPlan, setGraphPlan] = useState(() =>
		taskPlanReadModelToGraphPlan(null),
	);
	const [isGraphPlanPending, setIsGraphPlanPending] = useState(false);

	useEffect(() => {
		if (previousWorkBlockKeyRef.current === selectedWorkBlockKey) return;
		previousWorkBlockKeyRef.current = selectedWorkBlockKey;
		lastWorkspaceEventSequenceRef.current = 0;
		setGenerationUserInstruction(null);
		setRuntimeEvents([]);
		setLiveActivity([]);
		setPendingCommand(null);
		acceptingPlanCommandRef.current = null;
		reconcileAcceptingPlanFromSnapshotRef.current = false;
		setPlanFlow(createPlanFlowFromSnapshot(planStateQuery.data));
	}, [planStateQuery.data, selectedWorkBlockKey]);

	useEffect(() => {
		queryClient.setQueryData(
			taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId),
			(current: TaskPlanState | undefined) => {
				const previous =
					current ??
					({
						taskId: task.id,
						aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
						savedPlan: null,
						generationSession: null,
					} satisfies TaskPlanState);
				const nextPlan = selectWorkspacePlan(
					task.savedPlan,
					previous.savedPlan,
					{ preferPagePlanOnTie: true },
				);

				return {
					...previous,
					savedPlan: nextPlan,
					aiPlanGenerationStatus: derivePlanStatus(
						nextPlan,
						previous.generationSession?.status === "running",
						previous.aiPlanGenerationStatus,
					),
				} satisfies TaskPlanState;
			},
		);
	}, [queryClient, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

	useEffect(() => {
		if (!planState) return;
		const selectedSavedPlan = selectWorkspacePlan(
			task.savedPlan,
			planState.savedPlan,
		);
		const nextPlanState = {
			...planState,
			savedPlan: selectedSavedPlan,
			aiPlanGenerationStatus: derivePlanStatus(
				selectedSavedPlan,
				isGeneratingPlan,
			),
		} satisfies TaskPlanState;
		const nextPlanFlow = createPlanFlowFromSnapshot(nextPlanState);
		const settledAcceptanceCommand =
			nextPlanFlow.savedPlan?.status === "accepted"
				? acceptingPlanCommandRef.current
				: null;
		if (settledAcceptanceCommand) {
			acceptingPlanCommandRef.current = null;
			reconcileAcceptingPlanFromSnapshotRef.current = false;
			setPendingCommand((current) =>
				current?.commandId === settledAcceptanceCommand.commandId ? null : current,
			);
		}
		setPlanFlow((current) => {
			if (current.status === "accepting") {
				if (nextPlanFlow.savedPlan?.status === "accepted") {
					return nextPlanFlow;
				}
				if (reconcileAcceptingPlanFromSnapshotRef.current) {
					reconcileAcceptingPlanFromSnapshotRef.current = false;
					acceptingPlanCommandRef.current = null;
					return failPlanAccept(
						current,
						current.planId,
						"Plan acceptance did not complete. Review and try again.",
					);
				}
				return current;
			}
			if (samePlanFlowSnapshot(current, nextPlanFlow)) return current;
			return nextPlanFlow;
		});
	}, [isGeneratingPlan, planState, task.savedPlan]);

	const plan = selectWorkspacePlan(task.savedPlan, planFlow.savedPlan);
	const planGenerationStatus = isGeneratingPlan
		? "generating"
		: getPlanGenerationStatusFromFlow(planFlow);

	useEffect(() => {
		if (!isFinalizationUnsettled) return;
		let cancelled = false;
		let timeout: number | null = null;
		let attempt = 0;
		const poll = () => {
			if (attempt >= FINALIZATION_POLL_MAX_ATTEMPTS) {
				setFinalizationRetryError(FINALIZATION_POLL_EXHAUSTED_MESSAGE);
				return;
			}
			const delay = Math.min(2_000 * 2 ** attempt, 10_000);
			timeout = window.setTimeout(async () => {
				await Promise.all([currentExecutionQuery.refetch(), refreshWorkspace()]);
				if (cancelled) return;
				attempt += 1;
				poll();
			}, delay);
		};
		poll();
		return () => {
			cancelled = true;
			if (timeout !== null) window.clearTimeout(timeout);
		};
	}, [currentExecutionQuery.refetch, isFinalizationUnsettled, refreshWorkspace]);

	useEffect(() => {
		if (!isFinalizationUnsettled) setFinalizationRetryError(null);
	}, [isFinalizationUnsettled]);

	useEffect(() => {
		if (!isFinalizationUnsettled) return;
		const refreshOnVisible = () => {
			if (document.visibilityState === "visible") {
				void Promise.all([
					currentExecutionQuery.refetch(),
					planStateQuery.refetch(),
					refreshWorkspace(),
				]);
			}
		};
		document.addEventListener("visibilitychange", refreshOnVisible);
		return () => document.removeEventListener("visibilitychange", refreshOnVisible);
	}, [
		currentExecutionQuery.refetch,
		isFinalizationUnsettled,
		planStateQuery.refetch,
		refreshWorkspace,
	]);

	// eslint-disable-next-line complexity -- one ordered event pass correlates receipt, activity, and durable snapshots.
	useEffect(() => {
		const nextEvents = workspaceEvents.filter(
			(event) => (event.sequence ?? 0) > lastWorkspaceEventSequenceRef.current,
		);
		if (nextEvents.length === 0) return;

		lastWorkspaceEventSequenceRef.current = Math.max(
			lastWorkspaceEventSequenceRef.current,
			...nextEvents.map((event) => event.sequence ?? 0),
		);

		for (const event of nextEvents) {
			// A connection snapshot is already scoped by the SSE endpoint; refresh
			// the currently selected durable plan even if its envelope omits a
			// work-block ID.
			if (event.type === "state.snapshot") {
				const acceptingPlan = acceptingPlanCommandRef.current;
				if (acceptingPlan) {
					reconcileAcceptingPlanFromSnapshotRef.current = true;
					void planStateQuery.refetch().then(({ data }) => {
						if (data?.savedPlan?.status === "accepted") return;
						reconcileAcceptingPlanFromSnapshotRef.current = false;
						acceptingPlanCommandRef.current = null;
						setPlanFlow((current) =>
							current.status === "accepting" &&
							current.planId === acceptingPlan.planId
								? failPlanAccept(
										current,
										acceptingPlan.planId,
										"Plan acceptance did not complete. Review and try again.",
									)
								: current,
						);
					});
				}
				continue;
			}
			if (!isWorkspaceEventInSelectedScope(event, selectedWorkBlockId))
				continue;
			const acceptingPlan = acceptingPlanCommandRef.current;
			if (
				acceptingPlan &&
				acceptingPlan.commandId === event.commandId &&
				event.type === "command.failed"
			) {
				acceptingPlanCommandRef.current = null;
				reconcileAcceptingPlanFromSnapshotRef.current = false;
				setPlanFlow((current) =>
					failPlanAccept(
						current,
						acceptingPlan.planId,
						event.message ?? "Failed to accept plan",
					),
				);
			}
			if (
				acceptingPlan &&
				acceptingPlan.commandId === event.commandId &&
				event.type === "task_workspace_updated" &&
				event.reason === "plan.accepted"
			) {
				acceptingPlanCommandRef.current = null;
				reconcileAcceptingPlanFromSnapshotRef.current = false;
			}
			setPendingCommand((current) => settleWorkspaceCommand(current, event));
			const activityItem = workspaceEventToWorkspaceActivity(
				event,
				event.sequence ?? 0,
				new Date().toISOString(),
			);
			if (activityItem) {
				setLiveActivity((current) =>
					mergeWorkspaceActivity([activityItem, ...current]),
				);
			}

			// Durable generation progress is mirrored into the bound state store.
			// The completed event reloads the canonical saved plan for every
			// surface, including generations started outside the AI panel.

			if (event.type === "execution.runtime_event") {
				if (isFullRuntimeSseEvent(event)) {
					const runtimeEvent: WorkspaceRuntimeEvent = {
						...event,
						type: "runtime_event",
					};
					setRuntimeEvents((current) =>
						appendRuntimeEvent(current, runtimeEvent),
					);
				}
				void currentExecutionQuery.refetch();
				continue;
			}

			if (isPlanGenerationCompletionEvent(event)) {
				// Page-state refreshes workspace/header; this refetch supplies the
				// canonical durable plan without racing a duplicate plan request.
				void planStateQuery.refetch();
				continue;
			}

			if (shouldRefreshExecutionSnapshot(event)) {
				void currentExecutionQuery.refetch();
				void planStateQuery.refetch();
				void refreshWorkspace();
			}
		}
	}, [
		currentExecutionQuery,
		planStateQuery,
		refreshWorkspace,
		selectedWorkBlockId,
		workspaceEvents,
	]);

	useEffect(() => {
		if (!plan) {
			setGraphPlan(null);
			setIsGraphPlanPending(false);
			return;
		}

		let cancelled = false;
		setIsGraphPlanPending(true);
		const timeoutId = window.setTimeout(() => {
			const nextGraphPlan = withStartingReadyNode(
				withCanonicalExecutionActions(
					taskPlanReadModelToGraphPlan(plan, {
						preparingManualForm: translate("pages.tasks.manualFormPreparing"),
					}),
					latestCheckpoint,
					{
						completeAndContinue: translate("pages.tasks.manualFormCompleteContinue"),
						generate: translate("pages.tasks.manualFormGenerate"),
						regenerate: translate("pages.tasks.manualFormRegenerate"),
					},
				),
				currentExecution,
			);
			if (cancelled) return;
			startTransition(() => {
				setGraphPlan(nextGraphPlan);
				setIsGraphPlanPending(false);
			});
		}, 0);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [currentExecution, latestCheckpoint, plan, translate]);

	const setPlan = useCallback(
		(value: SetStateAction<TaskData["savedPlan"] | null>) => {
			queryClient.setQueryData(
				taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId),
				(current: TaskPlanState | undefined) => {
					const previous = current ?? {
						taskId: task.id,
						aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
						savedPlan: task.savedPlan ?? null,
						generationSession: null,
					};
					const nextPlan =
						typeof value === "function"
							? (
									value as (
										prevState: TaskData["savedPlan"] | null,
									) => TaskData["savedPlan"] | null
								)(previous.savedPlan ?? null)
							: value;
					return {
						...previous,
						savedPlan: nextPlan,
						aiPlanGenerationStatus: derivePlanStatus(
							nextPlan,
							previous.generationSession?.status === "running",
						),
					} satisfies TaskPlanState;
				},
			);
		},
		[
			queryClient,
			selectedWorkBlockId,
			task.aiPlanGenerationStatus,
			task.id,
			task.savedPlan,
		],
	);

	const fetchPlan = useCallback(async () => {
		await planStateQuery.refetch();
	}, [planStateQuery]);

	const canAcceptPlan = canAcceptPlanFromFlow(planFlow);
	const acceptPlanError = getAcceptPlanErrorFromFlow(planFlow);

	const refreshExecutionQueries = useCallback(async () => {
		await Promise.all([
			currentExecutionQuery.refetch(),
			planStateQuery.refetch(),
			refreshWorkspace(),
		]);
	}, [currentExecutionQuery, planStateQuery, refreshWorkspace]);

	const refreshResultProjection = useCallback(async () => {
		await refreshExecutionQueries();
		await queryClient.refetchQueries({
			queryKey: taskWorkspaceQueryKeys.page(task.id, selectedWorkBlockId),
			type: "active",
		});
	}, [queryClient, refreshExecutionQueries, selectedWorkBlockId, task.id]);

	const acceptPlanById = useCallback(
		async (planId: string) => {
			if (planHeadStateVersion === null) {
				const message =
					"Plan generation version is unavailable. Refresh before accepting the plan.";
				setPlanFlow((current) => failPlanAccept(current, planId, message));
				return;
			}
			setPlanFlow((current) =>
				startPlanAccept(clearPlanFlowError(current), planId),
			);
			try {
				const ack = await dispatchWorkspaceCommand(task.id, {
					type: "plan.accept",
					planId,
					workBlockId: selectedWorkBlockId,
					expectedHeadStateVersion: planHeadStateVersion,
					idempotencyKey: uuidv4(),
				});
				acceptingPlanCommandRef.current = { commandId: ack.commandId, planId };
				reconcileAcceptingPlanFromSnapshotRef.current = false;
				setPendingCommand({
					commandId: ack.commandId,
					message: "Plan acceptance was accepted. Waiting for the durable plan state.",
					status: "pending",
				});
				// The command ACK proves only receipt. Explicitly refresh the durable
				// plan/workspace snapshots so acceptance settles even if the SSE event
				// is delayed or missed; snapshot reconciliation remains authoritative.
				await refreshExecutionQueries();
			} catch (cause) {
				acceptingPlanCommandRef.current = null;
				reconcileAcceptingPlanFromSnapshotRef.current = false;
				setPlanFlow((current) =>
					failPlanAccept(
						current,
						planId,
						cause instanceof Error ? cause.message : "Failed to accept plan",
					),
				);
			}
		},
		[
			planHeadStateVersion,
			refreshExecutionQueries,
			selectedWorkBlockId,
			task.id,
		],
	);

	const handleAcceptPlan = useCallback(async () => {
		if (!plan?.id) return;
		await acceptPlanById(plan.id);
	}, [acceptPlanById, plan?.id]);

	const handleGeneratePlanFromHeader = useCallback(
		(request?: PlanGenerationRequest) => {
			if (isGeneratingPlan) return;
			if (availableAiClients) {
				const selectedProvider = task.aiClientId
					? availableAiClients.find((client) => client.id === task.aiClientId)
					: null;
				const hasProvider = task.aiClientId
					? Boolean(selectedProvider?.enabled)
					: availableAiClients.some((client) => client.enabled);
				if (!hasProvider) {
					setPlanFlow((current) =>
						failPlanAccept(
							current,
							current.savedPlan?.id ?? "unknown",
							"Connect an AI provider before generating a plan.",
						),
					);
					return;
				}
			}
			const userInstruction = request?.userInstruction?.trim() || null;
			const selectedNodeId = request?.selectedNodeId?.trim() || null;
			setGenerationUserInstruction(userInstruction);
			void dispatchWorkspaceCommand(task.id, {
				type: "plan.generate",
				idempotencyKey: uuidv4(),
				forceRefresh: true,
				workBlockId: selectedWorkBlockId,
				userInstruction,
				selectedNodeId,
				replaceActiveExecution: request?.replaceActiveExecution ?? false,
			}).then((ack) => {
				setPendingCommand({
					commandId: ack.commandId,
					message: "Plan generation was accepted. Waiting for the durable plan state.",
					instruction: userInstruction,
					status: "pending",
				});
			}).catch(() => undefined);
		},
		[
			availableAiClients,
			isGeneratingPlan,
			selectedWorkBlockId,
			task.aiClientId,
			task.id,
		],
	);

	const handleStopPlanGeneration = useCallback(async () => {
		await stopTaskPlanGenerationSession(task.id, selectedWorkBlockId);
		await planStateQuery.refetch();
	}, [planStateQuery, selectedWorkBlockId, task.id]);

	const dispatchExecutionAction = useCallback(
		async (action: ExecutionActionInput) => {
			setRuntimeEvents([]);
			const result = await dispatchTaskExecutionAction(
				task.id,
				action,
				selectedWorkBlockId,
			);
			setPendingCommand({
				commandId: result.commandId,
				message: result.message,
				instruction:
					"prompt" in action && typeof action.prompt === "string"
						? action.prompt
						: null,
				status: "pending",
			});
			await refreshExecutionQueries();
			return result;
		},
		[refreshExecutionQueries, selectedWorkBlockId, task.id],
	);

	const submitCheckpointAction = useCallback(
		async (action: SubmitCheckpointActionInput) => {
			setRuntimeEvents([]);
			const result = await submitTaskCheckpointAction(
				task.id,
				action,
				selectedWorkBlockId,
			);
			setPendingCommand({
				commandId: result.commandId,
				message: result.message,
				status: "pending",
			});
			await refreshExecutionQueries();
			return result;
		},
		[refreshExecutionQueries, selectedWorkBlockId, task.id],
	);

	const handleRetryFinalization = useCallback(async () => {
		setFinalizationRetryError(null);
		setIsRetryingFinalization(true);
		try {
			await retryTaskResultFinalization(task.id);
			await refreshResultProjection();
		} catch (cause) {
			setFinalizationRetryError(
				cause instanceof Error
					? cause.message
					: "Failed to finalize task result",
			);
			await currentExecutionQuery.refetch();
		} finally {
			setIsRetryingFinalization(false);
		}
	}, [refreshResultProjection, currentExecutionQuery, task.id]);

	const handleAcceptResult = useCallback(async () => {
		setAcceptResultError(null);
		setIsAcceptingResult(true);
		try {
			const accepted = await acceptTaskResult(task.id);
			queryClient.setQueryData(
				taskWorkspaceQueryKeys.page(task.id, selectedWorkBlockId),
				(current: TaskPageData | undefined) =>
					current
						? {
								...current,
								resultReview: {
									status: "accepted",
									runId: accepted.runId,
									acceptedAt: accepted.acceptedAt,
								},
								latestRunSummary: current.latestRunSummary
									? {
											...current.latestRunSummary,
											id: accepted.runId,
											status: "Completed",
										}
									: current.latestRunSummary,
							}
						: current,
			);
			await refreshResultProjection();
		} catch (cause) {
			setAcceptResultError(
				cause instanceof Error ? cause.message : "Failed to accept task result",
			);
		} finally {
			setIsAcceptingResult(false);
		}
	}, [queryClient, refreshResultProjection, selectedWorkBlockId, task.id]);

	const assistantBuildCurrentPlan = useCallback(() => {
		if (!plan?.compiledPlan) return null;
		const compiledPlan = plan.compiledPlan;
		const deps = new Map<string, string[]>();
		for (const edge of compiledPlan.edges) {
			if (!deps.has(edge.to)) deps.set(edge.to, []);
			deps.get(edge.to)?.push(edge.from);
		}
		return {
			id: compiledPlan.id,
			status: "draft" as const,
			revision: compiledPlan.sourceVersion,
			summary: compiledPlan.goal,
			nodes: compiledPlan.nodes.map(
				(node: TaskPlanReadModel["compiledPlan"]["nodes"][number]) => ({
					id: node.id,
					title: node.title,
					objective: node.description ?? "",
					description: node.description ?? null,
					status: "pending" as const,
					estimatedMinutes: node.estimatedMinutes ?? null,
					priority: node.priority ?? null,
					executionMode: node.mode ?? "automatic",
					dependsOn: deps.get(node.id) ?? [],
				}),
			),
			edges: compiledPlan.edges.map(
				(edge: TaskPlanReadModel["compiledPlan"]["edges"][number]) => ({
					id: edge.id,
					fromNodeId: edge.from,
					toNodeId: edge.to,
					type: "sequential",
				}),
			),
		};
	}, [plan]);

	const setAcceptPlanError = useCallback(
		(value: SetStateAction<string | null>) => {
			setPlanFlow((current) => {
				const nextError =
					typeof value === "function"
						? value(getAcceptPlanErrorFromFlow(current))
						: value;

				if (!nextError) {
					return clearPlanFlowError(current);
				}

				return failPlanAccept(
					current,
					current.savedPlan?.id ?? "unknown",
					nextError,
				);
			});
		},
		[],
	);

	return {
		plan,
		setPlan,
		fetchPlan,
		planHeadStateVersion,
		planGenerationStatus,
		planFlowStatus: planFlow.status,
		graphPlan,
		isGraphPlanPending,
		canAcceptPlan,
		isAcceptingPlan: isAcceptingPlanFromFlow(planFlow),
		acceptPlanError,
		setAcceptPlanError,
		generationUserInstruction,
		runtimeEvents,
		liveActivity,
		latestActivitySummary,
		currentExecution,
		acceptPlanById,
		handleAcceptPlan,
		dispatchExecutionAction,
		submitCheckpointAction,
		handleAcceptResult,
		isAcceptingResult,
		acceptResultError,
		handleRetryFinalization,
		isRetryingFinalization,
		finalizationRetryError,
		pendingCommand,
		handleGeneratePlanFromHeader,
		handleStopPlanGeneration,
		assistantBuildCurrentPlan,
	};
}
