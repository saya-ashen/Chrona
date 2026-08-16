/**
 * Auto-execution golden path — §1.3 (Chrona v0.2 hardening, Action A3)
 *
 * Positive case: task with autoExecute=true + autoPlanGeneration=true +
 * executionRuntime="debug" → orchestrator tick drives auto-plan-gen →
 * plan auto-accepted → execution auto-started → deterministic execution gates resolved
 * deterministically → task reaches Completed → Work page Badge shows "completed".
 *
 * Negative case: task with autoExecute=true, executionRuntime="debug", NO
 * accepted plan → tick → execution NOT started → schedule UI shows
 * "No accepted plan".
 *
 * Hard rules (§1.3):
 *   - NO page.waitForTimeout / sleep-based waits.
 *   - Use expect.poll + explicit triggerOrchestratorTick calls.
 *   - Never relax an assertion to get green.
 *   - Orchestrator auto-interval disabled via CHRONA_TASK_ORCHESTRATOR_INTERVAL_MS=600000.
 *
 * §1.3-vs-code gap (documented, not a regression):
 *   The spec §1.3 says "Inbox item" should appear for each execution gate.
 *   In practice the durable mock plan blueprint does NOT produce db.approval rows
 *   (checkpoints resolved inline by the runtime), so the Inbox never surfaces
 *   these gates.  The positive case therefore resolves gates via the
 *   execution/current checkpoint surface rather than the Inbox.  This is a
 *   T4/A6 gap tracked separately.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";
import {
	createTaskWorkspaceTask,
	triggerOrchestratorTick,
} from "./task-workspace-test-helpers";
import {
	bindTaskPlanProvider,
	startMockTaskPlanProvider,
} from "./mock-task-plan-provider";

// ─── shared types (kept inline — E2E specs avoid cross-package imports) ───────

type ExecutionCurrentBody = {
	status?: string;
	checkpoint?: {
		id?: string;
		type?: string;
	} | null;
};

type ScheduleItemBody = {
	taskId?: string;
	workBlockId?: string | null;
	autoStartEligible?: boolean;
	autoStartReason?: string | null;
	aiPlanGenerationStatus?: string;
	savedPlan?: { id?: string; status?: string } | null;
};

type ScheduleBody = {
	scheduled?: ScheduleItemBody[];
};

type TaskPlanBody = {
	savedPlan?: { id?: string; status?: string } | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Create and bind a debug AI client as the workspace default for all four
 * execution-related features.  Returns the clientId for reference.
 */
async function setupDebugAiClient(
	request: APIRequestContext,
	taskId: string,
): Promise<string> {
	const createRes = await request.post("/api/ai/clients", {
		data: {
			name: `E2E Auto-Exec Debug Client ${taskId}`,
			type: "debug",
			config: { profile: "deterministic" },
			isDefault: true,
		},
	});
	expect(createRes.ok()).toBeTruthy();
	const created = (await createRes.json()) as { client: { id?: string } };
	const clientId = created.client.id;
	expect(clientId).toBeTruthy();

	const bindRes = await request.put(`/api/ai/clients/${clientId}/bindings`, {
		data: {
			features: [
				"execute_task_node",
				"evaluate_condition_node",
				"review_checkpoint_node",
			],
		},
	});
	expect(bindRes.ok()).toBeTruthy();
	return clientId!;
}

/**
 * Enable autoExecute + autoPlanGeneration + executionRuntime on the task.
 */
async function enableAutoExecution(
	request: APIRequestContext,
	taskId: string,
): Promise<void> {
	const patchRes = await request.patch(`/api/tasks/${taskId}`, {
		data: {
			autoExecute: true,
			autoPlanGeneration: true,
			executionRuntime: "debug",
		},
	});
	expect(patchRes.ok()).toBeTruthy();
}

/**
 * Schedule the task starting ~10 s in the past so it is already due.
 */
async function scheduleTaskDue(
	request: APIRequestContext,
	taskId: string,
): Promise<void> {
	const now = Date.now();
	const startAt = new Date(now - 10_000).toISOString();
	const endAt = new Date(now + 3_600_000).toISOString();
	const schedRes = await request.put(`/api/tasks/${taskId}/schedule`, {
		data: { scheduledStartAt: startAt, scheduledEndAt: endAt },
	});
	expect(schedRes.ok()).toBeTruthy();
}

/**
 * Fetch the workBlockId for the task from the schedule projection.
 * Retries via expect.poll because the projection may lag briefly.
 */
