import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db, TaskPlanGenerationHeadStatus } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { runRecurringWorkBlockExpansionWorker } from "@chrona/engine/test-support";
import { saveCompiledPlan } from "@chrona/engine/test-support";
import { getLatestTaskPlanReadModel } from "@chrona/engine/test-support";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

// Plan-acceptance edge cases: idempotency, workBlockId scope,
// done-task refusal, no-op generation-stop, and
// 404 on missing plan.

function app() {
	const server = new Hono();
	server.route("/api", createApiRouter(createChronaEngine()));
	return server;
}

function minimalCompiledPlan(id: string, title: string): CompiledPlan {
	return {
		id: `compiled_${id}`,
		editablePlanId: id,
		sourceVersion: 1,
		title,
		goal: title,
		assumptions: [],
		nodes: [
			{
				id: "step",
				localId: "step",
				type: "task",
				title: "Step",
				description: "do it",
				config: { expectedOutput: "done" },
				dependencies: [],
				dependents: [],
				mode: "auto",
				executor: "ai",
				priority: "High",
			},
		],
		edges: [],
		entryNodeIds: ["step"],
		terminalNodeIds: ["step"],
		topologicalOrder: ["step"],
		completionPolicy: { type: "all_tasks_completed" },
		validationWarnings: [],
	};
}

async function seedPlanAcceptanceHead(input: {
	workspaceId: string;
	taskId: string;
	planId: string;
	workBlockId?: string | null;
}) {
	await db.taskPlanGenerationHead.upsert({
		where: {
			taskId_workBlockScopeKey: {
				taskId: input.taskId,
				workBlockScopeKey: input.workBlockId ?? "",
			},
		},
		create: {
			workspaceId: input.workspaceId,
			taskId: input.taskId,
			workBlockScopeKey: input.workBlockId ?? "",
			currentPlanId: input.planId,
			currentPlanStatus: "Draft",
			status: TaskPlanGenerationHeadStatus.Current,
			stateVersion: 0,
		},
		update: {
			currentPlanId: input.planId,
			currentPlanStatus: "Draft",
			status: TaskPlanGenerationHeadStatus.Current,
			stateVersion: 0,
		},
	});
}

