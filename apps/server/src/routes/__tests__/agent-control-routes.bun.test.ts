import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { mintRunToken, revokeRunToken } from "@chrona/engine";
import {
	resetTestDb,
	seedTask,
	seedWorkspace,
} from "../../__tests__/bun-test-helpers";
import { createAgentControlRoutes } from "../../../../../features/mcp-control-plane/server";

const body = JSON.stringify({ body: { kind: "task_read", payload: {} } });

function request(
	app: ReturnType<typeof createAgentControlRoutes>,
	token?: string,
	requestBody = body,
) {
	return app.request("/agent/control", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: requestBody,
	});
}

describe("agent control run-token authorization", () => {
	beforeEach(async () => {
		await resetTestDb();
	});

	it("rejects missing, wrong, and revoked tokens without changing execution state", async () => {
		const { workspaceId } = await seedWorkspace("Agent control auth");
		const { taskId } = await seedTask(workspaceId, { status: "Running" });
		const run = await db.run.create({
			data: {
				taskId,
				runtimeName: "hermes",
				runtimeSessionRef: "agent-control-session",
				status: "Running",
				triggeredBy: "agent",
			},
		});
		const execution = await db.executionSession.create({
			data: {
				workspaceId,
				taskId,
				status: "Active",
				currentNodeId: "node-current",
				startedAt: new Date(),
			},
		});
		const token = await mintRunToken({
			taskId,
			workspaceId,
			runId: run.id,
			runtimeSessionKey: "agent-control-session",
			nodeAttemptId: "attempt-current",
		});
		const app = createAgentControlRoutes();

		expect((await request(app)).status).toBe(401);
		expect((await request(app, "wrong-run-token")).status).toBe(401);
		expect(await revokeRunToken(token)).toBe(true);
		expect((await request(app, token)).status).toBe(401);

		const retainedRun = await db.run.findUniqueOrThrow({
			where: { id: run.id },
		});
		const retainedExecution = await db.executionSession.findUniqueOrThrow({
			where: { id: execution.id },
		});
		expect(retainedRun.status).toBe(run.status);
		expect(retainedRun.taskId).toBe(taskId);
		expect(retainedExecution.status).toBe(execution.status);
		expect(retainedExecution.currentNodeId).toBe("node-current");
		expect(retainedExecution.taskId).toBe(taskId);
	});

	it("replays an acknowledged terminal action through a revoked token", async () => {
		const { workspaceId } = await seedWorkspace("Agent control replay");
		const { taskId } = await seedTask(workspaceId, { status: "Running" });
		const run = await db.run.create({
			data: {
				taskId,
				runtimeName: "omp",
				runtimeSessionRef: "agent-control-replay",
				status: "Running",
				triggeredBy: "agent",
			},
		});
		const plan = await db.taskPlan.create({
			data: {
				workspaceId,
				taskId,
				planId: "agent-control-replay-plan",
				revision: 1,
				status: "Accepted",
				compiledPlan: {},
			},
		});
		const planRun = await db.taskPlanRun.create({
			data: {
				workspaceId,
				taskId,
				planId: plan.planId,
				planRun: {},
			},
		});
		const attempt = await db.taskPlanNodeAttempt.create({
			data: {
				workspaceId,
				taskId,
				planId: plan.planId,
				planRunId: planRun.id,
				nodeId: "node-1",
				nodeLayerId: "layer-1",
				idempotencyKey: "agent-control-replay-attempt",
				attemptNumber: 1,
				status: "running",
				executionEpoch: 0,
			},
		});
		const token = await mintRunToken({
			taskId,
			workspaceId,
			runId: run.id,
			runtimeSessionKey: "agent-control-replay",
			nodeId: attempt.nodeId,
			nodeAttemptId: attempt.id,
		});
		const app = createAgentControlRoutes();
		const complete = JSON.stringify({
			body: { kind: "complete", payload: { summary: "Done" } },
		});

		const first = await request(app, token, complete);
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({
			recorded: true,
			alreadyAccepted: false,
		});
		const replay = await request(app, token, complete);
		expect(replay.status).toBe(200);
		expect(await replay.json()).toMatchObject({
			recorded: false,
			alreadyAccepted: true,
		});
		const conflict = await request(
			app,
			token,
			JSON.stringify({ body: { kind: "fail", payload: { error: "No" } } }),
		);
		expect(conflict.status).toBe(409);
	});
});
