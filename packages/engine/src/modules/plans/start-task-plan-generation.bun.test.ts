import { afterAll, afterEach, describe, expect, it } from "bun:test";

import {
	AiFeatureRunStatus,
	TaskPlanGenerationHeadStatus,
	db,
} from "@chrona/db";
import { AiFeatureRuntimeError } from "../../modules/ai";

import { startTaskPlanGenerationDurably } from "./start-task-plan-generation";
import { TaskPlanHeadConflictError } from "./task-plan-generation-persistence";
import {
	projectTaskPlanGenerationFailure,
	releaseTaskPlanGenerationHead,
} from "./task-plan-generation-registry";

const createdWorkspaceIds = new Set<string>();

async function createTaskFixture(label: string) {
	const id = crypto.randomUUID();
	const workspace = await db.workspace.create({
		data: {
			id: `start-plan-generation-workspace-${id}`,
			name: `Start plan generation ${label} ${id}`,
			status: "Active",
			defaultRuntime: "hermes",
		},
	});
	createdWorkspaceIds.add(workspace.id);

	const task = await db.task.create({
		data: {
			id: `start-plan-generation-task-${id}`,
			workspaceId: workspace.id,
			title: `Generate plan ${label}`,
			status: "Ready",
			priority: "Medium",
			executionRuntime: "hermes",
			executionConfig: {},
		},
	});

	return { workspace, task };
}

async function generationHead(taskId: string) {
	return db.taskPlanGenerationHead.findUniqueOrThrow({
		where: { taskId_workBlockScopeKey: { taskId, workBlockScopeKey: "" } },
		select: {
			currentAiFeatureRunId: true,
			stateVersion: true,
			status: true,
		},
	});
}

afterEach(async () => {
	if (!createdWorkspaceIds.size) return;

	const workspaceIds = [...createdWorkspaceIds];
	await db.taskPlanGenerationHead.deleteMany({
		where: { workspaceId: { in: workspaceIds } },
	});
	await db.aiFeatureRun.deleteMany({
		where: { workspaceId: { in: workspaceIds } },
	});
	await db.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
	await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
	createdWorkspaceIds.clear();
});

afterAll(async () => {
	await db.$disconnect();
});

