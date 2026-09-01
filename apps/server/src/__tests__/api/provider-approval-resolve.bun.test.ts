import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import {
	aiClientRegistry,
	createChronaEngine,
	stableJsonHash,
} from "@chrona/engine";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

const realFetch = globalThis.fetch;
let approvalClientIdentity: { id: string; configDigest: string } | null = null;

// Provider-approval resolve flow. The route lives in
// apps/server/src/routes/tasks/execution.routes.ts and reads
// TaskPlanProviderApproval rows directly. These tests pin:
// - empty list, status filter, 404 on missing, "not_pending" on
// already-resolved.
//
// The body's `choice` field is the zod schema's enum:
// `approve_once | approve_session | approve_always | deny`
// (NOT the legacy "approve | reject" the route tests in
// task-flow-* files used). The first failure here surfaced that
// schema change.

function app() {
	const server = new Hono();
	server.route("/api", createApiRouter(createChronaEngine()));
	return server;
}

function approvalScope(approval: {
	workBlockId: string | null;
	executionScope: string;
}) {
	if (!approval.workBlockId)
		throw new Error("Expected approval work block scope");
	return {
		workBlockId: approval.workBlockId,
		executionScope: approval.executionScope,
	};
}

function approvalQuery(
	approval: { workBlockId: string | null; executionScope: string },
	status: "pending" | "all" = "pending",
) {
	return new URLSearchParams({ ...approvalScope(approval), status }).toString();
}

async function seedPendingApproval(
	workspaceId: string,
	taskId: string,
	options: { taskScoped?: boolean } = {},
) {
	const planIdSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const plan = await db.taskPlan.create({
		data: {
			workspaceId,
			taskId,
			planId: `plan-${taskId}-${planIdSuffix}`,
			revision: 1,
			status: "Draft",
			compiledPlan: {} as object,
			generatedBy: "test",
		},
	});
	const workBlock = options.taskScoped
		? null
		: await db.workBlock.create({
				data: {
					workspaceId,
					taskId,
					title: "Approval occurrence",
					status: "Scheduled",
					scheduledStartAt: new Date("2026-07-29T12:00:00.000Z"),
					scheduledEndAt: new Date("2026-07-29T13:00:00.000Z"),
					trigger: "manual",
				},
			});
	const planRun = await db.taskPlanRun.create({
		data: {
			workspaceId,
			taskId,
			workBlockId: workBlock?.id ?? null,
			workBlockScopeKey: workBlock?.id ?? "",
			planId: plan.planId,
			planRun: { status: "running" } as object,
			executionEpoch: 0,
		},
	});
	const nodeAttempt = await db.taskPlanNodeAttempt.create({
		data: {
			workspaceId,
			taskId,
			planId: plan.planId,
			planRunId: planRun.id,
			nodeId: "approval-node",
			nodeLayerId: "layer-1",
			idempotencyKey: `idem-${planIdSuffix}`,
			attemptNumber: 1,
			status: "running",
			executionEpoch: 0,
		},
	});
	const runtimeRun = await db.run.create({
		data: {
			taskId,
			workBlockId: workBlock?.id ?? null,
			nodeAttemptId: nodeAttempt.id,
			runtimeName: "hermes",
			runtimeRunRef: `runtime-${planIdSuffix}`,
			status: "WaitingForApproval",
			triggeredBy: "test",
		},
	});
	const providerRun = await db.taskPlanProviderRun.create({
		data: {
			workspaceId,
			taskId,
			planId: plan.planId,
			planRunId: planRun.id,
			nodeAttemptId: nodeAttempt.id,
			runId: runtimeRun.id,
			...(approvalClientIdentity
				? {
						aiClientId: approvalClientIdentity.id,
						aiClientConfigDigest: approvalClientIdentity.configDigest,
					}
				: {}),
			idempotencyKey: `prov-${planIdSuffix}`,
			status: "waiting_for_approval",
		},
	});
	await db.executionSession.updateMany({
		where: { taskId, activeScopeKey: "active" },
		data: {
			status: "Abandoned",
			activeScopeKey: null,
			completedAt: new Date(),
		},
	});
	await db.executionSession.create({
		data: {
			workspaceId,
			taskId,
			planId: plan.planId,
			workBlockId: workBlock?.id ?? null,
			status: "Active",
			activeScopeKey: "active",
			currentNodeId: nodeAttempt.nodeId,
			currentNodeAttemptId: nodeAttempt.id,
			completedNodeIds: "[]",
		},
	});
	const approval = await db.taskPlanProviderApproval.create({
		data: {
			workspaceId,
			taskId,
			nodeAttemptId: nodeAttempt.id,
			workBlockId: workBlock?.id ?? null,
			planId: plan.planId,
			planRunId: planRun.id,
			providerRunId: providerRun.id,
			provider: "hermes",
			kind: "tool_authorization",
			title: "Approve send_email",
			summary: "Send email to alice@example.com",
			description: "Tool request from Hermes requires human approval",
			riskLevel: "medium",
			subject: { tool: "send_email", recipient: "alice@example.com" } as object,
			choices: [
				"approve_once",
				"approve_session",
				"approve_always",
				"deny",
			] as object,
			status: "pending",
			requestedAt: new Date(),
		},
	});
	return {
		approval: { ...approval, executionScope: planRun.executionScopeId },
		planRun,
		providerRun,
		runtimeRun,
		workBlock,
	};
}

