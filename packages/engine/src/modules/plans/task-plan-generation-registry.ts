import {
	AiFeatureRunStatus,
	type Prisma,
	TaskPlanGenerationHeadStatus,
	db,
} from "@chrona/db";
import type {
	GeneratePlanErrorCode,
	GeneratePlanSSEEvent,
	TaskPlanGenerationSessionReadModel,
} from "@chrona/contracts";
import {
	classifyAiFeatureProviderError,
	type AiFeatureProviderErrorCode,
} from "../ai";
import { appendCanonicalEvent } from "../events";
import { currentSchedulerWorkContext } from "../orchestration/scheduler-work-context";
import { abortActiveTaskPlanGeneration } from "./active-task-plan-generations";
import { withSchedulerWorkOwnership } from "../orchestration/scheduler-lease-repository";

const scopeKey = (workBlockId?: string | null) => workBlockId ?? "";
const POLL_INTERVAL_MS = 400;
const activeStatuses: AiFeatureRunStatus[] = [
	AiFeatureRunStatus.Queued,
	AiFeatureRunStatus.PreparingObservations,
	AiFeatureRunStatus.StartingProvider,
	AiFeatureRunStatus.Running,
	AiFeatureRunStatus.Validating,
	AiFeatureRunStatus.CommittingResult,
];
const terminalStatuses: ReadonlySet<AiFeatureRunStatus> = new Set([
	AiFeatureRunStatus.Completed,
	AiFeatureRunStatus.NeedsInput,
	AiFeatureRunStatus.CannotComplete,
	AiFeatureRunStatus.Failed,
	AiFeatureRunStatus.Cancelled,
]);

type PersistedRun = {
	operationId: string;
	headStateVersion: number;
	status: AiFeatureRunStatus;
	errorCode: string | null;
	errorMessage: string | null;
	commitReference: unknown;
	createdAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
};

export class TaskPlanGenerationInFlightError extends Error {
	readonly taskId: string;
	readonly workBlockId: string | null;

	constructor(input: { taskId: string; workBlockId?: string | null }) {
		super(
			`A task plan generation job is already running for task ${input.taskId}${input.workBlockId ? ` (work block ${input.workBlockId})` : ""}.`,
		);
		this.name = "TaskPlanGenerationInFlightError";
		this.taskId = input.taskId;
		this.workBlockId = input.workBlockId ?? null;
	}
}

type FailurePresentation = {
	code: GeneratePlanErrorCode;
	title: string;
	message: string;
};

const providerFailurePresentations: Record<
	AiFeatureProviderErrorCode,
	FailurePresentation
> = {
	provider_authentication_error: {
		code: "PROVIDER_AUTHENTICATION_ERROR",
		title: "Provider authentication failed",
		message:
			"The AI provider rejected its credentials. Check the configured API key or sign-in.",
	},
	provider_configuration_error: {
		code: "PROVIDER_CONFIGURATION_ERROR",
		title: "Provider configuration incomplete",
		message:
			"No AI model is selected, or the provider setup is incomplete. Choose a model and verify the provider configuration.",
	},
	provider_permission_error: {
		code: "PROVIDER_PERMISSION_ERROR",
		title: "Provider access denied",
		message:
			"The AI provider denied access. Check account permissions and the selected model.",
	},
	provider_quota_exceeded: {
		code: "PROVIDER_QUOTA_EXCEEDED",
		title: "Provider quota reached",
		message:
			"The AI provider quota or billing limit was reached. Check account balance or plan.",
	},
	provider_rate_limited: {
		code: "PROVIDER_RATE_LIMITED",
		title: "Provider rate limit reached",
		message: "The AI provider is rate limiting requests. Wait briefly, then retry.",
	},
	provider_request_error: {
		code: "PROVIDER_REQUEST_ERROR",
		title: "Provider rejected request",
		message:
			"The AI provider rejected the request. Check the selected model and provider configuration.",
	},
	provider_unavailable: {
		code: "PROVIDER_UNAVAILABLE",
		title: "Provider unavailable",
		message: "The AI provider is temporarily unavailable. Retry later.",
	},
	provider_network_error: {
		code: "PROVIDER_CONNECTION_ERROR",
		title: "Provider connection failed",
		message:
			"Chrona could not reach the AI provider, or the connection closed unexpectedly.",
	},
	provider_timeout: {
		code: "PROVIDER_TIMEOUT",
		title: "Provider request timed out",
		message: "The AI provider did not finish plan generation before the timeout.",
	},
	provider_protocol_error: {
		code: "PROVIDER_RESPONSE_ERROR",
		title: "Invalid provider response",
		message: "The AI provider returned an incomplete or invalid response.",
	},
	cancelled: {
		code: "ABORTED",
		title: "Plan generation cancelled",
		message: "Plan generation was cancelled.",
	},
};