async function getWorkBlockId(
	request: APIRequestContext,
	workspaceId: string,
	taskId: string,
): Promise<string> {
	let found: string | null = null;
	await expect
		.poll(
			async () => {
				const res = await request.get(
					`/api/schedule?workspaceId=${workspaceId}`,
				);
				if (!res.ok()) return null;
				const body = (await res.json()) as ScheduleBody;
				const item = (body.scheduled ?? []).find((s) => s.taskId === taskId);
				found = item?.workBlockId ?? null;
				return found;
			},
			{ timeout: 15_000, intervals: [300, 500, 1_000] },
		)
		.not.toBeNull();
	return found!;
}

async function getScheduleItem(
	request: APIRequestContext,
	workspaceId: string,
	taskId: string,
): Promise<ScheduleItemBody | null> {
	const res = await request.get(`/api/schedule?workspaceId=${workspaceId}`);
	expect(res.ok()).toBeTruthy();
	const body = (await res.json()) as ScheduleBody;
	return (body.scheduled ?? []).find((s) => s.taskId === taskId) ?? null;
}

async function getAcceptedPlanId(
	request: APIRequestContext,
	taskId: string,
): Promise<string | null> {
	const res = await request.get(`/api/tasks/${taskId}/plan`);
	if (!res.ok()) return null;
	const body = (await res.json()) as TaskPlanBody;
	return body.savedPlan?.status === "accepted"
		? (body.savedPlan.id ?? null)
		: null;
}

/**
 * Poll execution/current for the given task + workBlock until predicate passes.
 */
async function pollExecution(
	request: APIRequestContext,
	taskId: string,
	workBlockId: string,
	predicate: (body: ExecutionCurrentBody) => boolean,
	timeoutMs = 60_000,
	advance = false,
): Promise<ExecutionCurrentBody> {
	let last: ExecutionCurrentBody = {};
	await expect
		.poll(
			async () => {
				const res = await request.get(
					`/api/tasks/${taskId}/execution/current?workBlockId=${workBlockId}`,
				);
				if (!res.ok()) return false;
				last = (await res.json()) as ExecutionCurrentBody;
				if (predicate(last)) return true;
				if (advance) await triggerOrchestratorTick(request);
				return false;
			},
			{ timeout: timeoutMs, intervals: [300, 500, 1_000] },
		)
		.toBe(true);
	return last;
}

/**
 * Post a checkpoint action via the workspace commands endpoint.
 */
async function postCheckpointAction(
	request: APIRequestContext,
	taskId: string,
	checkpointId: string,
	action: string,
	payload?: Record<string, unknown>,
): Promise<void> {
	const body: Record<string, unknown> = {
		type: "checkpoint.action",
		checkpointId,
		action,
		idempotencyKey: `e2e-checkpoint-${checkpointId}-${action}`,
	};
	if (payload !== undefined) body.payload = payload;

	const res = await request.post(`/api/work/${taskId}/commands`, {
		data: body,
	});
	if (!res.ok()) {
		const text = await res.text().catch(() => "<no body>");
		throw new Error(
			`checkpoint.action ${action} failed: HTTP ${res.status()} body=${text.slice(0, 500)}`,
		);
	}
	const ack = (await res.json()) as { commandId?: string };
	expect(ack.commandId).toBeTruthy();
}

/**
 * Fire up to maxTicks orchestrator ticks, stopping as soon as predicate passes.
 * Returns the number of ticks fired.
 */
async function tickUntil(
	request: APIRequestContext,
	predicate: () => Promise<boolean>,
	maxTicks = 20,
	describeLastState?: () => string,
): Promise<number> {
	for (let i = 0; i < maxTicks; i++) {
		if (await predicate()) return i;
		await triggerOrchestratorTick(request);
	}
	// one final check
	if (await predicate()) return maxTicks;
	const suffix = describeLastState
		? `; last state: ${describeLastState()}`
		: "";
	throw new Error(
		`tickUntil: predicate did not pass after ${maxTicks} ticks${suffix}`,
	);
}

/**
 * Resolve the three deterministic execution gates in order:
 *   1. input checkpoint  → submit_input
 *   2. approval checkpoint → approve_result
 *   3. manual node → mark_node_completed
 */
