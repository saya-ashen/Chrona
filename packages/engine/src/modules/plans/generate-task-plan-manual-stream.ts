import type { Prisma } from "@chrona/db";
import { appendCanonicalEvent } from "../events";
import type { GeneratePlanSSEEvent } from "@chrona/contracts/ai";
import {
	captureTaskPlanGenerationSnapshot,
	type TaskPlanGenerationSnapshot,
} from "./task-plan-generation-persistence";
import {
	resumeTaskPlanGenerateFeature,
	runTaskPlanGenerateFeature,
} from "./ai/task-plan-generate-run";
import { currentSchedulerWorkContext } from "../orchestration/scheduler-work-context";
import { withSchedulerWorkOwnership } from "../orchestration/scheduler-lease-repository";
import {
	projectTaskPlanGenerationFailure,
	releaseTaskPlanGenerationHead,
} from "./task-plan-generation-registry";

async function recordPlanGenerationEvent(input: {
	type: "started" | "status" | "completed" | "failed" | "cancelled";
	task: { id: string; workspaceId: string };
	workBlockId: string | null;
	generationId: string;
	payload?: Record<string, unknown>;
	dedupeSuffix?: string;
}) {
	await withSchedulerWorkOwnership(
		currentSchedulerWorkContext(),
		async (tx: Prisma.TransactionClient) => {
			await appendCanonicalEvent(
				{
					eventType: `plan_generation.${input.type}`,
					workspaceId: input.task.workspaceId,
					taskId: input.task.id,
					workBlockId: input.workBlockId,
					actorType: "system",
					actorId: "plan-generator",
					source: "plan_generation",
					payload: {
						generation_id: input.generationId,
						...(input.payload ?? {}),
					},
					occurredAt: new Date(),
					dedupeKey: [
						"plan_generation",
						input.task.id,
						input.generationId,
						input.type,
						input.dedupeSuffix,
					]
						.filter(Boolean)
						.join(":"),
				},
				tx,
			);
		},
	);
}

function getRuntimeErrorCode(cause: unknown) {
	if (
		cause &&
		typeof cause === "object" &&
		"detail" in cause &&
		cause.detail &&
		typeof cause.detail === "object" &&
		"code" in cause.detail &&
		typeof cause.detail.code === "string"
	) {
		return cause.detail.code;
	}
	return undefined;
}

async function releaseGenerationHead(input: {
	taskId: string;
	workBlockId: string | null;
	featureRunId: string;
}) {
	await releaseTaskPlanGenerationHead(input);
}

async function* emitTerminalFailure(input: {
	task: { id: string; workspaceId: string };
	workBlockId: string | null;
	generationId: string;
	featureRunId: string;
	code: string | null | undefined;
}): AsyncGenerator<GeneratePlanSSEEvent> {
	const failure = projectTaskPlanGenerationFailure(input.code);
	await releaseGenerationHead({
		taskId: input.task.id,
		workBlockId: input.workBlockId,
		featureRunId: input.featureRunId,
	});
	await recordPlanGenerationEvent({
		type: "failed",
		task: input.task,
		workBlockId: input.workBlockId,
		generationId: input.generationId,
		payload: {
			code: failure.code,
			persisted_code: failure.persistedCode,
			message: failure.message,
		},
		dedupeSuffix: "terminal",
	});
	yield failure;
}

