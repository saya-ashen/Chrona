import {
	expect,
	test,
	type APIRequestContext,
	type Locator,
	type Page,
} from "@playwright/test";
import {
	createTaskWorkspaceTask,
	dispatchWorkspaceCommand,
	generateTaskWorkspaceDraftPlan,
	generateTaskWorkspacePlan,
	setTaskWorkspaceViewport,
	triggerOrchestratorTick,
	type TaskWorkspaceViewport,
} from "./task-workspace-test-helpers";
import {
	bindTaskPlanProvider,
	startMockTaskPlanProvider,
} from "./mock-task-plan-provider";

const TASK_URL = (taskId: string) => `/en/tasks/${taskId}`;
const WORK_URL = TASK_URL;

async function expectDialogFocusContained(page: Page, dialog: Locator) {
	for (let index = 0; index < 8; index += 1) {
		await page.keyboard.press("Tab");
		await expect(dialog.locator(":focus")).toHaveCount(1);
	}
}

type ExecutionCurrentBody = {
	status?: string;
	currentNodeId?: string | null;
	checkpoint?: { id?: string; type?: string } | null;
	planOutput?: {
		manifest?: { sourceRevision?: number };
		finalizedResult?: {
			sourceRevision?: number;
			manifest?: { sourceRevision?: number };
		} | null;
		finalization?: { status?: string; sourceRevision?: number };
	};
};

async function expectNoHorizontalScroll(page: Page) {
	await expect
		.poll(async () =>
			page.evaluate(() => ({
				bodyOverflow: document.body.scrollWidth > window.innerWidth,
				documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
			})),
		)
		.toEqual({ bodyOverflow: false, documentOverflow: false });
}

function selectViewport(testInfo: {
	project: { name: string };
}): TaskWorkspaceViewport {
	return testInfo.project.name === "tablet" || testInfo.project.name === "mobile"
		? testInfo.project.name
		: "desktop";
}

async function dismissTaskEditorIfOpen(page: Page) {
	const editor = page.getByRole("dialog", { name: "Edit task" });
	if (await editor.isVisible().catch(() => false)) {
		await editor.getByRole("button", { name: "Close task editor" }).click();
		await expect(editor).not.toBeVisible();
	}
}

async function getCurrentExecution(
	request: APIRequestContext,
	taskId: string,
): Promise<ExecutionCurrentBody> {
	const response = await request.get(`/api/tasks/${taskId}/execution/current`);
	expect(response.ok()).toBeTruthy();
	return (await response.json()) as ExecutionCurrentBody;
}

/**
 * Bind the deterministic debug client only to execution-time features. Task
 * planning is owned by the durable feature runtime and uses a separate mock
 * provider in `generateTaskWorkspacePlan`.
 */
async function bindAllDebugFeatures(
	request: APIRequestContext,
	taskId: string,
	profile: "deterministic" | "tool-submit" = "deterministic",
): Promise<void> {
	const createRes = await request.post("/api/ai/clients", {
		data: {
			name: `E2E Lifecycle Debug Client ${taskId}`,
			type: "debug",
			config: { profile },
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
}

/** Poll execution/current until predicate passes, returning the matching body. */
async function pollExecution(
	request: APIRequestContext,
	taskId: string,
	predicate: (body: ExecutionCurrentBody) => boolean,
	timeoutMs = 40_000,
	advance = false,
): Promise<ExecutionCurrentBody> {
	let last: ExecutionCurrentBody = {};
	await expect
		.poll(
			async () => {
				last = await getCurrentExecution(request, taskId);
				if (predicate(last)) return true;
				if (advance) await triggerOrchestratorTick(request);
				return false;
			},
			{ timeout: timeoutMs, intervals: [300, 500, 1_000] },
		)
		.toBe(true);
	return last;
}

async function waitForCommandReceipt(
	request: APIRequestContext,
	taskId: string,
	commandKey: string,
): Promise<void> {
	await expect
		.poll(
			async () => {
				const response = await request.get(
					`/api/test/tasks/${taskId}/command-receipt`,
					{ params: { commandKey } },
				);
				if (response.status() === 404) return null;
				expect(response.ok()).toBeTruthy();
				const body = (await response.json()) as {
					receipt?: { status?: string };
				};
				return body.receipt?.status ?? null;
			},
			{ timeout: 40_000, intervals: [200, 500, 1_000] },
		)
		.toBe("completed");
}

/** Resolve a checkpoint via the workspace commands endpoint. */
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
 * Drive the three deterministic execution gates in order, asserting the exact
 * status at each one. The durable mock plan deterministically yields:
 *   input checkpoint (waiting_for_user)
 *     → approval checkpoint (waiting_for_approval)
 *     → manual node (blocked)  → Completed.
 */
async function resolveDebugPlanGates(
	request: APIRequestContext,
	taskId: string,
): Promise<void> {
	let inputCheckpointId: string | undefined;
	await test.step("Resolve input checkpoint (submit_input)", async () => {
		const exec = await pollExecution(
			request,
			taskId,
			(body) => body.status === "waiting_for_user" && !!body.checkpoint?.id,
		);
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
			(body) =>
				body.status === "waiting_for_user" &&
				!!body.checkpoint?.id &&
				body.checkpoint.id !== inputCheckpointId,
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
			(body) =>
				(body.status === "waiting_for_approval" || body.status === "blocked") &&
				!!body.checkpoint?.id,
			40_000,
		);
		if (exec.status === "waiting_for_approval") {
			await postCheckpointAction(
				request,
				taskId,
				exec.checkpoint!.id!,
				"approve_result",
				{
					feedback: "approved by e2e lifecycle",
				},
			);
		}
	});

	await test.step("Resolve manual node (mark_node_completed)", async () => {
		const exec = await pollExecution(
			request,
			taskId,
			(body) => body.status === "blocked" && !!body.checkpoint?.id,
			40_000,
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
						props: { value: "Manual review completed by e2e lifecycle" },
					},
				},
			},
		);
	});
}