function providerErrorCode(
	code: string | null,
	errorMessage?: string | null,
): AiFeatureProviderErrorCode | null {
	if (code === "provider_protocol_error")
		return classifyAiFeatureProviderError(errorMessage ?? "");
	if (code && code in providerFailurePresentations)
		return code as AiFeatureProviderErrorCode;
	if (code === "provider_invalid_json") return "provider_protocol_error";
	if (code === "provider_capability_mismatch") return "provider_request_error";
	if (code === "provider_run_unrecoverable") return "provider_network_error";
	return null;
}

function projectFailure(
	code: string | null,
	errorMessage?: string | null,
): FailurePresentation {
	const providerCode = providerErrorCode(code, errorMessage);
	if (providerCode) return providerFailurePresentations[providerCode];
	if (code === "provider_start_outcome_unknown") {
		return {
			code: "PROVIDER_ERROR",
			title: "Provider result unknown",
			message: "The AI provider could not confirm whether plan generation started.",
		};
	}
	if (
		code === "input_invalid" ||
		code === "output_invalid" ||
		code === "result_invalid" ||
		code === "evidence_invalid" ||
		code === "completion_invalid"
	) {
		return {
			code: "INVALID_TOOL_PAYLOAD",
			title: "Generated plan is invalid",
			message: "The generated plan did not satisfy the required contract.",
		};
	}
	if (code === "idempotency_conflict") {
		return {
			code: "PLAN_GENERATION_IN_FLIGHT",
			title: "Plan generation already running",
			message: "A plan generation is already active for this task.",
		};
	}
	return {
		code: "INTERNAL_ERROR",
		title: "Plan generation failed",
		message: "Plan generation did not complete.",
	};
}

export function projectTaskPlanGenerationFailure(
	code: string | null | undefined,
	errorMessage?: string | null,
): Extract<GeneratePlanSSEEvent, { type: "failed" }> {
	const persistedCode = code ?? null;
	return {
		type: "failed",
		...projectFailure(persistedCode, errorMessage),
		...(persistedCode ? { persistedCode } : {}),
	};
}

function committedEvent(run: PersistedRun): GeneratePlanSSEEvent | null {
	if (!run.commitReference || typeof run.commitReference !== "object")
		return null;
	const receipt = run.commitReference as {
		planId?: unknown;
		headStateVersion?: unknown;
	};
	return typeof receipt.planId === "string" &&
		typeof receipt.headStateVersion === "number"
		? {
				type: "committed",
				planId: receipt.planId,
				headStateVersion: receipt.headStateVersion,
			}
		: null;
}

function terminalEvents(run: PersistedRun): GeneratePlanSSEEvent[] | null {
	if (!terminalStatuses.has(run.status)) return null;
	if (run.status === AiFeatureRunStatus.Completed) {
		const committed = committedEvent(run);
		return committed
			? [committed, { type: "done" }]
			: [
					{
						type: "failed",
						code: "INTERNAL_ERROR",
						persistedCode: "commit_receipt_missing",
						message:
							"Plan generation completed without an atomic commit receipt.",
					},
					{ type: "done" },
				];
	}
	if (
		run.status === AiFeatureRunStatus.Cancelled ||
		run.errorCode === "cancelled"
	) {
		return [{ type: "cancelled" }, { type: "done" }];
	}
	if (run.errorCode === "stale_plan_baseline") {
		return [
			{
				type: "stale",
				code: "STALE_GENERATION",
				persistedCode: run.errorCode,
				message: "Task plan changed while generation was running.",
			},
			{ type: "done" },
		];
	}
	return [
		projectTaskPlanGenerationFailure(run.errorCode, run.errorMessage),
		{ type: "done" },
	];
}

