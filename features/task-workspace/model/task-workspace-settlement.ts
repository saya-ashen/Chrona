import type { PublicPlanExecutionResult } from "@chrona/contracts";
import type { WorkStateView } from "@chrona/domain";
import type { TaskPageData } from "./task-workspace-types";

/**
 * Durable API snapshots win over browser-local stream state. This contract is
 * shared by generation, execution finalization, and command receipt handling
 * so a missed or late SSE event cannot leave a workspace in a preparing state.
 */
export type DurablePlanSettlementSnapshot = {
	aiPlanGenerationStatus?: string | null;
	savedPlan?: { status?: string | null } | null;
	generationSession?: { status?: string | null } | null;
};

const TERMINAL_GENERATION_STATUSES = new Set([
	"waiting_acceptance",
	"accepted",
	"completed",
	"failed",
	"cancelled",
]);

export function isDurablySettledPlan(snapshot: DurablePlanSettlementSnapshot) {
	return (
		TERMINAL_GENERATION_STATUSES.has(snapshot.aiPlanGenerationStatus ?? "") ||
		TERMINAL_GENERATION_STATUSES.has(snapshot.generationSession?.status ?? "") ||
		snapshot.savedPlan?.status === "accepted"
	);
}

export function shouldPollPlanSettlement(
	snapshot: DurablePlanSettlementSnapshot,
	_localSessionStatus?: string | null,
) {
	// Browser-local session state can be stale after reconnect; only the
	// persisted snapshot decides whether settlement polling may stop.
	return !isDurablySettledPlan(snapshot);
}

const TERMINAL_EXECUTION_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
]);
const UNSETTLED_FINALIZATION_STATUSES = new Set(["Pending", "Running"]);

export function shouldPollExecutionFinalization(
	execution: PublicPlanExecutionResult | null | undefined,
) {
	return Boolean(
		execution &&
		TERMINAL_EXECUTION_STATUSES.has(execution.status) &&
		UNSETTLED_FINALIZATION_STATUSES.has(
			execution.planOutput?.finalization.status ?? "",
		),
	);
}

type ResultSettlementPageData = Pick<
	TaskPageData,
	"latestRunSummary" | "resultReview" | "task"
>;

function normalizedStatus(value: string | null | undefined) {
	return value?.trim().toLowerCase() ?? "";
}

export function isLatestTaskResultAccepted(pageData: ResultSettlementPageData) {
	const taskStatus = normalizedStatus(pageData.task.status);
	return (
		pageData.resultReview?.status === "accepted" &&
		pageData.resultReview.runId === pageData.latestRunSummary?.id &&
		(taskStatus === "completed" ||
			taskStatus === "done" ||
			taskStatus === "complete" ||
			normalizedStatus(pageData.latestRunSummary?.status) === "completed")
	);
}

export function settleAcceptedResultWorkState(
	pageData: ResultSettlementPageData,
	derived: WorkStateView,
): WorkStateView {
	if (!isLatestTaskResultAccepted(pageData)) return derived;
	return {
		...derived,
		state: "done",
		stage: "result",
		label: "Task done",
		tone: "success",
		nextActionLabel: "Ask a follow-up or create a next task",
		primaryActionId: "ask_follow_up",
		primaryActionDisabledReason: null,
		currentNodeId: null,
		currentNodeLabel: null,
		blocker: null,
		attentionRequired: false,
		showLiveProgress: false,
		canPause: false,
		canStop: false,
	};
}

export function preserveAcceptedResultReview<
	T extends { resultReview?: { status: string; runId: string; acceptedAt: string | null } | null },
>(previous: T | undefined, incoming: T) {
	const accepted = previous?.resultReview?.status === "accepted";
	const incomingAccepted = incoming.resultReview?.status === "accepted";
	if (!accepted || incomingAccepted) return incoming;
	// A newly selected run is authoritative even if an older run was accepted.
	if (previous?.resultReview?.runId !== incoming.resultReview?.runId) return incoming;
	return { ...incoming, resultReview: previous?.resultReview };
}

export type PendingWorkspaceCommand = {
	commandId: string;
	message: string;
	instruction?: string | null;
	status: "pending" | "failed";
	failureMessage?: string;
};

export function settleWorkspaceCommand(
	pending: PendingWorkspaceCommand | null,
	event: { type: string; commandId?: string; message?: string },
): PendingWorkspaceCommand | null {
	if (!pending || event.commandId !== pending.commandId) return pending;
	if (event.type === "command.failed") {
		return {
			...pending,
			status: "failed",
			failureMessage: event.message ?? "The command failed before the workspace changed.",
		};
	}
	if (
		event.type === "task_workspace_updated" ||
		event.type === "execution.state.updated" ||
		event.type === "execution.result" ||
		event.type === "checkpoint.result"
	) {
		return null;
	}
	return pending;
}