/** The stream owns no plan persistence; the feature's commitResult hook atomically commits the terminal receipt. */
// eslint-disable-next-line max-lines-per-function, complexity -- stream orchestrates durable lifecycle and terminal SSE mapping.
export async function* generateTaskPlanManualStream(input: {
	taskId: string;
	workBlockId?: string | null;
	generationId?: string;
	featureRunId?: string;
	snapshot?: TaskPlanGenerationSnapshot;
	forceRefresh?: boolean;
	userInstruction?: string | null;
	selectedNodeId?: string | null;
	signal?: AbortSignal;
}): AsyncGenerator<GeneratePlanSSEEvent> {
	const generationId = input.generationId ?? crypto.randomUUID();
	const snapshot =
		input.snapshot ??
		(await captureTaskPlanGenerationSnapshot({
			taskId: input.taskId,
			workBlockId: input.workBlockId,
		}));
	if (!snapshot) {
		yield { type: "failed", code: "TASK_NOT_FOUND", message: "Task not found" };
		return;
	}
	const task = { id: snapshot.task.id, workspaceId: snapshot.task.workspaceId };
	const userInstruction = input.userInstruction?.trim() || null;
	const selectedNodeId = input.selectedNodeId?.trim() || null;
	let sequence = 0;
	const status = async function* (
		phase: "loading_task" | "requesting_provider",
		message: string,
	) {
		await recordPlanGenerationEvent({
			type: "status",
			task,
			workBlockId: snapshot.workBlockId,
			generationId,
			payload: { phase, message, sequence: ++sequence },
			dedupeSuffix: `${sequence}:${phase}`,
		});
		yield { type: "status", phase, message } as GeneratePlanSSEEvent;
	};

	await recordPlanGenerationEvent({
		type: "started",
		task,
		workBlockId: snapshot.workBlockId,
		generationId,
		payload: {
			force_refresh: input.forceRefresh ?? false,
			head_state_version: snapshot.head.stateVersion,
		},
	});
	yield* status("loading_task", "Loading frozen task and plan-head context...");
	if (input.signal?.aborted) {
		await recordPlanGenerationEvent({
			type: "cancelled",
			task,
			workBlockId: snapshot.workBlockId,
			generationId,
			dedupeSuffix: "before_start",
		});
		yield { type: "cancelled" };
		return;
	}

	yield* status("requesting_provider", "Requesting AI provider...");
	try {
		const featureRun = input.featureRunId
			? await resumeTaskPlanGenerateFeature(input.featureRunId)
			: await runTaskPlanGenerateFeature({
					generationId,
					snapshot,
					userInstruction,
					selectedNodeId,
				});
		if (!featureRun)
			throw new Error("Durable task plan feature run was not found.");
		if (featureRun.status !== "completed") {
			yield* emitTerminalFailure({
				task,
				workBlockId: snapshot.workBlockId,
				generationId,
				featureRunId: featureRun.id,
				code: featureRun.error?.code,
			});
			return;
		}
		const receipt = featureRun.commitReference as
			| { planId?: unknown; headStateVersion?: unknown }
			| undefined;
		if (
			typeof receipt?.planId !== "string" ||
			typeof receipt.headStateVersion !== "number"
		) {
			const message =
				"Plan generation completed without an atomic commit receipt.";
			await releaseGenerationHead({
				taskId: task.id,
				workBlockId: snapshot.workBlockId,
				featureRunId: featureRun.id,
			});
			await recordPlanGenerationEvent({
				type: "failed",
				task,
				workBlockId: snapshot.workBlockId,
				generationId,
				payload: { code: "INTERNAL_ERROR", message },
				dedupeSuffix: "missing_receipt",
			});
			yield { type: "failed", code: "INTERNAL_ERROR", message };
			return;
		}
		await recordPlanGenerationEvent({
			type: "completed",
			task,
			workBlockId: snapshot.workBlockId,
			generationId,
			payload: {
				plan_id: receipt.planId,
				head_state_version: receipt.headStateVersion,
			},
		});
		yield {
			type: "committed",
			planId: receipt.planId,
			headStateVersion: receipt.headStateVersion,
		};
		yield { type: "done" };
	} catch (cause) {
		const runtimeCode = getRuntimeErrorCode(cause);
		const stale = runtimeCode === "stale_plan_baseline";
		const message = stale
			? "Task plan changed while generation was running."
			: "Unable to generate task plan.";
		if (input.featureRunId) {
			await releaseGenerationHead({
				taskId: task.id,
				workBlockId: snapshot.workBlockId,
				featureRunId: input.featureRunId,
			});
		}
		await recordPlanGenerationEvent({
			type: "failed",
			task,
			workBlockId: snapshot.workBlockId,
			generationId,
			payload: { code: stale ? "STALE_GENERATION" : "INTERNAL_ERROR", message },
			dedupeSuffix: stale ? "stale" : "internal",
		});
		yield stale
			? { type: "stale", code: "STALE_GENERATION", message }
			: { type: "failed", code: "INTERNAL_ERROR", message };
	}
}