function runningStatus(
	run: PersistedRun,
): Extract<GeneratePlanSSEEvent, { type: "status" }> {
	const phase =
		run.status === AiFeatureRunStatus.Queued ||
		run.status === AiFeatureRunStatus.PreparingObservations
			? "starting"
			: run.status === AiFeatureRunStatus.StartingProvider
				? "requesting_provider"
				: "streaming";
	return {
		type: "status",
		phase,
		message: "Task plan generation is still running.",
	};
}

function failedSessionError(run: PersistedRun) {
	if (run.errorCode === "stale_plan_baseline") {
		return {
			code: "STALE_GENERATION" as const,
			title: "Plan changed during generation",
			persistedCode: run.errorCode,
			message: "Task plan changed while generation was running.",
		};
	}
	const { type: _type, ...error } = projectTaskPlanGenerationFailure(
		run.errorCode,
		run.errorMessage,
	);
	return error;
}

function toSession(
	taskId: string,
	run: PersistedRun,
): TaskPlanGenerationSessionReadModel {
	const status =
		run.status === AiFeatureRunStatus.Completed
			? "completed"
			: run.status === AiFeatureRunStatus.Cancelled
				? "cancelled"
				: terminalStatuses.has(run.status)
					? "failed"
					: "running";
	return {
		generationId: run.operationId,
		headStateVersion: run.headStateVersion,
		taskId,
		status,
		phase: status === "running" ? runningStatus(run).phase : null,
		statusMessage: status === "running" ? runningStatus(run).message : null,
		error:
			run.errorCode && status === "failed" ? failedSessionError(run) : null,
		startedAt: (run.startedAt ?? run.createdAt).toISOString(),
		finishedAt: run.finishedAt?.toISOString() ?? null,
	};
}

async function currentRun(taskId: string, workBlockId?: string | null) {
	const head = await db.taskPlanGenerationHead.findUnique({
		where: {
			taskId_workBlockScopeKey: {
				taskId,
				workBlockScopeKey: scopeKey(workBlockId),
			},
		},
		include: { currentAiFeatureRun: true },
	});
	return head?.currentAiFeatureRun
		? { ...head.currentAiFeatureRun, headStateVersion: head.stateVersion }
		: null;
}

/** Reads only the feature run associated with this task/work-block generation head. */
export async function getTaskPlanGenerationSession(input: {
	taskId: string;
	workBlockId?: string | null;
}) {
	const run = await currentRun(input.taskId, input.workBlockId);
	return run ? toSession(input.taskId, run) : null;
}

export async function releaseTaskPlanGenerationHead(input: {
	taskId: string;
	workBlockId?: string | null;
	featureRunId: string;
}) {
	return withSchedulerWorkOwnership(
		currentSchedulerWorkContext(),
		async (tx: Prisma.TransactionClient) => {
			const head = await tx.taskPlanGenerationHead.findUnique({
				where: {
					taskId_workBlockScopeKey: {
						taskId: input.taskId,
						workBlockScopeKey: scopeKey(input.workBlockId),
					},
				},
				select: {
					id: true,
					currentPlanId: true,
					currentAiFeatureRunId: true,
					status: true,
				},
			});
			if (
				head?.currentAiFeatureRunId !== input.featureRunId ||
				head.status !== TaskPlanGenerationHeadStatus.Generating
			) {
				return false;
			}
			const released = await tx.taskPlanGenerationHead.updateMany({
				where: {
					id: head.id,
					currentAiFeatureRunId: input.featureRunId,
					status: TaskPlanGenerationHeadStatus.Generating,
				},
				data: {
					status: head.currentPlanId
						? TaskPlanGenerationHeadStatus.Current
						: TaskPlanGenerationHeadStatus.Idle,
					stateVersion: { increment: 1 },
				},
			});
			return released.count === 1;
		},
	);
}