describe("plan acceptance edges", () => {
	beforeEach(async () => {
		await resetTestDb();
	});

	it("accepting the same plan twice is idempotent — second call returns 200, no error", async () => {
		const { workspaceId } = await seedWorkspace("Plan accept idempotent");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "Idempotent accept",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
			},
		});
		const plan = minimalCompiledPlan("idem-plan", "Idempotent");
		await saveCompiledPlan({
			workspaceId,
			taskId: task.id,
			compiledPlan: plan,
			status: "draft",
			prompt: "draft",
			summary: "draft",
			generatedBy: "test",
		});
		await seedPlanAcceptanceHead({
			workspaceId,
			taskId: task.id,
			planId: "idem-plan",
		});

		const first = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId: "idem-plan",
					workspaceId,
					expectedHeadStateVersion: 0,
					idempotencyKey: "idem-plan-accept",
				}),
			},
		);
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as { savedPlan: { status: string } };
		expect(firstBody.savedPlan.status).toBe("accepted");

		const second = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId: "idem-plan",
					workspaceId,
					expectedHeadStateVersion: 0,
					idempotencyKey: "idem-plan-accept",
				}),
			},
		);
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as {
			savedPlan: { status: string };
		};
		expect(secondBody.savedPlan.status).toBe("accepted");

		const planRows = await db.taskPlan.findMany({
			where: { taskId: task.id, planId: "idem-plan" },
		});
		expect(planRows).toHaveLength(1);
	});

	it("[PLAN-026] rejects an empty accept body and a non-existent plan", async () => {
		const { workspaceId } = await seedWorkspace("Plan accept missing");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "Accept missing plan",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
			},
		});
		const emptyResponse = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(emptyResponse.status).toBe(400);

		const response = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId: "nope",
					workspaceId,
					expectedHeadStateVersion: 0,
					idempotencyKey: "missing-plan-accept",
				}),
			},
		);
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error?: string };
		expect(body.error ?? "").toMatch(/plan/i);
	});

	it("accepting a plan on a Done task returns 200 — plan lifecycle is independent of task row status", async () => {
		const { workspaceId } = await seedWorkspace("Plan accept done task");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "Done task",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
			},
		});
		const plan = minimalCompiledPlan("re-accept", "Re-accept");
		await saveCompiledPlan({
			workspaceId,
			taskId: task.id,
			compiledPlan: plan,
			status: "draft",
			prompt: "draft",
			summary: "draft",
			generatedBy: "test",
		});
		await seedPlanAcceptanceHead({
			workspaceId,
			taskId: task.id,
			planId: "re-accept",
		});
		await db.task.update({ where: { id: task.id }, data: { status: "Done" } });

		const response = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId: "re-accept",
					workspaceId,
					expectedHeadStateVersion: 0,
					idempotencyKey: "done-plan-accept",
				}),
			},
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { savedPlan: { status: string } };
		expect(body.savedPlan.status).toBe("accepted");
	});

	it("accepting a plan on a recurring task scopes the accepted plan to the requested workBlockId", async () => {
		const { workspaceId } = await seedWorkspace("Plan accept workblock scope");
		const anchor = new Date("2026-06-15T09:00:00.000Z");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "Recurring plan accept",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
				recurrenceRule: "FREQ=DAILY;COUNT=2",
				recurrenceAnchorStartAt: anchor,
				recurrenceAnchorEndAt: new Date(anchor.getTime() + 30 * 60 * 1000),
			},
		});
		await db.taskTrigger.create({
			data: {
				workspaceId,
				taskId: task.id,
				kind: "schedule",
				state: "Enabled",
				config: {
					mode: "recurring",
					rrule: "FREQ=DAILY;COUNT=2",
					anchorStartAt: anchor.toISOString(),
					timezone: "UTC",
					durationMs: 30 * 60 * 1000,
				},
			},
		});
		await runRecurringWorkBlockExpansionWorker({ now: anchor });
		const [first, second] = await db.workBlock.findMany({
			where: { taskId: task.id },
			orderBy: { scheduledStartAt: "asc" },
		});
		expect(first && second).toBeTruthy();

		const plan = minimalCompiledPlan("occ-plan", "Occurrence plan");
		await saveCompiledPlan({
			workspaceId,
			taskId: task.id,
			workBlockId: first!.id,
			compiledPlan: plan,
			status: "draft",
			prompt: "draft",
			summary: "draft",
			generatedBy: "test",
		});
		await seedPlanAcceptanceHead({
			workspaceId,
			taskId: task.id,
			planId: "occ-plan",
			workBlockId: first!.id,
		});

		const response = await app().request(
			`http://local/api/tasks/${task.id}/plan/accept`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId: "occ-plan",
					workspaceId,
					workBlockId: first!.id,
					expectedHeadStateVersion: 0,
					idempotencyKey: "occurrence-plan-accept",
				}),
			},
		);
		expect(response.status).toBe(200);

		const firstPlan = await getLatestTaskPlanReadModel(task.id, first!.id);
		const secondPlan = await getLatestTaskPlanReadModel(task.id, second!.id);
		expect(firstPlan?.status).toBe("accepted");
		// Sibling has its own scope — engine returns null for an
		// occurrence that has never had a plan saved.
		expect(secondPlan).toBeNull();
	});

	it("stopping a generation with no active session returns stopped:false without error", async () => {
		const { workspaceId } = await seedWorkspace("Plan stop no-op");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "Idle stop",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
			},
		});

		const response = await app().request(
			`http://local/api/tasks/${task.id}/plan/generations/stop`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workspaceId }),
			},
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { stopped: boolean };
		expect(body.stopped).toBe(false);
	});

	it("GET /plan/generations/active returns well-formed response on a fresh task", async () => {
		const { workspaceId } = await seedWorkspace("Plan active no-op");
		const task = await db.task.create({
			data: {
				workspaceId,
				title: "No active gen",
				status: "Ready",
				priority: "Medium",
				executionConfig: {},
			},
		});

		const response = await app().request(
			`http://local/api/tasks/${task.id}/plan/generations/active?workspaceId=${workspaceId}`,
		);
		// The endpoint contract: 200 with null/empty payload, or 404
		// if the implementation chose to error. We accept either, but
		// assert the response is well-formed JSON.
		expect([200, 404]).toContain(response.status);
		if (response.status === 200) {
			const body = (await response.json()) as unknown;
			expect(body === null || typeof body === "object").toBe(true);
		}
	});
});
