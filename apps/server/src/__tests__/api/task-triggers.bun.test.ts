import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import { runGoalReviewDueWorker } from "@chrona/engine/test-support";
import { createApiRouter } from "../../routes/api";
import { resetEnvCacheForTests } from "../../config/env";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

async function task(workspaceId: string, title: string) {
	return db.task.create({
		data: {
			workspaceId,
			title,
			status: "Ready",
			priority: "Medium",
			executionConfig: {},
		},
	});
}

async function postEmail(
	app: ReturnType<typeof createApiRouter>,
	secret: string,
	body: Record<string, unknown>,
	signatureSecret = secret,
) {
	const rawBody = JSON.stringify(body);
	const timestamp = new Date(String(body.timestamp));
	const signature = createHmac("sha256", signatureSecret)
		.update(`${timestamp.toISOString()}.${rawBody}`)
		.digest("hex");
	return app.request("/integrations/email/events", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-chrona-email-secret": secret,
			"x-chrona-email-signature": signature,
		},
		body: rawBody,
	});
}

describe("Task triggers and occurrence authority", () => {
	beforeEach(async () => {
		await resetTestDb();
	});

	it("materializes versioned schedule occurrences and rejects unknown kinds", async () => {
		const { workspaceId } = await seedWorkspace();
		const target = await task(workspaceId, "Scheduled definition");
		const fireAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
		const engine = createChronaEngine();
		await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: {
					kind: "schedule",
					config: {
						mode: "once",
						fireAt,
						timezone: "UTC",
						durationMs: 3_600_000,
					},
				},
			},
		});
		const occurrences = await engine.triggers.listOccurrences({
			taskId: target.id,
			workspaceId,
		});
		expect(occurrences.occurrences).toHaveLength(1);
		expect(occurrences.occurrences[0]).toMatchObject({
			occurrenceKey: `schedule:v1:${fireAt}`,
			triggerVersion: 1,
			status: "Scheduled",
		});
		expect(() =>
			(engine.triggers.create as unknown as (input: unknown) => unknown)({
				taskId: target.id,
				command: { workspaceId, definition: { kind: "webhook", config: {} } },
			}),
		).toThrow();
	});

	it("preserves started occurrences and materializes a distinct work block for the next trigger version", async () => {
		const { workspaceId } = await seedWorkspace();
		const target = await task(workspaceId, "Versioned schedule");
		const fireAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
		const engine = createChronaEngine();
		const trigger = await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: {
					kind: "schedule",
					config: { mode: "once", fireAt, timezone: "UTC" },
				},
			},
		});
		const first = await db.taskOccurrence.findFirstOrThrow({
			where: { taskId: target.id },
			include: { workBlock: true },
		});
		await db.taskOccurrence.update({
			where: { id: first.id },
			data: { status: "Running", startedAt: new Date() },
		});
		await db.workBlock.update({
			where: { id: first.workBlockId! },
			data: { status: "Active", startedAt: new Date() },
		});

		await engine.triggers.update({
			taskId: target.id,
			triggerId: trigger.id,
			command: {
				workspaceId,
				expectedVersion: 1,
				definition: {
					kind: "schedule",
					config: { mode: "once", fireAt, timezone: "UTC" },
				},
			},
		});
		const second = await db.taskOccurrence.findFirstOrThrow({
			where: { taskId: target.id, triggerVersion: 2 },
			include: { workBlock: true },
		});
		expect(
			(await db.taskOccurrence.findUniqueOrThrow({ where: { id: first.id } }))
				.status,
		).toBe("Running");
		expect(second).toMatchObject({
			occurrenceKey: `schedule:v2:${fireAt}`,
			status: "Scheduled",
		});
		expect(second.workBlockId).not.toBe(first.workBlockId);
		expect(second.workBlock?.recurrenceKey).toBe(`schedule:v2:${fireAt}`);
	});

	it("cancels only the replaced version's unstarted occurrence and work block", async () => {
		const { workspaceId } = await seedWorkspace();
		const target = await task(workspaceId, "Cancelled versioned schedule");
		const fireAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
		const engine = createChronaEngine();
		const trigger = await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: {
					kind: "schedule",
					config: { mode: "once", fireAt, timezone: "UTC" },
				},
			},
		});
		const first = await db.taskOccurrence.findFirstOrThrow({
			where: { taskId: target.id },
			include: { workBlock: true },
		});

		await engine.triggers.update({
			taskId: target.id,
			triggerId: trigger.id,
			command: {
				workspaceId,
				expectedVersion: 1,
				definition: {
					kind: "schedule",
					config: { mode: "once", fireAt, timezone: "UTC" },
				},
			},
		});
		const second = await db.taskOccurrence.findFirstOrThrow({
			where: { taskId: target.id, triggerVersion: 2 },
			include: { workBlock: true },
		});
		expect(
			(await db.taskOccurrence.findUniqueOrThrow({ where: { id: first.id } }))
				.status,
		).toBe("Cancelled");
		expect(
			(
				await db.workBlock.findUniqueOrThrow({
					where: { id: first.workBlockId! },
				})
			).status,
		).toBe("Cancelled");
		expect(second).toMatchObject({
			occurrenceKey: `schedule:v2:${fireAt}`,
			status: "Scheduled",
		});
		expect(second.workBlockId).not.toBe(first.workBlockId);
	});

	it("activates filtered accepted-result events once with bounded normalized input", async () => {
		const { workspaceId } = await seedWorkspace();
		const source = await task(workspaceId, "Source task");
		const target = await task(workspaceId, "Follow accepted reports");
		const engine = createChronaEngine();
		await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: {
					kind: "event",
					config: {
						topic: "task.result.accepted",
						filter: { path: "taskId", operator: "eq", value: source.id },
					},
				},
			},
		});
		const run = await db.run.create({
			data: {
				taskId: source.id,
				runtimeName: "hermes",
				status: "Completed",
				triggeredBy: "user",
			},
		});
		const nonmatching = await engine.triggers.activateEvent({
			workspaceId,
			topic: "task.result.accepted",
			causationId: `${run.id}:other`,
			normalizedInput: { taskId: target.id, runId: run.id },
		});
		expect(nonmatching).toBe(0);
		expect(
			await db.taskOccurrence.count({ where: { taskId: target.id } }),
		).toBe(0);
		const first = await engine.triggers.activateEvent({
			workspaceId,
			topic: "task.result.accepted",
			causationId: run.id,
			normalizedInput: { taskId: source.id, runId: run.id },
		});
		const duplicate = await engine.triggers.activateEvent({
			workspaceId,
			topic: "task.result.accepted",
			causationId: run.id,
			normalizedInput: { taskId: source.id, runId: run.id },
		});
		expect(first).toBe(1);
		expect(duplicate).toBe(0);
		expect(
			await db.taskOccurrence.count({ where: { taskId: target.id } }),
		).toBe(1);
	});

	it("authenticates, deduplicates, filters, and bounds external email deliveries", async () => {
		const { workspaceId } = await seedWorkspace();
		const target = await task(workspaceId, "Handle launch email");
		const engine = createChronaEngine();
		await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: {
					kind: "email",
					config: { recipient: "launch-inbox", subjectContains: "Launch" },
				},
			},
		});
		process.env.CHRONA_EMAIL_TRIGGER_SECRET = "test-email-trigger-secret";
		resetEnvCacheForTests();
		const app = createApiRouter(engine);
		const delivery = {
			timestamp: new Date().toISOString(),
			workspaceId,
			deliveryId: "mail-1",
			recipient: "launch-inbox",
			from: "owner@example.test",
			subject: "Launch readiness",
			text: "Review final evidence",
			receivedAt: new Date().toISOString(),
		};

		expect(
			(
				await postEmail(app, "test-email-trigger-secret", {
					...delivery,
					recipient: undefined,
				})
			).status,
		).toBe(400);
		expect(
			(
				await postEmail(app, "test-email-trigger-secret", {
					...delivery,
					deliveryId: "oversized",
					text: "x".repeat(50_001),
				})
			).status,
		).toBe(400);
		expect(
			await db.taskOccurrence.count({ where: { taskId: target.id } }),
		).toBe(0);
		expect((await postEmail(app, "wrong-secret", delivery)).status).toBe(401);
		expect(
			(
				await postEmail(
					app,
					"test-email-trigger-secret",
					delivery,
					"wrong-signature-secret",
				)
			).status,
		).toBe(401);
		expect(
			(
				await postEmail(app, "test-email-trigger-secret", {
					...delivery,
					timestamp: new Date(Date.now() - 6 * 60_000).toISOString(),
					deliveryId: "expired",
				})
			).status,
		).toBe(401);
		expect(
			await (
				await postEmail(app, "test-email-trigger-secret", delivery)
			).json(),
		).toEqual({ accepted: true, activated: 1 });
		expect(
			await (
				await postEmail(app, "test-email-trigger-secret", delivery)
			).json(),
		).toEqual({ accepted: true, activated: 0 });
		const occurrence = await db.taskOccurrence.findFirstOrThrow({
			where: { taskId: target.id },
		});
		const other = await seedWorkspace("Other email workspace");
		const otherTarget = await task(other.workspaceId, "Other launch email");
		await engine.triggers.create({
			taskId: otherTarget.id,
			command: {
				workspaceId: other.workspaceId,
				definition: {
					kind: "email",
					config: { recipient: "launch-inbox", subjectContains: "Launch" },
				},
			},
		});
		expect(
			await (
				await postEmail(app, "test-email-trigger-secret", {
					...delivery,
					deliveryId: "mail-2",
				})
			).json(),
		).toEqual({ accepted: true, activated: 1 });
		expect(
			await db.taskOccurrence.count({ where: { taskId: otherTarget.id } }),
		).toBe(0);
		expect(occurrence.normalizedInput).toMatchObject({
			adapter: "email",
			from: "owner@example.test",
			subject: "Launch readiness",
		});
		expect(JSON.stringify(occurrence.normalizedInput)).not.toContain(
			"test-email-trigger-secret",
		);
	});

	it("publishes review-due Goal facts to internal event triggers", async () => {
		const { workspaceId } = await seedWorkspace();
		const target = await task(workspaceId, "Review follow-up");
		const engine = createChronaEngine();
		await engine.triggers.create({
			taskId: target.id,
			command: {
				workspaceId,
				definition: { kind: "event", config: { topic: "goal.review_due" } },
			},
		});
		const goal = await db.goal.create({
			data: {
				workspaceId,
				title: "Quarterly launch",
				description: "Review due",
				successCriteria: [],
				status: "Active",
				nextReviewAt: new Date("2026-07-01T00:00:00.000Z"),
			},
		});
		const futureGoal = await db.goal.create({
			data: {
				workspaceId,
				title: "Future launch",
				description: "Review later",
				successCriteria: [],
				status: "Active",
				nextReviewAt: new Date("2026-07-03T00:00:00.000Z"),
			},
		});
		const now = new Date("2026-07-02T00:00:00.000Z");
		expect(await runGoalReviewDueWorker({ now })).toBe(1);
		expect(await runGoalReviewDueWorker({ now })).toBe(0);
		const occurrence = await db.taskOccurrence.findFirstOrThrow({
			where: {
				taskId: target.id,
				occurrenceKey: { startsWith: "event:goal.review_due" },
			},
		});
		expect(occurrence.normalizedInput).toMatchObject({
			goalId: goal.id,
			activationDepth: 0,
		});
		expect(JSON.stringify(occurrence.normalizedInput)).not.toContain(
			futureGoal.id,
		);
		expect(
			await db.taskOccurrence.count({ where: { taskId: target.id } }),
		).toBe(1);
	});
});
