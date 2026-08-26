import { describe, expect, it, beforeAll } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@chrona/db";
import {
	ConflictingTerminalActionError,
	mintRunToken,
	recordTerminalAction,
	validateRunToken,
	revokeRunToken,
} from "../plan-execution/runtime/agent-control-store";
import { handleControlAction, type ControlRouteError } from "./control-route";
import {
	registerActiveRuntimeInvocation,
	resetActiveRuntimeInvocationsForTest,
} from "../plan-execution/runtime/active-runtime-invocations";
import {
	isTerminalControlKind,
	submitNodeResultActionFromControl,
	submitNodeResultActionFromTool,
	toolNameFromControlKind,
} from "./node-result-action";

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

beforeAll(async () => {
	// Reset any prior session.
	await db.runToken.deleteMany({});
	await db.taskPlanTerminalAction.deleteMany({});
	resetActiveRuntimeInvocationsForTest();
});

describe("run token mint/validate round-trip", () => {
	it("returns null for unknown token", async () => {
		const result = await validateRunToken("not-a-real-token");
		expect(result).toBeNull();
	});

	it("mints and validates with sha256 hash stored", async () => {
		const workspace = await db.workspace.create({
			data: {
				name: "ws-token",
				status: "Active",
			},
		});
		const task = await db.task.create({
			data: {
				workspaceId: workspace.id,
				title: "t",
				kind: "single",
				executionConfig: {},
				status: "Ready",
				priority: "Medium",
			},
		});
		const run = await db.run.create({
			data: {
				taskId: task.id,
				runtimeName: "claude_code",
				runtimeSessionRef: "sess",
				status: "Running",
				triggeredBy: "system",
			},
		});
		const token = await mintRunToken({
			taskId: task.id,
			workspaceId: workspace.id,
			runId: run.id,
			runtimeSessionKey: "sess",
			nodeAttemptId: "attempt-1",
		});
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(20);
		const scope = await validateRunToken(token);
		expect(scope?.runId).toBe(run.id);
		expect(scope?.nodeAttemptId).toBe("attempt-1");
		// Stored hash matches sha256(token).
		const stored = await db.runToken.findFirst({ where: { runId: run.id } });
		expect(stored?.tokenHash).toBe(sha256(token));
		await db.runToken.deleteMany({ where: { runId: run.id } });
		await db.run.delete({ where: { id: run.id } });
		await db.task.delete({ where: { id: task.id } });
		await db.workspace.delete({ where: { id: workspace.id } });
	});

	it("rejects expired and revoked tokens", async () => {
		const workspace = await db.workspace.create({
			data: { name: "ws-exp", status: "Active" },
		});
		const task = await db.task.create({
			data: {
				workspaceId: workspace.id,
				title: "t2",
				kind: "single",
				executionConfig: {},
				status: "Ready",
				priority: "Medium",
			},
		});
		const run = await db.run.create({
			data: {
				taskId: task.id,
				runtimeName: "claude_code",
				runtimeSessionRef: "sess",
				status: "Running",
				triggeredBy: "system",
			},
		});
		const token = await mintRunToken({
			taskId: task.id,
			workspaceId: workspace.id,
			runId: run.id,
			runtimeSessionKey: "sess",
			expiresAt: new Date(Date.now() - 1000),
		});
		expect(await validateRunToken(token)).toBeNull();

		const token2 = await mintRunToken({
			taskId: task.id,
			workspaceId: workspace.id,
			runId: run.id,
			runtimeSessionKey: "sess",
		});
		expect(await revokeRunToken(token2)).toBe(true);
		expect(await validateRunToken(token2)).toBeNull();

		await db.runToken.deleteMany({ where: { runId: run.id } });
		await db.run.delete({ where: { id: run.id } });
		await db.task.delete({ where: { id: task.id } });
		await db.workspace.delete({ where: { id: workspace.id } });
	});
});