test.describe("Task create → plan → run → result", () => {
	test("updates header actions after clicking Accept plan and Start without reload", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Focused live-refresh regression runs on desktop only.",
		);
		test.setTimeout(90_000);
		await setTaskWorkspaceViewport(page, "desktop");

		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Header Action Refresh ${Date.now()}`,
			description:
				"Verify header Accept plan and Start actions refresh without manual reload.",
		});
		await bindAllDebugFeatures(request, task.taskId);
		await generateTaskWorkspaceDraftPlan(request, task.taskId);

		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		await expect(
			page.getByRole("heading", { name: /E2E Header Action Refresh/ }),
		).toBeVisible();

		await page.getByRole("button", { name: /accept plan/i }).click();
		await expect(page.getByRole("button", { name: /^start$/i })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByRole("button", { name: /^start$/i })).toBeEnabled();

		await page.getByRole("button", { name: /^start$/i }).click();
		await expect
			.poll(async () => (await getCurrentExecution(request, task.taskId)).status, {
				timeout: 30_000,
				intervals: [300, 500, 1_000],
			})
			.not.toBe("started");

		await expect
			.poll(
				async () =>
					page
						.getByRole("button")
						.evaluateAll((buttons) =>
							buttons.map((button) => button.textContent?.trim()).filter(Boolean),
						),
				{ timeout: 20_000, intervals: [300, 500, 1_000] },
			)
			.toEqual(expect.arrayContaining([expect.stringMatching(/stop/i)]));
	});

	test("[RUN-020] restores active execution across navigation and reload", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Active execution recovery runs on desktop only.",
		);
		test.setTimeout(120_000);
		await setTaskWorkspaceViewport(page, "desktop");

		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Active Recovery ${Date.now()}`,
			description:
				"Keep the active checkpoint stable across navigation and reload.",
		});
		await bindAllDebugFeatures(request, task.taskId);
		await generateTaskWorkspacePlan(request, task.taskId);
		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
			timeout: 20_000,
		});

		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "start_manual",
			idempotencyKey: `run-020-start-${task.taskId}`,
		});
		await pollExecution(
			request,
			task.taskId,
			(body) => body.status === "waiting_for_user",
			40_000,
			true,
		);
		await page.reload();
		await dismissTaskEditorIfOpen(page);
		await expect(
			page.getByRole("tabpanel", { name: "Provide input" }).getByRole("textbox", {
				name: "Scenario label",
			}),
		).toBeVisible();

		await page.goto("/en/tasks");
		await expect(page.getByRole("main")).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(TASK_URL(task.taskId));
		await page.reload();
		await dismissTaskEditorIfOpen(page);

		const inputPanel = page.getByRole("tabpanel", { name: "Provide input" });
		await expect(
			inputPanel.getByRole("textbox", { name: "Scenario label" }),
		).toBeVisible();
		await expect(
			inputPanel.getByRole("button", { name: "Submit input" }),
		).toBeVisible();
		await expect(
			page.getByText("Input needed", { exact: true }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "Results" }).click();
		await expect(
			page.getByRole("button", {
				name: /^Open Agent transcript · [1-9]\d* events$/,
			}),
		).toBeVisible();
	});

	test("[ACTION-002/RUN-008/RESULT-012/GOAL-020] drives input, approval, result, Goal, and follow-up through visible controls", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Webwright-derived browser journey runs on desktop only.",
		);
		test.setTimeout(180_000);
		await setTaskWorkspaceViewport(page, "desktop");

		const taskTitle = `E2E Browser Golden Path ${Date.now()}`;
		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => consoleErrors.push(error.message));

		const taskId =
			await test.step("Create a task through the Tasks UI", async () => {
				await page.goto("/en/tasks");
				await page.getByRole("button", { name: "New Task" }).click();
				const dialog = page.getByRole("dialog", { name: "Add task" });
				await dialog.getByRole("textbox", { name: "Title" }).fill(taskTitle);
				await dialog.getByRole("radio", { name: /Save as task/ }).check();
				await dialog
					.getByRole("textbox", { name: "Add description" })
					.fill(
						"Generate, review, run, and accept a deterministic result through the Chrona workspace.",
					);
				const createResponsePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith("/api/tasks") &&
						response.request().method() === "POST",
				);
				await dialog.getByRole("button", { name: "Save", exact: true }).click();
				const createResponse = await createResponsePromise;
				expect(createResponse.ok()).toBeTruthy();
				const created = (await createResponse.json()) as { taskId?: string };
				expect(created.taskId).toBeTruthy();
				const createdTaskId = created.taskId!;
				const taskLink = page.locator(`a[href="/en/tasks/${createdTaskId}"]`);
				await expect(taskLink).toBeVisible();
				await taskLink.click();
				await expect(
					page.getByRole("heading", { name: taskTitle, level: 1 }).first(),
				).toBeVisible();
				return createdTaskId;
			});

		const provider = await startMockTaskPlanProvider();
		try {
			await test.step("Generate and accept a plan through the workspace UI", async () => {
				await bindTaskPlanProvider(request, taskId, provider.baseUrl, [
					"task.plan",
					"task.result_finalization",
				]);
				await bindAllDebugFeatures(request, taskId);
				await page.reload();

				await page.getByRole("button", { name: /^Generate plan$/ }).click();
				await expect(
					page.getByRole("heading", {
						name: "E2E durable execution plan",
					}),
				).toBeVisible({ timeout: 40_000 });
				await expect(
					page.getByText("Plan ready for review", { exact: true }),
				).toBeVisible();
				await page.getByRole("button", { name: "Accept", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "Start", exact: true }),
				).toBeEnabled();
				await expect(
					page.getByRole("region", { name: "Accepted plan" }),
				).toBeVisible();
			});

			await test.step("Run and resolve every visible execution gate", async () => {
				await page.getByRole("button", { name: "Start", exact: true }).click();
				let inputPanel = page.getByRole("tabpanel", { name: "Provide input" });
				await expect(
					inputPanel.getByRole("textbox", { name: "Scenario label" }),
				).toBeVisible({ timeout: 30_000 });
				await expect
					.poll(async () => (await getCurrentExecution(request, taskId)).status)
					.toBe("waiting_for_user");
				await page.goto("/en/action-center");
				await expect(page.getByRole("main")).toBeVisible();
				await expect(
					page.getByRole("heading", { name: taskTitle, level: 3 }),
				).toBeVisible();
				const taskActionCard = page
					.getByRole("heading", { name: taskTitle, level: 3 })
					.locator("xpath=../../..");
				const openTaskLink = taskActionCard.getByRole("link", {
					name: "Open Task",
				});
				await expect(openTaskLink).toHaveAttribute(
					"href",
					new RegExp(`^/en/tasks/${taskId}\\?workBlockId=.+$`),
				);
				await openTaskLink.click();
				await expect(page).toHaveURL(
					new RegExp(`/en/tasks/${taskId}\\?workBlockId=.+$`),
				);
				inputPanel = page.getByRole("tabpanel", { name: "Provide input" });
				await expect(
					inputPanel.getByRole("textbox", { name: "Scenario label" }),
				).toBeVisible();

				await inputPanel
					.getByRole("textbox", { name: "Scenario label" })
					.fill("fast");
				await inputPanel
					.getByRole("textbox", { name: "Include slow wait path" })
					.fill("false");
				await inputPanel.getByRole("combobox").click();
				await page.getByRole("option", { name: "normal", exact: true }).click();
				await inputPanel.getByRole("button", { name: "Submit input" }).click();

				inputPanel = page.getByRole("tabpanel", { name: "Provide input" });
				await expect(
					inputPanel.getByRole("textbox", { name: "Submit input" }),
				).toBeVisible({ timeout: 30_000 });
				await expect
					.poll(async () => (await getCurrentExecution(request, taskId)).status)
					.toBe("waiting_for_user");
				await inputPanel
					.getByRole("textbox", { name: "Submit input" })
					.fill("fast path");
				await inputPanel.getByRole("button", { name: "Submit input" }).click();

				await expect(
					page.getByRole("button", { name: "Approve result" }),
				).toBeVisible({ timeout: 30_000 });
				await expect
					.poll(async () => (await getCurrentExecution(request, taskId)).status)
					.toBe("waiting_for_approval");

				await page.goto("/en/action-center");
				const approvalHeading = page.getByRole("heading", {
					name: taskTitle,
					level: 3,
				});
				await expect(approvalHeading).toBeVisible({ timeout: 20_000 });
				const approvalCard = approvalHeading.locator("xpath=../../..");
				const approvalResponsePromise = page.waitForResponse(
					(response) =>
						response.url().includes(`/api/work/${taskId}/commands`) &&
						response.request().method() === "POST" &&
						response.request().postData()?.includes('"resume_with_approval"') ===
							true,
				);
				await approvalCard
					.getByRole("button", { name: "Approve", exact: true })
					.click();
				expect((await approvalResponsePromise).ok()).toBeTruthy();
				await expect(approvalHeading).toHaveCount(0);

				await page.goto(TASK_URL(taskId));
				await dismissTaskEditorIfOpen(page);
				const manualResult = page.getByRole("textbox", {
					name: "Mark completed",
				});
				await expect(manualResult).toBeVisible({ timeout: 30_000 });
				await expect
					.poll(async () => (await getCurrentExecution(request, taskId)).status)
					.toBe("blocked");
				await manualResult.fill("Manual review completed by browser E2E");
				await page.getByRole("button", { name: "Mark completed" }).click();

				await expect(
					page.getByRole("heading", {
						name: "Execution complete, awaiting review",
					}),
				).toBeVisible({ timeout: 40_000 });
				await expect(
					page.getByRole("button", { name: "Accept result" }),
				).toBeVisible();
				const completed = await getCurrentExecution(request, taskId);
				expect(completed.planOutput).toMatchObject({
					manifest: { sourceRevision: expect.any(Number) },
					finalizedResult: {
						sourceRevision: expect.any(Number),
						manifest: { sourceRevision: expect.any(Number) },
					},
					finalization: {
						status: "Ready",
						sourceRevision: expect.any(Number),
					},
				});
				const sourceRevision = completed.planOutput!.manifest!.sourceRevision;
				expect(completed.planOutput!.finalizedResult!.sourceRevision).toBe(
					sourceRevision,
				);
				expect(
					completed.planOutput!.finalizedResult!.manifest!.sourceRevision,
				).toBe(sourceRevision);
				expect(completed.planOutput!.finalization!.sourceRevision).toBe(
					sourceRevision,
				);

				await page.goto("/en/action-center");
				const completedHeading = page.getByRole("heading", {
					name: taskTitle,
					level: 3,
				});
				await expect(completedHeading).toBeVisible({ timeout: 20_000 });
				const completedCard = completedHeading.locator("xpath=../../..");
				const reviewResults = completedCard.getByRole("link", {
					name: "Review results",
				});
				await expect(reviewResults).toHaveAttribute(
					"href",
					new RegExp(`^/en/tasks/${taskId}\\?workBlockId=.+$`),
				);
				await reviewResults.click();
				await expect(page).toHaveURL(
					new RegExp(`/en/tasks/${taskId}\\?workBlockId=.+$`),
				);
				await expect(
					page.getByRole("heading", {
						name: "Execution complete, awaiting review",
					}),
				).toBeVisible();
			});

			let acceptedRunId: string | undefined;
			await test.step("Accept the final result through the workspace UI", async () => {
				const acceptResponsePromise = page.waitForResponse(
					(response) =>
						response.url().includes(`/api/tasks/${taskId}/result/accept`) &&
						response.request().method() === "POST",
				);
				await page.getByRole("button", { name: "Accept result" }).click();
				const acceptDialog = page.getByRole("dialog", {
					name: "Confirm result acceptance",
				});
				await expect(acceptDialog).toBeVisible();
				await expectDialogFocusContained(page, acceptDialog);
				await acceptDialog
					.getByRole("button", { name: "Confirm acceptance" })
					.click();
				const acceptResponse = await acceptResponsePromise;
				expect(acceptResponse.ok()).toBeTruthy();
				const accepted = (await acceptResponse.json()) as { runId?: string };
				expect(accepted.runId).toBeTruthy();
				acceptedRunId = accepted.runId;
				await expect(
					page.getByRole("heading", { name: "Result accepted" }),
				).toBeVisible();
				expect((await getCurrentExecution(request, taskId)).status).toBe(
					"completed",
				);
			});

			const goalId =
				await test.step("Promote the accepted result to a Goal", async () => {
					const artifactResponse = await request.post(
						`/api/test/tasks/${taskId}/artifact`,
					);
					expect(artifactResponse.ok()).toBeTruthy();
					const seeded = (await artifactResponse.json()) as {
						artifact?: { id?: string; title?: string; runId?: string };
					};
					expect(seeded.artifact?.id).toBeTruthy();
					expect(seeded.artifact?.runId).toBe(acceptedRunId);
					await page.reload();
					const promoteButton = page.getByRole("button", {
						name: "Create Goal and continue",
					});
					await expect(promoteButton).toBeVisible();
					await promoteButton.click();
					const promotionDialog = page.getByRole("dialog", {
						name: "Continue this result as a Goal",
					});
					await expect(promotionDialog).toBeVisible();
					await expect(promotionDialog.getByRole("checkbox")).toBeChecked();
					if (seeded.artifact?.title) {
						await expect(
							promotionDialog.getByText(seeded.artifact.title, { exact: true }),
						).toBeVisible();
					}
					const promotionResponsePromise = page.waitForResponse(
						(response) =>
							response
								.url()
								.includes(`/api/tasks/${taskId}/actions/promote-to-goal`) &&
							response.request().method() === "POST",
					);
					await expectDialogFocusContained(page, promotionDialog);
					await promotionDialog
						.getByRole("button", { name: "Create Goal and continue" })
						.click();
					const promotionResponse = await promotionResponsePromise;
					expect(promotionResponse.ok()).toBeTruthy();
					const goal = (await promotionResponse.json()) as { id?: string };
					expect(goal.id).toBeTruthy();
					await page.waitForURL(`/en/goals/${goal.id}`);
					await expect(
						page.getByRole("heading", { name: taskTitle, level: 1 }),
					).toBeVisible();
					return goal.id!;
				});

			await test.step("Create a follow-up task from the Goal", async () => {
				const primaryAddTask = page
					.getByRole("button", { name: "Add task" })
					.first();
				if (await primaryAddTask.isVisible().catch(() => false)) {
					await primaryAddTask.click();
				} else {
					await page.getByRole("button", { name: "Goal actions" }).click();
					await page.getByRole("menuitem", { name: "Add task" }).click();
				}
				const taskDialog = page.getByRole("dialog", {
					name: "Add bounded task",
				});
				await expect(taskDialog).toBeVisible();
				const followUpTitle = `E2E Goal Follow-up ${Date.now()}`;
				await taskDialog
					.getByRole("textbox", { name: "Task title" })
					.fill(followUpTitle);
				await taskDialog
					.getByRole("textbox", { name: "Task instructions" })
					.fill("Continue the accepted result with bounded follow-up work.");
				await taskDialog
					.getByRole("textbox", { name: "Expected outcome" })
					.fill("A concrete next action linked to the promoted Goal.");
				const taskResponsePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith(`/api/goals/${goalId}/tasks`) &&
						response.request().method() === "POST",
				);
				await taskDialog.getByRole("button", { name: "Create task" }).click();
				const taskResponse = await taskResponsePromise;
				expect(taskResponse.ok()).toBeTruthy();
				const followUp = (await taskResponse.json()) as { taskId?: string };
				expect(followUp.taskId).toBeTruthy();
				await page.waitForURL(`/en/tasks/${followUp.taskId}`);
				await expect(
					page.getByRole("heading", { name: followUpTitle, level: 1 }).first(),
				).toBeVisible();
			});
		} finally {
			await provider.stop();
		}

		expect(consoleErrors).toEqual([]);
	});

	test("drives the full lifecycle from creation through accepted result", async ({
		page,
		request,
	}, testInfo) => {
		// Plan generation + three-gate manual resolution is deterministic but
		// spans several engine round-trips.
		test.setTimeout(180_000);
		const viewport = selectViewport(testInfo);
		await setTaskWorkspaceViewport(page, viewport);

		// 1. Create a task and open the workspace; assert the empty-graph state.
		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Lifecycle ${viewport} ${Date.now()}`,
			description:
				"Drive a task through plan generation, accept, start, and accept result.",
		});
		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => consoleErrors.push(error.message));
		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		await expect(
			page.getByRole("heading", {
				name: new RegExp(`E2E Lifecycle ${viewport}`),
			}),
		).toBeVisible();
		await expect(page.getByTestId("plan-setup-panel")).toBeVisible();
		const connectProvider = page.getByRole("link", {
			name: /^Connect AI provider$/,
		});
		const hasConfiguredProvider = await connectProvider
			.isVisible()
			.catch(() => false);
		if (hasConfiguredProvider) {
			await expect(connectProvider).toBeVisible();
		} else {
			await expect(
				page.getByRole("button", { name: /^Generate plan$/ }),
			).toBeVisible();
		}
		await expect(
			page.getByText(/Nothing runs until the plan is reviewed and accepted/i),
		).toBeVisible();

		// Before any plan exists the engine reports exactly `no_plan`.
		expect((await getCurrentExecution(request, task.taskId)).status).toBe(
			"no_plan",
		);

		// 2. Bind the debug execution features, then generate + accept a durable plan.
		const finalizationProvider =
			await test.step("Configure execution and planning clients and accept a plan", async () => {
				await bindAllDebugFeatures(request, task.taskId);
				await page.reload();
				await dismissTaskEditorIfOpen(page);
				await expect(
					page.getByRole("button", { name: /^Generate plan$/ }),
				).toBeVisible();
				await generateTaskWorkspacePlan(request, task.taskId);
				const provider = await startMockTaskPlanProvider();
				try {
					await bindTaskPlanProvider(request, task.taskId, provider.baseUrl, [
						"task.result_finalization",
					]);
					return provider;
				} catch (error) {
					await provider.stop();
					throw error;
				}
			});
		try {
			// 3. The accepted-plan workspace appears; engine moves to the pre-start
			//    `started` state (accepted plan, no execution session yet).
			await page.reload();
			await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
				timeout: 20_000,
			});
			await expect
				.poll(
					async () => (await getCurrentExecution(request, task.taskId)).status,
					{ timeout: 10_000 },
				)
				.toBe("started");

			// 4. Start execution manually and drive the three debug gates to
			//    Completed, asserting each exact intermediate status along the way.
			await test.step("Start execution and resolve gates to Completed", async () => {
				const ack = await dispatchWorkspaceCommand(request, task.taskId, {
					type: "execution.action",
					action: "start_manual",
					prompt: "Run the durable plan end-to-end.",
					idempotencyKey: `e2e-start-${task.taskId}`,
				});
				expect(ack.commandId).toBeTruthy();
				await expect(
					page.getByRole("tabpanel", { name: "Provide input" }),
				).toBeVisible({ timeout: 30_000 });
				await expect(
					page.getByRole("textbox", { name: "Scenario label" }),
				).toBeVisible();

				await resolveDebugPlanGates(request, task.taskId);

				await expect
					.poll(
						async () => {
							const current = await getCurrentExecution(request, task.taskId);
							if (current.status === "completed") return "Completed";
							await triggerOrchestratorTick(request);
							return current.status ?? null;
						},
						{ timeout: 30_000, intervals: [300, 500, 1_000] },
					)
					.toBe("Completed");
			});

			// 5. The Work page shows result-review state and exposes explicit product-owned
			//    result acceptance. Acceptance updates review state without changing the
			//    completed execution lifecycle.
			await test.step("Accept the result through the workspace UI", async () => {
				const beforeBody = await getCurrentExecution(request, task.taskId);
				expect(beforeBody.status).toBe("completed");

				await page.goto(WORK_URL(task.taskId));
				await dismissTaskEditorIfOpen(page);
				await expect(
					page.locator('[data-slot="badge"]').filter({
						hasText: /^Execution complete, awaiting review$/i,
					}),
				).toBeVisible({ timeout: 15_000 });
				await expect(
					page.getByRole("button", { name: /^Accept result$/ }),
				).toBeVisible();

				const acceptResponse = page.waitForResponse(
					(response) =>
						response.url().includes(`/api/tasks/${task.taskId}/result/accept`) &&
						response.request().method() === "POST",
				);
				await page.getByRole("button", { name: /^Accept result$/ }).click();
				const acceptDialog = page.getByRole("dialog", {
					name: "Confirm result acceptance",
				});
				await expect(acceptDialog).toBeVisible();
				await expectDialogFocusContained(page, acceptDialog);
				await acceptDialog
					.getByRole("button", { name: "Confirm acceptance" })
					.click();
				const response = await acceptResponse;
				expect(response.ok()).toBeTruthy();
				const acceptBody = (await response.json()) as {
					taskId?: string;
					runId?: string;
				};
				expect(acceptBody.taskId).toBe(task.taskId);
				expect(acceptBody.runId).toBeTruthy();
				await expect(
					page
						.locator('[data-slot="badge"]')
						.filter({ hasText: /^Result accepted$/ }),
				).toBeVisible({
					timeout: 15_000,
				});
				await expect(
					page.locator('[data-slot="badge"]').filter({
						hasText: /^(Execution complete, awaiting review|Waiting)$/,
					}),
				).toHaveCount(0);

				await page.goto(WORK_URL(task.taskId));
				await dismissTaskEditorIfOpen(page);
				await expect(
					page.getByRole("heading", { name: "Result accepted" }),
				).toBeVisible({
					timeout: 15_000,
				});
				expect((await getCurrentExecution(request, task.taskId)).status).toBe(
					"completed",
				);
				const artifactResponse = await request.post(
					`/api/test/tasks/${task.taskId}/artifact`,
				);
				expect(artifactResponse.ok()).toBeTruthy();
				const seededArtifact = (await artifactResponse.json()) as {
					artifact?: { id?: string; runId?: string };
				};
				expect(seededArtifact.artifact).toMatchObject({
					id: expect.any(String),
					runId: acceptBody.runId,
				});
				const reviewResponse = await request.get(
					`/api/tasks/${task.taskId}/review-context`,
				);
				expect(reviewResponse.ok()).toBeTruthy();
				const reviewContext = (await reviewResponse.json()) as {
					resultReview?: { status?: string; runId?: string } | null;
					artifacts?: Array<{ id: string; title: string }>;
				};
				expect(reviewContext.resultReview).toMatchObject({
					status: "accepted",
					runId: acceptBody.runId,
				});
				expect(reviewContext.artifacts?.length ?? 0).toBeGreaterThan(0);
				await page.reload();
				await dismissTaskEditorIfOpen(page);
				await expect(
					page.getByRole("button", { name: "Create Goal and continue" }),
				).toBeVisible();
				await page
					.getByRole("button", { name: "Create Goal and continue" })
					.click();
				const promotionDialog = page.getByRole("dialog", {
					name: "Continue this result as a Goal",
				});
				await expect(promotionDialog).toBeVisible();
				await expectDialogFocusContained(page, promotionDialog);
				await promotionDialog
					.getByRole("button", { name: "Create Goal and continue" })
					.click();
				await expect(page).toHaveURL(/\/en\/goals\/[^/]+$/);

				const promoteResponse = await request.post(
					`/api/tasks/${task.taskId}/actions/promote-to-goal`,
					{
						data: {
							workspaceId: task.workspaceId,
							acceptedRunId: acceptBody.runId,
							artifactIds: [seededArtifact.artifact!.id],
							title: `Promoted ${task.taskId}`,
							description: "Promoted deterministic lifecycle result.",
							successCriteria: [
								{
									id: "outcome-confirmed",
									kind: "user_confirmed",
									description: "The deterministic lifecycle result is retained.",
									satisfied: false,
									confirmedAt: null,
									proposalStatus: "proposed",
								},
							],
							idempotencyKey: `promote-${task.taskId}-${acceptBody.runId}`,
						},
					},
				);
				expect(promoteResponse.status()).toBe(201);
				const promoted = (await promoteResponse.json()) as {
					id?: string;
					tasks?: Array<{ id?: string }>;
				};
				expect(promoted.id).toBeTruthy();
				expect(
					promoted.tasks?.some((goalTask) => goalTask.id === task.taskId),
				).toBe(true);
				const promotedGoalResponse = await request.get(`/api/goals/${promoted.id}`);
				expect(promotedGoalResponse.ok()).toBeTruthy();
				const promotedGoal = (await promotedGoalResponse.json()) as {
					assets?: Array<{ provenance?: { sourceArtifactId?: string } }>;
				};
				expect(
					promotedGoal.assets?.some(
						(asset) =>
							asset.provenance?.sourceArtifactId === seededArtifact.artifact!.id,
					),
				).toBe(true);
				expect(consoleErrors).toEqual([]);
				const replayResponse = await request.post(
					`/api/tasks/${task.taskId}/actions/promote-to-goal`,
					{
						data: {
							workspaceId: task.workspaceId,
							acceptedRunId: acceptBody.runId,
							artifactIds: [seededArtifact.artifact!.id],
							title: `Promoted ${task.taskId}`,
							description: "Promoted deterministic lifecycle result.",
							successCriteria: [
								{
									id: "outcome-confirmed",
									kind: "user_confirmed",
									description: "The deterministic lifecycle result is retained.",
									satisfied: false,
									confirmedAt: null,
									proposalStatus: "proposed",
								},
							],
							idempotencyKey: `promote-${task.taskId}-${acceptBody.runId}`,
						},
					},
				);
				expect(replayResponse.status()).toBe(201);
				expect(((await replayResponse.json()) as { id?: string }).id).toBe(
					promoted.id,
				);
			});

			if (viewport === "mobile") {
				await expectNoHorizontalScroll(page);
			}
		} finally {
			await finalizationProvider.stop();
		}
	});

	test("[RESULT-002] retries finalization without rerunning the Plan", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Focused result-finalization retry runs on desktop only.",
		);
		test.setTimeout(120_000);

		await bindTaskPlanProvider(
			request,
			"result-finalization-failure",
			"http://127.0.0.1:1",
			["task.result_finalization"],
			true,
		);
		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Finalization Retry ${Date.now()}`,
			description: "Retry only final result composition after provider failure.",
		});
		await bindAllDebugFeatures(request, task.taskId);
		await generateTaskWorkspacePlan(request, task.taskId);
		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "start_manual",
			prompt: "Complete execution before finalization retry.",
			idempotencyKey: `finalization-start-${task.taskId}`,
		});
		await resolveDebugPlanGates(request, task.taskId);
		const failed = await pollExecution(
			request,
			task.taskId,
			(body) =>
				body.status === "completed" &&
				body.planOutput?.finalization?.status === "Failed",
		);
		const sourceRevision = failed.planOutput!.manifest!.sourceRevision;
		expect(sourceRevision).toEqual(expect.any(Number));

		const provider = await startMockTaskPlanProvider();
		try {
			await bindTaskPlanProvider(request, task.taskId, provider.baseUrl, [
				"task.result_finalization",
			]);
			await page.goto(TASK_URL(task.taskId));
			await dismissTaskEditorIfOpen(page);
			await expect(
				page.getByRole("heading", { name: "Final result unavailable" }),
			).toBeVisible({ timeout: 20_000 });
			const retryResponsePromise = page.waitForResponse(
				(response) =>
					response
						.url()
						.includes(`/api/tasks/${task.taskId}/result/finalization/retry`) &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Retry finalization" }).click();
			expect((await retryResponsePromise).ok()).toBeTruthy();

			const ready = await pollExecution(
				request,
				task.taskId,
				(body) => body.planOutput?.finalization?.status === "Ready",
			);
			expect(ready.status).toBe("completed");
			expect(ready.currentNodeId).toBeNull();
			expect(ready.planOutput?.manifest?.sourceRevision).toBe(sourceRevision);
			expect(ready.planOutput?.finalizedResult?.sourceRevision).toBe(
				sourceRevision,
			);
			await expect(
				page.getByRole("button", { name: "Accept result" }),
			).toBeVisible({ timeout: 20_000 });
		} finally {
			await provider.stop();
		}
	});

	test("[RUN-014/ACTION-008] recovers a failed run from Action Center", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Focused provider-failure regression runs on desktop only.",
		);
		test.setTimeout(120_000);

		await bindTaskPlanProvider(
			request,
			"run-014-provider-failure",
			"http://127.0.0.1:1",
			["execute_task_node", "evaluate_condition_node", "review_checkpoint_node"],
			true,
		);
		const taskTitle = `E2E Provider Failure ${Date.now()}`;
		const task = await createTaskWorkspaceTask(request, {
			title: taskTitle,
			description: "Expose a deterministic provider failure in the workspace.",
		});
		await generateTaskWorkspacePlan(request, task.taskId);
		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "start_manual",
			prompt: "Start the provider-failure regression.",
			idempotencyKey: `failure-start-${task.taskId}`,
		});
		const firstPause = await pollExecution(
			request,
			task.taskId,
			(body) => body.status === "waiting_for_user" && Boolean(body.checkpoint?.id),
		);
		await postCheckpointAction(
			request,
			task.taskId,
			firstPause.checkpoint!.id!,
			"submit_input",
			{
				inputFields: {
					scenario_label: "fast",
					include_slow_wait: false,
					priority: "normal",
				},
			},
		);
		const branchPause = await pollExecution(
			request,
			task.taskId,
			(body) =>
				body.status === "waiting_for_user" &&
				body.checkpoint?.id !== firstPause.checkpoint?.id,
		);
		await postCheckpointAction(
			request,
			task.taskId,
			branchPause.checkpoint!.id!,
			"submit_input",
			{ inputFields: { selected_route: "fast path" } },
		);
		const failed = await pollExecution(
			request,
			task.taskId,
			(body) =>
				(body.status === "failed" || body.status === "blocked") &&
				body.currentNodeId !== firstPause.currentNodeId,
		);
		expect(failed.currentNodeId).toBeTruthy();

		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		const operation = page.getByRole("region", { name: "Current operation" });
		await expect(operation).toContainText("Failed", { timeout: 20_000 });
		await expect(operation).toContainText(
			/Failed to execute AI capability.*Unable to connect/i,
		);
		await expect(
			page.getByText("Execute deterministic work").first(),
		).toBeVisible();
		await expect(
			operation.getByRole("button", { name: /Retry (Run|node)/i }),
		).toBeVisible();

		await bindAllDebugFeatures(request, task.taskId);
		await page.goto("/en/action-center");
		const failedHeading = page.getByRole("heading", {
			name: taskTitle,
			level: 3,
		});
		await expect(failedHeading).toBeVisible({ timeout: 20_000 });
		const failedCard = failedHeading.locator("xpath=../../..");
		const recoverResponsePromise = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/work/${task.taskId}/commands`) &&
				response.request().method() === "POST" &&
				response.request().postData()?.includes('"retry_node"') === true,
		);
		await failedCard.getByRole("button", { name: /Recover run|Retry/i }).click();
		const recoverResponse = await recoverResponsePromise;
		expect(recoverResponse.ok()).toBeTruthy();
		expect(await recoverResponse.json()).toMatchObject({
			commandId: expect.any(String),
		});
		await expect(failedHeading).toHaveCount(0);
		await expect
			.poll(async () => (await getCurrentExecution(request, task.taskId)).status)
			.not.toBe("failed");
	});

	test("[RUN-012/RUN-015] keeps pause, resume, retry, and stop projections stable", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Focused execution-control regression runs on desktop only.",
		);
		test.setTimeout(120_000);

		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Execution Controls ${Date.now()}`,
			description:
				"Verify pause, resume, retry, and stop settle in durable projections.",
		});
		await bindAllDebugFeatures(request, task.taskId);
		await generateTaskWorkspacePlan(request, task.taskId);

		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "start_manual",
			prompt: "Start the execution-control regression.",
			idempotencyKey: `controls-start-${task.taskId}`,
		});
		const firstPause = await pollExecution(
			request,
			task.taskId,
			(body) => body.status === "waiting_for_user" && Boolean(body.checkpoint?.id),
		);
		const firstCheckpointId = firstPause.checkpoint!.id!;
		const firstNodeId = firstPause.currentNodeId;
		expect(firstNodeId).toBeTruthy();

		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "pause_session",
			reason: "Explicit E2E pause.",
			idempotencyKey: `controls-pause-${task.taskId}`,
		});
		await expect
			.poll(async () => getCurrentExecution(request, task.taskId))
			.toMatchObject({
				status: "waiting_for_user",
				currentNodeId: firstNodeId,
				checkpoint: { id: firstCheckpointId },
			});

		await postCheckpointAction(
			request,
			task.taskId,
			firstCheckpointId,
			"submit_input",
			{
				inputFields: {
					scenario_label: "fast",
					include_slow_wait: false,
					priority: "normal",
				},
			},
		);
		const branchPause = await pollExecution(
			request,
			task.taskId,
			(body) =>
				body.status === "waiting_for_user" &&
				body.checkpoint?.id !== firstCheckpointId,
		);
		await postCheckpointAction(
			request,
			task.taskId,
			branchPause.checkpoint!.id!,
			"submit_input",
			{
				inputFields: {
					selected_route: "fast path",
				},
			},
		);
		const resumed = await pollExecution(
			request,
			task.taskId,
			(body) =>
				(body.status === "waiting_for_approval" || body.status === "blocked") &&
				body.currentNodeId !== firstNodeId,
		);
		expect(resumed.currentNodeId).not.toBe(firstNodeId);
		expect(resumed.currentNodeId).toBeTruthy();

		await postCheckpointAction(
			request,
			task.taskId,
			resumed.checkpoint!.id!,
			"approve_result",
			{ feedback: "Approve before testing blocked-node retry." },
		);
		const blocked = await pollExecution(
			request,
			task.taskId,
			(body) => body.status === "blocked" && body.currentNodeId !== firstNodeId,
		);

		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		const retryNode = page.getByRole("button", { name: "Retry node" });
		await expect(retryNode).toBeVisible({ timeout: 20_000 });
		const retryResponsePromise = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/work/${task.taskId}/commands`) &&
				response.request().method() === "POST" &&
				response.request().postData()?.includes('"action":"retry_node"') === true,
		);
		await retryNode.click();
		const retryResponse = await retryResponsePromise;
		expect(retryResponse.ok()).toBeTruthy();
		await pollExecution(
			request,
			task.taskId,
			(body) =>
				body.status === "blocked" && body.currentNodeId === blocked.currentNodeId,
		);

		const cancelCommandKey = `controls-stop-${task.taskId}`;
		await dispatchWorkspaceCommand(request, task.taskId, {
			type: "execution.action",
			action: "cancel_session",
			reason: "Stop after retry.",
			idempotencyKey: cancelCommandKey,
		});
		await waitForCommandReceipt(request, task.taskId, cancelCommandKey);
		await expect
			.poll(async () => (await getCurrentExecution(request, task.taskId)).status)
			.toBe("cancelled");
		expect((await getCurrentExecution(request, task.taskId)).status).toBe(
			"cancelled",
		);
		const taskResponse = await request.get(`/api/tasks/${task.taskId}`);
		expect(taskResponse.ok()).toBeTruthy();
		expect(
			(await taskResponse.json()) as { task?: { status?: string } },
		).toMatchObject({
			task: { status: "Cancelled" },
		});
	});

	test("[WORK-003/CROSS-007] preserves canonical plan across deep link, reload, back, and forward", async ({
		page,
		request,
	}) => {
		await setTaskWorkspaceViewport(page, "desktop");

		const task = await createTaskWorkspaceTask(request, {
			title: `E2E Plan Persistence ${Date.now()}`,
			description:
				"Generate a plan, navigate away, come back — plan + accepted status must persist.",
		});
		await generateTaskWorkspacePlan(request, task.taskId);

		// First navigation — confirm the accepted-plan workspace renders and the
		// plan is accepted server-side.
		await page.goto(TASK_URL(task.taskId));
		await dismissTaskEditorIfOpen(page);
		await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
			timeout: 20_000,
		});
		const firstResponse = await request.get(`/api/tasks/${task.taskId}/plan`);
		expect(firstResponse.ok()).toBeTruthy();
		const firstBody = (await firstResponse.json()) as {
			savedPlan?: { id?: string; status?: string } | null;
		};
		expect(firstBody.savedPlan?.id).toBeTruthy();
		expect(firstBody.savedPlan?.status).toBe("accepted");

		// Navigate away to the task list, then back. The accepted plan must still
		// render — proves the workspace re-hydrates from the REST snapshot
		// when the SSE connection is severed and re-established.
		await page.reload();
		await dismissTaskEditorIfOpen(page);
		await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
			timeout: 20_000,
		});
		await page.goto("/en/tasks");
		await expect(
			page.getByRole("heading", { name: /tasks/i }).first(),
		).toBeVisible();
		await page.goBack();
		await dismissTaskEditorIfOpen(page);
		await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
			timeout: 20_000,
		});
		await page.goForward();
		await expect(page).toHaveURL(/\/en\/tasks$/);
		await page.goBack();
		await dismissTaskEditorIfOpen(page);
		await expect(page.getByTestId("accepted-plan-surface")).toBeVisible({
			timeout: 20_000,
		});

		const secondResponse = await request.get(`/api/tasks/${task.taskId}/plan`);
		expect(secondResponse.ok()).toBeTruthy();
		const secondBody = (await secondResponse.json()) as {
			savedPlan?: { id?: string; status?: string } | null;
		};
		expect(secondBody.savedPlan?.id).toBe(firstBody.savedPlan?.id);
		expect(secondBody.savedPlan?.status).toBe("accepted");
	});
});