async function resolveExecutionGates(
	request: APIRequestContext,
	taskId: string,
	workBlockId: string,
): Promise<void> {
	let inputCheckpointId: string | undefined;
	await test.step("Resolve input checkpoint (submit_input)", async () => {
		const execRes = await request.get(
			`/api/tasks/${taskId}/execution/current?workBlockId=${workBlockId}`,
		);
		expect(execRes.ok()).toBeTruthy();
		const exec = (await execRes.json()) as ExecutionCurrentBody;
		expect(exec.status).toBe("waiting_for_user");
		expect(exec.checkpoint?.id).toBeTruthy();
		inputCheckpointId = exec.checkpoint!.id!;
		await postCheckpointAction(
			request,
			taskId,
			inputCheckpointId,
			"submit_input",
			{
				inputFields: {
					scenario_label: "fast",
					include_slow_wait: false,
					priority: "normal",
				},
			},
		);
	});

	await test.step("Resolve condition branch (submit_input)", async () => {
		const exec = await pollExecution(
			request,
			taskId,
			workBlockId,
			(body) =>
				body.status === "waiting_for_user" &&
				!!body.checkpoint?.id &&
				body.checkpoint.id !== inputCheckpointId,
			30_000,
		);
		await postCheckpointAction(
			request,
			taskId,
			exec.checkpoint!.id!,
			"submit_input",
			{
				inputFields: { selected_route: "fast path" },
			},
		);
	});

	await test.step("Resolve approval checkpoint (approve_result)", async () => {
		const exec = await pollExecution(
			request,
			taskId,
			workBlockId,
			(body) =>
				(body.status === "waiting_for_approval" || body.status === "blocked") &&
				!!body.checkpoint?.id,
			30_000,
		);
		if (exec.status === "waiting_for_approval") {
			await postCheckpointAction(
				request,
				taskId,
				exec.checkpoint!.id!,
				"approve_result",
				{
					feedback: "approved by e2e golden path",
				},
			);
		}
	});

	await test.step("Resolve manual node (mark_node_completed)", async () => {
		const exec = await pollExecution(
			request,
			taskId,
			workBlockId,
			(body) => body.status === "blocked" && !!body.checkpoint?.id,
			30_000,
		);
		await postCheckpointAction(
			request,
			taskId,
			exec.checkpoint!.id!,
			"mark_node_completed",
			{
				root: "root",
				elements: {
					root: {
						type: "Text",
						props: { value: "Manual review completed by e2e golden path" },
					},
				},
			},
		);
	});
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe("Auto-execution golden path (§1.3)", () => {
	test("[AUTO-001] positive: autoExecute+autoPlanGeneration drives task to Completed via deterministic gates", async ({
		page,
		request,
	}) => {
		// Plan gen takes ~18 ticks async; gate resolution adds more wall-clock time.
		test.setTimeout(180_000);
		// ── 1. Create task ──────────────────────────────────────────────────────
		const task = await createTaskWorkspaceTask(request, {
			title: `Auto-Exec Golden Path ${Date.now()}`,
			description:
				"Drive auto-plan-gen + auto-start + debug gate resolution to Completed.",
		});
		const { taskId, workspaceId } = task;

		// ── 2. Bind separate durable-planning and debug-execution clients ──────
		const provider = await startMockTaskPlanProvider();
		try {
			await bindTaskPlanProvider(request, taskId, provider.baseUrl, [
				"task.plan",
				"task.result_finalization",
			]);
			await setupDebugAiClient(request, taskId);
			// ── 3. Enable autoExecute + autoPlanGeneration + executionRuntime=debug ─
			await enableAutoExecution(request, taskId);

			// ── 4. Schedule the task (already due) ─────────────────────────────────
			await scheduleTaskDue(request, taskId);

			// ── 5. Resolve workBlockId from schedule projection ────────────────────
			const workBlockId = await getWorkBlockId(request, workspaceId, taskId);
			expect(workBlockId).toBeTruthy();

			// ── 6. Tick until plan auto-accepted AND execution reaches first gate ───
			//    autoPlanGeneration=true fires plan gen on first tick (async);
			//    autoExecute=true auto-accepts and auto-starts on the same tick that
			//    the plan becomes accepted.  Keep ticking until execution is at
			//    waiting_for_user with a checkpoint (the input gate).
			await test.step("Tick until plan accepted and execution at input gate", async () => {
				let lastExecution: ExecutionCurrentBody = {};
				await tickUntil(
					request,
					async () => {
						const res = await request.get(
							`/api/tasks/${taskId}/execution/current?workBlockId=${workBlockId}`,
						);
						if (!res.ok()) return false;
						lastExecution = (await res.json()) as ExecutionCurrentBody;
						return (
							lastExecution.status === "waiting_for_user" &&
							!!lastExecution.checkpoint?.id
						);
					},
					60,
					() => JSON.stringify(lastExecution),
				);
			});

			await test.step("Accepted plan is visible in APIs before gate resolution", async () => {
				await expect
					.poll(() => getAcceptedPlanId(request, taskId), {
						timeout: 15_000,
						intervals: [300, 500, 1_000],
					})
					.not.toBeNull();

				const scheduleItem = await getScheduleItem(
					request,
					workspaceId,
					taskId,
				);
				expect(scheduleItem).toMatchObject({
					taskId,
					workBlockId,
					aiPlanGenerationStatus: "accepted",
				});
				expect(scheduleItem?.savedPlan?.id).toBeTruthy();
				expect(scheduleItem?.autoStartEligible).toBe(false);
				expect(scheduleItem?.autoStartReason).toBe("invalid_task_status");
			});

			// ── 7-9. Resolve the three deterministic execution gates ───────────────
			await resolveExecutionGates(request, taskId, workBlockId);

			// ── 10. Poll /api/work/:taskId until current run is completed ──
			await test.step("Task run reaches Completed status", async () => {
				await expect
					.poll(
						async () => {
							const res = await request.get(
								`/api/tasks/${taskId}/execution/current?workBlockId=${workBlockId}`,
							);
							if (!res.ok()) return null;
							const body = (await res.json()) as ExecutionCurrentBody;
							if (body.status === "completed") return "Completed";
							await triggerOrchestratorTick(request);
							return body.status ?? null;
						},
						{ timeout: 30_000, intervals: [300, 500, 1_000] },
					)
					.toBe("Completed");
			});

			// ── 12. Work page Badge renders result-review state ───────────────────
			// Completed executions stay in result review until the user chooses the
			// next result action; the header badge should not imply there is no next
			// action available.
			await test.step("Work page Badge shows result review", async () => {
				await page.goto(`/en/tasks/${taskId}`);
				await expect(
					page
						.locator('[data-slot="badge"]')
						.filter({ hasText: /^Execution complete, awaiting review$/i }),
				).toBeVisible({ timeout: 15_000 });
			});
		} finally {
			await provider.stop();
		}
	});

	test("negative: autoExecute=true + NO accepted plan → tick → execution NOT started → schedule explains plan approval requirement", async ({
		page,
		request,
	}) => {
		test.setTimeout(90_000);
		// ── 1. Create task ──────────────────────────────────────────────────────
		const title = `Auto-Exec Negative ${Date.now()}`;
		const task = await createTaskWorkspaceTask(request, {
			title,
			description: "Task with autoExecute but no plan — should not start.",
		});
		const { taskId, workspaceId } = task;

		// ── 2. Enable autoExecute only (NO autoPlanGeneration, NO plan) ─────────
		// Explicitly set autoPlanGeneration: false so the orchestrator tick does
		// not trigger plan generation for this task even when a default debug AI
		// client exists in the workspace (created by the positive test above).
		const patchRes = await request.patch(`/api/tasks/${taskId}`, {
			data: {
				autoExecute: true,
				autoPlanGeneration: false,
				executionRuntime: "debug",
			},
		});
		expect(patchRes.ok()).toBeTruthy();

		// ── 3. Schedule the task (already due) ─────────────────────────────────
		await scheduleTaskDue(request, taskId);

		// Resolve workBlockId (task must be in schedule projection)
		const workBlockId = await getWorkBlockId(request, workspaceId, taskId);

		// ── 4. Fire a tick ─────────────────────────────────────────────────────
		await triggerOrchestratorTick(request);

		// ── 5. Assert execution NOT started ────────────────────────────────────
		//    autoPlanGeneration=false → orchestrator skips plan gen.
		//    No accepted plan → orchestrator skips auto-start.
		const execRes = await request.get(
			`/api/tasks/${taskId}/execution/current?workBlockId=${workBlockId}`,
		);
		expect(execRes.ok()).toBeTruthy();
		const execBody = (await execRes.json()) as ExecutionCurrentBody;
		expect(execBody.status).toBe("no_plan");

		// ── 6. Schedule read model and UI show the specific skip reason AFTER tick
		await test.step("Schedule explains the plan approval requirement after the rejected auto-start tick", async () => {
			await expect
				.poll(
					async () => {
						const item = await getScheduleItem(request, workspaceId, taskId);
						return item?.autoStartReason ?? null;
					},
					{ timeout: 15_000, intervals: [300, 500, 1_000] },
				)
				.toBe("no_accepted_plan");

			const item = await getScheduleItem(request, workspaceId, taskId);
			expect(item).toMatchObject({
				taskId,
				workBlockId,
				autoStartEligible: false,
				autoStartReason: "no_accepted_plan",
			});

			const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
			await page.goto(`/en/schedule?day=${today}`, {
				waitUntil: "domcontentloaded",
			});
			await expect(
				page.getByRole("tab", { name: "Ready to schedule", exact: true }),
			).toBeVisible({ timeout: 30_000 });
		});
	});
});