async function resolveApproval(
	taskId: string,
	approval: { id: string; workBlockId: string | null; executionScope: string },
	choice:
		| "approve_once"
		| "approve_session"
		| "approve_always"
		| "deny" = "approve_once",
	idempotencyKey: string = crypto.randomUUID(),
) {
	return app().request(
		`http://local/api/tasks/${taskId}/provider-approvals/${approval.id}/resolve`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				workBlockId: approval.workBlockId,
				executionScope: approval.executionScope,
				choice,
				idempotencyKey,
			}),
		},
	);
}

async function seedHermesApprovalClient(baseUrl = "https://provider.test") {
	const config = { baseUrl };
	const client = await db.aiClient.create({
		data: {
			name: `Hermes approval ${crypto.randomUUID()}`,
			type: "hermes",
			config,
			enabled: true,
			isDefault: true,
		},
	});
	await aiClientRegistry.refresh();
	const registeredClient = await aiClientRegistry.get(client.id);
	if (!registeredClient)
		throw new Error("Expected registered Hermes approval client");
	approvalClientIdentity = {
		id: client.id,
		configDigest: stableJsonHash(registeredClient.record.config),
	};
}

function jsonProviderResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

type MockFetchHandler = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

function setMockFetch(handler: MockFetchHandler) {
	globalThis.fetch = Object.assign(handler, {
		preconnect: realFetch.preconnect,
	}) as typeof fetch;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("provider approval resolve", () => {
	beforeEach(async () => {
		approvalClientIdentity = null;
		await resetTestDb();
		await aiClientRegistry.refresh();
	});

	afterEach(async () => {
		globalThis.fetch = realFetch;
		await aiClientRegistry.refresh();
	});

	it("GET /provider-approvals requires a selected occurrence scope", async () => {
		const ws = await seedWorkspace("Approval list fresh");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		await db.taskPlanProviderApproval.delete({ where: { id: approval.id } });

		const missingScope = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?status=pending`,
		);
		expect(missingScope.status).toBe(400);

		const response = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(approval)}`,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { approvals: unknown[] };
		expect(Array.isArray(body.approvals)).toBe(true);
		expect(body.approvals).toHaveLength(0);
	});

	it("status=all returns resolved approvals; status=pending does not", async () => {
		const ws = await seedWorkspace("Approval list filter");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);

		const all = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(approval, "all")}`,
		);
		expect(all.status).toBe(200);
		const allBody = (await all.json()) as { approvals: { id: string }[] };
		expect(allBody.approvals.map((a) => a.id)).toContain(approval.id);
		const publicApproval = allBody.approvals.find(
			(item) => item.id === approval.id,
		);
		expect(publicApproval).not.toHaveProperty("nativeRunId");
		expect(publicApproval).not.toHaveProperty("subject");
		expect(publicApproval).not.toHaveProperty("taskId");
		expect(publicApproval).not.toHaveProperty("workBlockId");
		expect(publicApproval).not.toHaveProperty("planId");
		expect(publicApproval).not.toHaveProperty("planRunId");
		expect(publicApproval).not.toHaveProperty("nodeId");
		expect(publicApproval).not.toHaveProperty("runtimeName");
		expect(publicApproval).not.toHaveProperty("scopePolicy");

		await db.taskPlanProviderApproval.update({
			where: { id: approval.id },
			data: {
				status: "approved",
				choice: "approve_once",
				resolvedAt: new Date(),
			},
		});

		const pendingOnly = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(approval)}`,
		);
		expect(pendingOnly.status).toBe(200);
		const pendingBody = (await pendingOnly.json()) as {
			approvals: { id: string }[];
		};
		expect(
			pendingBody.approvals.find((a) => a.id === approval.id),
		).toBeUndefined();

		const allAfter = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(approval, "all")}`,
		);
		const allAfterBody = (await allAfter.json()) as {
			approvals: { id: string }[];
		};
		expect(allAfterBody.approvals.map((a) => a.id)).toContain(approval.id);
	});

	it("keeps listing, timeout reconciliation, and resolution within the selected occurrence", async () => {
		const ws = await seedWorkspace("Approval occurrence isolation");
		const { taskId } = await seedTask(ws.workspaceId);
		const first = await seedPendingApproval(ws.workspaceId, taskId);
		const second = await seedPendingApproval(ws.workspaceId, taskId);
		const timeoutAt = new Date(first.approval.requestedAt.getTime() + 60_001);

		await db.event.create({
			data: {
				workspaceId: ws.workspaceId,
				taskId,
				workBlockId: first.workBlock!.id,
				planRunId: first.planRun.id,
				providerRunId: first.providerRun.id,
				eventType: "provider.run_completed",
				actorType: "provider",
				source: "test",
				payload: {},
				ingestSequence: 1,
				occurredAt: timeoutAt,
			},
		});

		const listed = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(second.approval)}`,
		);
		expect(listed.status).toBe(200);
		expect(
			((await listed.json()) as { approvals: { id: string }[] }).approvals.map(
				(approval) => approval.id,
			),
		).toEqual([second.approval.id]);

		const firstAfterListingSecond =
			await db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: first.approval.id },
			});
		expect(firstAfterListingSecond.status).toBe("pending");

		const crossScopeResolve = await resolveApproval(taskId, {
			...first.approval,
			...approvalScope(second.approval),
		});
		expect(crossScopeResolve.status).toBe(404);
		expect(
			await db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: first.approval.id },
			}),
		).toMatchObject({ status: "pending" });
		expect(
			await db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: second.approval.id },
			}),
		).toMatchObject({ status: "pending" });
	});
	it("resolve on a missing approvalId returns 404", async () => {
		const ws = await seedWorkspace("Approval resolve missing");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);

		const response = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals/nope/resolve`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...approvalScope(approval),
					choice: "approve_once",
					idempotencyKey: crypto.randomUUID(),
				}),
			},
		);
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error?: string };
		expect(body.error ?? "").toMatch(/not found/i);
	});

	it("resolve on a non-pending approval returns 200 with status 'not_pending'", async () => {
		const ws = await seedWorkspace("Approval resolve non-pending");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		await db.taskPlanProviderApproval.update({
			where: { id: approval.id },
			data: {
				status: "approved",
				choice: "approve_once",
				resolvedAt: new Date(),
			},
		});

		const response = await resolveApproval(taskId, approval);
		// The route returns 200 with status "not_pending" — the
		// client uses this to refresh the UI rather than treat it as
		// an error.
		expect(response.status).toBe(200);
		const body = (await response.json()) as { status: string; choice: string };
		expect(body.status).toBe("not_pending");
		expect(body.choice).toBe("approve_once");
	});

	it("resolve with inactive provider marks approval failed and clears pending list", async () => {
		const ws = await seedWorkspace("Approval resolve inactive provider");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
		);

		const response = await resolveApproval(taskId, approval);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			status: string;
			resolved: number;
		};
		expect(body.status).toBe("failed");
		expect(body.resolved).toBe(0);

		const updated = await db.taskPlanProviderApproval.findUniqueOrThrow({
			where: { id: approval.id },
		});
		expect(updated.status).toBe("failed");
		expect(updated.resolvedAt).toBeInstanceOf(Date);

		const updatedProviderRun = await db.taskPlanProviderRun.findUniqueOrThrow({
			where: { id: providerRun.id },
		});
		expect(updatedProviderRun.status).toBe("failed");

		const pending = await app().request(
			`http://local/api/tasks/${taskId}/provider-approvals?${approvalQuery(approval)}`,
		);
		const pendingBody = (await pending.json()) as { approvals: unknown[] };
		expect(pendingBody.approvals).toHaveLength(0);
	});

	it("atomically finalizes a pending approval and its provider Run", async () => {
		const ws = await seedWorkspace("Approval resolve atomic finalization");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
		);

		const response = await resolveApproval(taskId, approval);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { status: string }).status).toBe(
			"failed",
		);
		const [updatedApproval, updatedProviderRun] = await Promise.all([
			db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: approval.id },
			}),
			db.taskPlanProviderRun.findUniqueOrThrow({
				where: { id: providerRun.id },
			}),
		]);
		expect(updatedApproval).toMatchObject({
			status: "failed",
			choice: "approve_once",
			resolveAll: false,
		});
		expect(updatedApproval.resolvedAt).toBeInstanceOf(Date);
		expect(updatedProviderRun.status).toBe("failed");
		const projection = await db.taskProjection.findUniqueOrThrow({
			where: { taskId },
		});
		expect(projection.approvalPendingCount).toBe(0);
		expect(updatedProviderRun.finishedAt).toBeInstanceOf(Date);
	});

	it("returns not_pending without overwriting a concurrent terminal resolution", async () => {
		const ws = await seedWorkspace("Approval resolve compare and swap");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
		);
		const resolvedAt = new Date("2026-07-29T12:00:00.000Z");
		await db.$transaction([
			db.taskPlanProviderApproval.update({
				where: { id: approval.id },
				data: { status: "approved", choice: "approve_session", resolvedAt },
			}),
			db.taskPlanProviderRun.update({
				where: { id: providerRun.id },
				data: { status: "running" },
			}),
		]);

		const response = await resolveApproval(taskId, approval);

		expect(response.status).toBe(200);
		const responseBody = await response.json();
		expect(responseBody).toMatchObject({
			status: "not_pending",
			choice: "approve_once",
			resolved: 0,
		});
		expect(responseBody).not.toHaveProperty("runId");
		const [updatedApproval, updatedProviderRun] = await Promise.all([
			db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: approval.id },
			}),
			db.taskPlanProviderRun.findUniqueOrThrow({
				where: { id: providerRun.id },
			}),
		]);
		expect(updatedApproval).toMatchObject({
			status: "approved",
			choice: "approve_session",
			resolvedAt,
		});
		expect(updatedProviderRun.status).toBe("running");
	});

	it("rejects choices absent from the persisted approval contract", async () => {
		const ws = await seedWorkspace("Approval invalid choice");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
		);
		await db.taskPlanProviderApproval.update({
			where: { id: approval.id },
			data: { choices: ["deny"] as object },
		});

		const response = await resolveApproval(taskId, approval);

		expect(response.status).toBe(400);
		const [updatedApproval, updatedProviderRun] = await Promise.all([
			db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: approval.id },
			}),
			db.taskPlanProviderRun.findUniqueOrThrow({
				where: { id: providerRun.id },
			}),
		]);
		expect(updatedApproval.status).toBe("pending");
		expect(updatedProviderRun.status).toBe("waiting_for_approval");
	});

	it("claims same-key concurrent resolves so provider RPC runs once", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval concurrent claim");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		const release = deferred();
		const rpcEntered = deferred();
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			rpcEntered.resolve();
			await release.promise;
			return jsonProviderResponse({ resolved: 1 });
		});

		const first = resolveApproval(taskId, approval, "approve_once", "same-key");
		await rpcEntered.promise;
		const second = resolveApproval(
			taskId,
			approval,
			"approve_once",
			"same-key",
		);
		release.resolve();
		const [firstResponse, secondResponse] = await Promise.all([first, second]);

		expect(firstResponse.status).toBe(200);
		expect(secondResponse.status).toBe(200);
		expect(rpcCount).toBe(1);
		const statuses = [
			((await firstResponse.json()) as { status: string }).status,
			((await secondResponse.json()) as { status: string }).status,
		];
		expect(statuses).toContain("resolved");
		expect(
			statuses.some(
				(status) => status === "resolved" || status === "in_flight",
			),
		).toBe(true);
	});

	it("serializes different idempotency keys for the same pending approval", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval cross-key serialization");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		const release = deferred();
		const rpcEntered = deferred();
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			rpcEntered.resolve();
			await release.promise;
			return jsonProviderResponse({ resolved: 1 });
		});

		const first = resolveApproval(
			taskId,
			approval,
			"approve_once",
			"first-key",
		);
		await rpcEntered.promise;
		const second = await resolveApproval(
			taskId,
			approval,
			"deny",
			"second-key",
		);

		expect(second.status).toBe(200);
		expect(((await second.json()) as { status: string }).status).toBe(
			"in_flight",
		);
		expect(rpcCount).toBe(1);
		release.resolve();
		expect(((await (await first).json()) as { status: string }).status).toBe(
			"resolved",
		);
		expect(rpcCount).toBe(1);
	});

	it("fails closed without replaying an expired approval RPC with an unknown outcome", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval stale claim reclaim");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, planRun, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
		);
		const resolutionKey = "stale-claim-key";
		const resolutionDigest = stableJsonHash({
			canonicalizer: "provider_approval_resolution",
			canonicalizerVersion: 1,
			taskId,
			approvalId: approval.id,
			workBlockId: approval.workBlockId,
			planRunId: planRun.id,
			resolutionKey,
			choice: "approve_once",
			resolveAll: false,
			note: null,
		});
		const receipt = await db.taskPlanProviderApprovalResolution.create({
			data: {
				workspaceId: ws.workspaceId,
				taskId,
				approvalId: approval.id,
				activeClaimKey: approval.id,
				providerRunId: providerRun.id,
				nodeAttemptId: approval.nodeAttemptId!,
				planRunId: planRun.id,
				resolutionKey,
				resolutionDigest,
				canonicalizer: "provider_approval_resolution",
				canonicalizerVersion: 1,
				status: "claimed",
				leaseOwner: "crashed-worker",
				leaseExpiresAt: new Date(Date.now() - 60_000),
			},
		});
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			return jsonProviderResponse({ resolved: 1 });
		});

		const response = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			resolutionKey,
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { status: string }).status).toBe(
			"failed",
		);
		expect(rpcCount).toBe(0);
		expect(
			await db.taskPlanProviderApprovalResolution.findUniqueOrThrow({
				where: { id: receipt.id },
			}),
		).toMatchObject({
			status: "failed",
			activeClaimKey: null,
			leaseOwner: null,
			leaseExpiresAt: null,
		});
	});

	it("replays same-key canonical result without another provider RPC", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval replay");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			return jsonProviderResponse({ resolved: 1 });
		});

		const first = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			"replay-key",
		);
		const second = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			"replay-key",
		);

		expect(((await first.json()) as { status: string }).status).toBe(
			"resolved",
		);
		expect(((await second.json()) as { status: string }).status).toBe(
			"resolved",
		);
		expect(rpcCount).toBe(1);
		const receipt =
			await db.taskPlanProviderApprovalResolution.findFirstOrThrow({
				where: { approvalId: approval.id },
			});
		expect(receipt.canonicalResult).not.toHaveProperty("planRunId");
		expect(receipt.canonicalResult).not.toHaveProperty("providerRunId");
		expect(receipt.canonicalResult).not.toHaveProperty("nodeAttemptId");
		expect(receipt.canonicalResult).not.toHaveProperty("runtimeRunRef");
	});

	it("rejects same-key different digest before provider RPC", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval digest conflict");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			return jsonProviderResponse({ resolved: 1 });
		});

		const first = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			"digest-key",
		);
		const second = await resolveApproval(
			taskId,
			approval,
			"deny",
			"digest-key",
		);

		expect(first.status).toBe(200);
		expect(second.status).toBe(409);
		expect(rpcCount).toBe(1);
	});

	it("does not call provider for obsolete approval scope", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval obsolete scope");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			return jsonProviderResponse({ resolved: 1 });
		});
		await db.executionSession.updateMany({
			where: { taskId, activeScopeKey: "active" },
			data: {
				status: "Abandoned",
				activeScopeKey: null,
				completedAt: new Date(),
			},
		});

		const response = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			"obsolete-key",
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { status: string }).status).toBe(
			"not_active",
		);
		expect(rpcCount).toBe(0);
		const updated = await db.taskPlanProviderApproval.findUniqueOrThrow({
			where: { id: approval.id },
		});
		expect(updated.status).toBe("pending");
	});

	it("fails closed when the persisted provider client configuration drifts", async () => {
		await seedHermesApprovalClient();
		if (!approvalClientIdentity)
			throw new Error("Expected approval client identity");
		const ws = await seedWorkspace("Approval client config drift");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval } = await seedPendingApproval(ws.workspaceId, taskId);
		await db.aiClient.update({
			where: { id: approvalClientIdentity.id },
			data: { config: { baseUrl: "https://different-provider.test" } },
		});
		await aiClientRegistry.refresh();
		let rpcCount = 0;
		setMockFetch(async () => {
			rpcCount += 1;
			return jsonProviderResponse({ resolved: 1 });
		});

		const response = await resolveApproval(
			taskId,
			approval,
			"approve_once",
			"config-drift-key",
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { status: string }).status).toBe(
			"failed",
		);
		expect(rpcCount).toBe(0);
	});

	it("resolves task-scoped null workBlock approvals", async () => {
		await seedHermesApprovalClient();
		const ws = await seedWorkspace("Approval task scoped");
		const { taskId } = await seedTask(ws.workspaceId);
		const { approval, providerRun } = await seedPendingApproval(
			ws.workspaceId,
			taskId,
			{ taskScoped: true },
		);
		setMockFetch(async () => jsonProviderResponse({ resolved: 1 }));

		const response = await resolveApproval(
			taskId,
			approval,
			"approve_session",
			"task-scope-key",
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as { status: string }).status).toBe(
			"resolved",
		);
		const [updatedApproval, updatedProviderRun] = await Promise.all([
			db.taskPlanProviderApproval.findUniqueOrThrow({
				where: { id: approval.id },
			}),
			db.taskPlanProviderRun.findUniqueOrThrow({
				where: { id: providerRun.id },
			}),
		]);
		expect(updatedApproval).toMatchObject({
			status: "approved",
			choice: "approve_session",
		});
		expect(updatedProviderRun.status).toBe("running");
	});
});