describe("terminal action recording", () => {
	it("[MCP-007] records one terminal action, replays same-kind retries, and rejects conflicting kinds", async () => {
		const workspace = await db.workspace.create({
			data: { name: "ws-rec", status: "Active" },
		});
		const task = await db.task.create({
			data: {
				workspaceId: workspace.id,
				title: "t3",
				kind: "single",
				executionConfig: {},
				status: "Ready",
				priority: "Medium",
			},
		});
		const run = await db.run.create({
			data: {
				taskId: task.id,
				runtimeName: "claude_code",
				runtimeSessionRef: "sess",
				status: "Running",
				triggeredBy: "system",
			},
		});
		const plan = await db.taskPlan.create({
			data: {
				workspaceId: workspace.id,
				taskId: task.id,
				planId: "plan-1",
				revision: 1,
				status: "Accepted",
				compiledPlan: {},
			},
		});
		const planRun = await db.taskPlanRun.create({
			data: {
				workspaceId: workspace.id,
				taskId: task.id,
				planId: plan.planId,
				planRun: {},
			},
		});
		const attempt = await db.taskPlanNodeAttempt.create({
			data: {
				workspaceId: workspace.id,
				taskId: task.id,
				planId: plan.planId,
				planRunId: planRun.id,
				nodeId: "node-1",
				nodeLayerId: "layer-1",
				idempotencyKey: "attempt-key-1",
				attemptNumber: 1,
				status: "running",
				executionEpoch: 0,
			},
		});
		const scope = {
			taskId: task.id,
			workspaceId: workspace.id,
			taskSessionId: null,
			runId: run.id,
			runtimeSessionKey: "sess",
			nodeId: attempt.nodeId,
			nodeAttemptId: attempt.id,
			providerRunId: null,
		};
		const first = await recordTerminalAction({
			scope,
			kind: "complete",
			payload: { summary: "ok" },
			workspaceId: workspace.id,
		});
		const retry = await recordTerminalAction({
			scope,
			kind: "complete",
			payload: { summary: "again" },
			workspaceId: workspace.id,
		});
		expect(first.recorded).toBe(true);
		expect(retry.recorded).toBe(false);
		expect(retry.action.id).toBe(first.action.id);
		await expect(
			recordTerminalAction({
				scope,
				kind: "fail",
				payload: { error: "conflict" },
				workspaceId: workspace.id,
			}),
		).rejects.toBeInstanceOf(ConflictingTerminalActionError);

		const token = await mintRunToken({ ...scope });
		const activeInvocation = registerActiveRuntimeInvocation({
			runId: scope.runId,
			nodeAttemptId: attempt.id,
		});
		const unrelatedInvocation = registerActiveRuntimeInvocation({
			runId: scope.runId,
			nodeAttemptId: "other-attempt",
		});
		const acknowledged = await handleControlAction({
			token,
			workspaceId: workspace.id,
			body: { kind: "complete", payload: { summary: "retry through route" } },
		});
		expect(acknowledged).toMatchObject({
			ok: true,
			kind: "complete",
			recorded: false,
			alreadyAccepted: true,
			result: null,
		});
		expect(activeInvocation.controller.signal.aborted).toBe(true);
		expect(unrelatedInvocation.controller.signal.aborted).toBe(false);
		activeInvocation.dispose();
		unrelatedInvocation.dispose();
		await expect(
			handleControlAction({
				token,
				workspaceId: workspace.id,
				body: { kind: "fail", payload: { error: "conflicting outcome" } },
			}),
		).rejects.toMatchObject({
			code: "conflicting_terminal_action",
			status: 409,
		} satisfies Partial<ControlRouteError>);
		expect(await validateRunToken(token)).toBeNull();
		await expect(
			handleControlAction({
				token,
				workspaceId: workspace.id,
				body: {
					kind: "complete",
					payload: { summary: "replayed after revocation" },
				},
			}),
		).resolves.toMatchObject({
			ok: true,
			kind: "complete",
			recorded: false,
			alreadyAccepted: true,
			result: null,
		});
		await expect(
			handleControlAction({
				token,
				workspaceId: workspace.id,
				body: {
					kind: "fail",
					payload: { error: "conflicting after revocation" },
				},
			}),
		).rejects.toMatchObject({
			code: "conflicting_terminal_action",
			status: 409,
		} satisfies Partial<ControlRouteError>);
		const expiredToken = await mintRunToken({
			...scope,
			expiresAt: new Date(Date.now() - 1),
		});
		await expect(
			handleControlAction({
				token: expiredToken,
				workspaceId: workspace.id,
				body: { kind: "complete", payload: { summary: "expired replay" } },
			}),
		).rejects.toMatchObject({
			code: "token_invalid",
			status: 401,
		} satisfies Partial<ControlRouteError>);
		await db.runToken.deleteMany({ where: { runId: run.id } });

		await db.taskPlanTerminalAction.deleteMany({ where: { runId: run.id } });
		await db.run.delete({ where: { id: run.id } });
		await db.task.delete({ where: { id: task.id } });
		await db.workspace.delete({ where: { id: workspace.id } });
	});
});
describe("kind -> action mapper", () => {
	it("maps terminal kinds (complete / condition_select / wait_complete / block / fail)", () => {
		expect(
			submitNodeResultActionFromControl({
				body: { kind: "complete", payload: { summary: "ok" } },
			})?.action,
		).toBe("complete_manual_node");
		expect(
			submitNodeResultActionFromControl({
				body: {
					kind: "condition_select",
					payload: { nodeId: "n", branchRef: "x", summary: "ok" },
				},
			})?.action,
		).toBe("complete_manual_node");
		expect(
			submitNodeResultActionFromControl({
				body: { kind: "wait_complete", payload: { summary: "ok" } },
			})?.action,
		).toBe("complete_manual_node");
		expect(
			submitNodeResultActionFromControl({
				body: {
					kind: "block",
					payload: {
						reason: "need input",
						actionForm: {
							instructions: "fill",
							inputFields: [{ name: "x", label: "X" }],
						},
					},
				},
			})?.action,
		).toBe("block_current_node");
		expect(
			submitNodeResultActionFromControl({
				body: { kind: "fail", payload: { error: "boom" } },
			})?.action,
		).toBe("fail_current_node");
	});

	it("isTerminalControlKind only true for terminal kinds", () => {
		expect(isTerminalControlKind("complete")).toBe(true);
		expect(isTerminalControlKind("condition_select")).toBe(true);
		expect(isTerminalControlKind("wait_complete")).toBe(true);
		expect(isTerminalControlKind("block")).toBe(true);
		expect(isTerminalControlKind("fail")).toBe(true);
		expect(isTerminalControlKind("task_read")).toBe(false);
		expect(isTerminalControlKind("plan_read")).toBe(false);
	});

	it("reuses submitNodeResultActionFromTool from dispatch path", () => {
		const fromTool = submitNodeResultActionFromTool({
			toolName: "chrona.node.complete",
			payload: { summary: "ok" },
		});
		const fromControl = submitNodeResultActionFromControl({
			body: { kind: "complete", payload: { summary: "ok" } as never },
		});
		expect(fromTool?.action).toBe(fromControl?.action);
	});

	it("toolNameFromControlKind round-trips with dispatch tool names", () => {
		expect(toolNameFromControlKind("complete")).toBe("chrona.node.complete");
		expect(toolNameFromControlKind("block")).toBe("chrona.node.block");
	});
});