describe("startTaskPlanGenerationDurably", () => {
	it("attaches the same operation to one queued feature run without duplicating it", async () => {
		const { workspace, task } = await createTaskFixture("same-operation");
		const idempotencyKey = `same-operation-${crypto.randomUUID()}`;
		const input = {
			taskId: task.id,
			idempotencyKey,
			userInstruction: "Keep the plan concise.",
			selectedNodeId: "starting-point",
		};

		const first = await startTaskPlanGenerationDurably(input);
		const attached = await startTaskPlanGenerationDurably(input);

		expect(attached).toMatchObject({
			generationId: idempotencyKey,
			featureRunId: first.featureRunId,
		});
		expect(
			await db.aiFeatureRun.count({
				where: {
					workspaceId: workspace.id,
					featureId: "task.plan.generate",
					subjectId: task.id,
					operationId: idempotencyKey,
				},
			}),
		).toBe(1);
		expect(await generationHead(task.id)).toEqual({
			currentAiFeatureRunId: first.featureRunId,
			stateVersion: 0,
			status: TaskPlanGenerationHeadStatus.Generating,
		});
		expect(
			await db.aiFeatureRun.findUniqueOrThrow({
				where: { id: first.featureRunId },
				select: { status: true, stateVersion: true },
			}),
		).toEqual({ status: AiFeatureRunStatus.Queued, stateVersion: 0 });
	});

	it("rejects a same-key start with different frozen input and preserves the original run", async () => {
		const { workspace, task } = await createTaskFixture("input-conflict");
		const idempotencyKey = `input-conflict-${crypto.randomUUID()}`;
		const first = await startTaskPlanGenerationDurably({
			taskId: task.id,
			idempotencyKey,
			userInstruction: "Draft the implementation plan.",
		});

		let thrown: unknown;
		try {
			await startTaskPlanGenerationDurably({
				taskId: task.id,
				idempotencyKey,
				userInstruction: "Draft the rollout plan instead.",
			});
		} catch (cause) {
			thrown = cause;
		}

		expect(thrown).toBeInstanceOf(AiFeatureRuntimeError);
		expect((thrown as AiFeatureRuntimeError).detail.code).toBe(
			"idempotency_conflict",
		);
		expect(
			await db.aiFeatureRun.count({
				where: {
					workspaceId: workspace.id,
					featureId: "task.plan.generate",
					subjectId: task.id,
					operationId: idempotencyKey,
				},
			}),
		).toBe(1);
		expect(
			await db.aiFeatureRun.findUniqueOrThrow({
				where: { id: first.featureRunId },
				select: { status: true, stateVersion: true, errorCode: true },
			}),
		).toEqual({
			status: AiFeatureRunStatus.Queued,
			stateVersion: 0,
			errorCode: null,
		});
	});

	it("uses the caller idempotency key as the public generation ID, not as the durable run ID", async () => {
		const { task } = await createTaskFixture("public-identity");
		const idempotencyKey = `caller-generation-${crypto.randomUUID()}`;

		const started = await startTaskPlanGenerationDurably({
			taskId: task.id,
			idempotencyKey,
		});
		const head = await generationHead(task.id);
		const run = await db.aiFeatureRun.findUniqueOrThrow({
			where: { id: started.featureRunId },
			select: { id: true, operationId: true, status: true },
		});

		expect(started.generationId).toBe(idempotencyKey);
		expect(run.operationId).toBe(idempotencyKey);
		expect(started.featureRunId).not.toBe(idempotencyKey);
		expect(run.id).toBe(started.featureRunId);
		expect(run.status).toBe(AiFeatureRunStatus.Queued);
		expect(head.currentAiFeatureRunId).toBe(started.featureRunId);
	});

	it("cancels an unlinked queued run when an active generation owns the head", async () => {
		const { task } = await createTaskFixture("orphan-cancellation");
		const owner = await startTaskPlanGenerationDurably({
			taskId: task.id,
			idempotencyKey: `head-owner-${crypto.randomUUID()}`,
		});

		let thrown: unknown;
		try {
			await startTaskPlanGenerationDurably({
				taskId: task.id,
				idempotencyKey: `head-loser-${crypto.randomUUID()}`,
			});
		} catch (cause) {
			thrown = cause;
		}

		expect(thrown).toBeInstanceOf(TaskPlanHeadConflictError);
		expect((thrown as AiFeatureRuntimeError).detail.code).toBe(
			"stale_plan_baseline",
		);

		const runs = await db.aiFeatureRun.findMany({
			where: { featureId: "task.plan.generate", subjectId: task.id },
			select: {
				id: true,
				status: true,
				stateVersion: true,
				errorCode: true,
				finishedAt: true,
			},
		});
		const orphan = runs.find(
			(run: { id: string }) => run.id !== owner.featureRunId,
		);

		expect(await generationHead(task.id)).toEqual({
			currentAiFeatureRunId: owner.featureRunId,
			stateVersion: 0,
			status: TaskPlanGenerationHeadStatus.Generating,
		});
		expect(orphan).toMatchObject({
			status: AiFeatureRunStatus.Cancelled,
			stateVersion: 1,
			errorCode: "idempotency_conflict",
		});
		expect(orphan?.finishedAt).toBeInstanceOf(Date);
	});

	it("reclaims a terminal generation head without invalidating the frozen head version", async () => {
		const { task } = await createTaskFixture("terminal-retry");
		const first = await startTaskPlanGenerationDurably({
			taskId: task.id,
			idempotencyKey: `terminal-owner-${crypto.randomUUID()}`,
		});
		await db.aiFeatureRun.update({
			where: { id: first.featureRunId },
			data: {
				status: AiFeatureRunStatus.Failed,
				stateVersion: { increment: 1 },
				finishedAt: new Date(),
			},
		});
		expect(
			await releaseTaskPlanGenerationHead({
				taskId: task.id,
				featureRunId: first.featureRunId,
			}),
		).toBe(true);

		const retry = await startTaskPlanGenerationDurably({
			taskId: task.id,
			idempotencyKey: `terminal-retry-${crypto.randomUUID()}`,
		});

		expect(retry.snapshot.head.stateVersion).toBe(1);
		expect(await generationHead(task.id)).toEqual({
			currentAiFeatureRunId: retry.featureRunId,
			stateVersion: 1,
			status: TaskPlanGenerationHeadStatus.Generating,
		});
	});

	it("preserves a run when the head claim commits before the transaction reports failure", async () => {
		const { task } = await createTaskFixture("ambiguous-head-claim");
		const transactionClient = db as unknown as {
			$transaction: (...args: unknown[]) => Promise<unknown>;
		};
		const originalTransaction = transactionClient.$transaction.bind(db);
		let transactionCount = 0;
		transactionClient.$transaction = async (...args) => {
			const result = await originalTransaction(...args);
			transactionCount += 1;
			if (transactionCount === 2)
				throw new Error("connection closed after commit");
			return result;
		};

		try {
			const started = await startTaskPlanGenerationDurably({
				taskId: task.id,
				idempotencyKey: `ambiguous-head-${crypto.randomUUID()}`,
			});

			expect(await generationHead(task.id)).toEqual({
				currentAiFeatureRunId: started.featureRunId,
				stateVersion: 0,
				status: TaskPlanGenerationHeadStatus.Generating,
			});
			expect(
				await db.aiFeatureRun.findUniqueOrThrow({
					where: { id: started.featureRunId },
					select: { status: true },
				}),
			).toEqual({ status: AiFeatureRunStatus.Queued });
		} finally {
			transactionClient.$transaction = originalTransaction;
		}
	});

	it("rejects a work block owned by another task before creating durable generation state", async () => {
		const { task } = await createTaskFixture("foreign-work-block-target");
		const foreign = await createTaskFixture("foreign-work-block-owner");
		const workBlock = await db.workBlock.create({
			data: {
				workspaceId: foreign.workspace.id,
				taskId: foreign.task.id,
				title: "Foreign block",
				status: "Scheduled",
				scheduledStartAt: new Date(Date.now() - 60_000),
				scheduledEndAt: new Date(Date.now() + 60_000),
				trigger: "scheduled",
			},
		});

		await expect(
			startTaskPlanGenerationDurably({
				taskId: task.id,
				workBlockId: workBlock.id,
				idempotencyKey: `foreign-work-block-${crypto.randomUUID()}`,
			}),
		).rejects.toThrow("Task not found");

		expect(await db.aiFeatureRun.count({ where: { subjectId: task.id } })).toBe(
			0,
		);
		expect(
			await db.taskPlanGenerationHead.count({ where: { taskId: task.id } }),
		).toBe(0);
		expect(await db.taskPlan.count({ where: { taskId: task.id } })).toBe(0);
	});
});

describe("task plan generation failure projection", () => {
	it("projects an ambiguous single-attempt provider start as an actionable provider error", () => {
		expect(
			projectTaskPlanGenerationFailure("provider_start_outcome_unknown"),
		).toEqual({
			type: "failed",
			code: "PROVIDER_ERROR",
			persistedCode: "provider_start_outcome_unknown",
			message: "The AI provider could not complete plan generation.",
		});
	});

	it("describes known provider terminal failures without calling them ambiguous starts", () => {
		expect(projectTaskPlanGenerationFailure("provider_protocol_error")).toEqual({
			type: "failed",
			code: "PROVIDER_ERROR",
			persistedCode: "provider_protocol_error",
			message:
				"The AI provider connection ended before plan generation completed.",
		});
		expect(projectTaskPlanGenerationFailure("provider_timeout")).toEqual({
			type: "failed",
			code: "PROVIDER_ERROR",
			persistedCode: "provider_timeout",
			message: "The AI provider timed out while generating the plan.",
		});
	});
});