export async function stopTaskPlanGeneration(input: {
	taskId: string;
	workBlockId?: string | null;
}) {
	const cancelled = await db.$transaction(
		async (tx: Prisma.TransactionClient) => {
			const head = await tx.taskPlanGenerationHead.findUnique({
				where: {
					taskId_workBlockScopeKey: {
						taskId: input.taskId,
						workBlockScopeKey: scopeKey(input.workBlockId),
					},
				},
			});
			if (!head?.currentAiFeatureRunId) return null;
			const stopped = await tx.aiFeatureRun.updateMany({
				where: {
					id: head.currentAiFeatureRunId,
					status: { in: activeStatuses },
				},
				data: {
					status: AiFeatureRunStatus.Cancelled,
					errorCode: "cancelled",
					errorMessage: "Task plan generation was cancelled.",
					finishedAt: new Date(),
					leaseOwner: null,
					leaseExpiresAt: null,
					stateVersion: { increment: 1 },
				},
			});
			if (stopped.count !== 1) return null;
			const headUpdate = await tx.taskPlanGenerationHead.updateMany({
				where: {
					id: head.id,
					stateVersion: head.stateVersion,
					currentAiFeatureRunId: head.currentAiFeatureRunId,
				},
				data: {
					status: head.currentPlanId
						? TaskPlanGenerationHeadStatus.Current
						: TaskPlanGenerationHeadStatus.Idle,
					stateVersion: { increment: 1 },
				},
			});
			if (headUpdate.count !== 1) return null;
			return {
				workspaceId: head.workspaceId,
				featureRunId: head.currentAiFeatureRunId,
				generationId:
					(
						await tx.aiFeatureRun.findUnique({
							where: { id: head.currentAiFeatureRunId },
							select: { operationId: true },
						})
					)?.operationId ?? null,
			};
		},
	);
	if (!cancelled) return false;
	abortActiveTaskPlanGeneration(cancelled.featureRunId);
	await appendCanonicalEvent({
		eventType: "plan_generation.cancelled",
		workspaceId: cancelled.workspaceId,
		taskId: input.taskId,
		workBlockId: input.workBlockId ?? null,
		actorType: "system",
		actorId: "plan-generator",
		source: "plan_generation",
		payload: { generation_id: cancelled.generationId },
		occurredAt: new Date(),
		dedupeKey: [
			"plan_generation",
			input.taskId,
			cancelled.generationId,
			"cancelled",
		]
			.filter(Boolean)
			.join(":"),
	});
	return true;
}

export async function isTaskPlanGenerationRunning(input: {
	taskId: string;
	workBlockId?: string | null;
}) {
	const run = await currentRun(input.taskId, input.workBlockId);
	return Boolean(run && !terminalStatuses.has(run.status));
}

/**
 * Durable task/work-block-scoped replay. It deliberately has no process-local
 * ownership: every delivery is reconstructed from the generation head and its
 * persisted feature run, so reconnects and competing application instances are safe.
 */
export function subscribeTaskPlanGeneration(
	input: { taskId: string; workBlockId?: string | null },
	subscriber: (event: GeneratePlanSSEEvent) => void,
) {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastFingerprint: string | null = null;
	const publish = (event: GeneratePlanSSEEvent) => {
		if (!stopped) subscriber(event);
	};
	const poll = async () => {
		let terminal = false;
		try {
			const run = await currentRun(input.taskId, input.workBlockId);
			if (!run) {
				publish({ type: "done" });
				terminal = true;
				return;
			}
			const terminalEventsForRun = terminalEvents(run);
			const fingerprint = `${run.operationId}:${run.stateVersion}:${run.status}:${run.errorCode ?? ""}:${run.finishedAt?.toISOString() ?? ""}`;
			if (fingerprint !== lastFingerprint) {
				lastFingerprint = fingerprint;
				publish({
					type: "status",
					phase: "starting",
					message: "Reconnected to durable task plan generation.",
				});
				for (const event of terminalEventsForRun ?? [runningStatus(run)])
					publish(event);
			}
			terminal = terminalEventsForRun !== null;
		} finally {
			if (!stopped && !terminal)
				timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
		}
	};
	void poll();
	return {
		unsubscribe() {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}
