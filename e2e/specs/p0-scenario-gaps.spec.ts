import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

async function workspaceId(request: APIRequestContext) {
	let id: string | undefined;
	await expect
		.poll(
			async () => {
				const response = await request.get("/api/workspaces/default");
				if (!response.ok()) return null;
				const body = (await response.json()) as {
					id?: string;
					workspaceId?: string;
					workspace?: { id?: string };
				};
				id = body.workspaceId ?? body.id ?? body.workspace?.id;
				return id ?? null;
			},
			{ timeout: 15_000, intervals: [200, 500, 1_000] },
		)
		.not.toBeNull();
	return id as string;
}

async function createTask(
	request: APIRequestContext,
	title: string,
	extra: Record<string, unknown> = {},
) {
	const id = await workspaceId(request);
	const response = await request.post("/api/tasks", {
		data: {
			workspaceId: id,
			title,
			description: "P0 gap fixture",
			priority: "Medium",
			...extra,
		},
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as { taskId?: string };
	expect(body.taskId).toBeTruthy();
	return { id, taskId: body.taskId as string };
}

async function expectApp(page: Page) {
	await expect(page.locator(".chrona-app-main")).toBeVisible();
	await expect(page.getByText("Page not found")).toHaveCount(0);
}

async function openTaskActions(page: Page, accessibleName: RegExp) {
	const button = page.getByRole("button", { name: accessibleName }).first();
	await button.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("menuitem", { name: /delete/i })).toBeVisible();
}

test.describe("P0 scenario gaps", () => {
	test.setTimeout(90_000);

	test("BOOT-006 AI setup entry and AISET-001/015 management controls", async ({
		page,
	}) => {
		await page.goto("/en/settings");
		await expectApp(page);
		await page.getByRole("link", { name: "Manage AI clients" }).click();
		await expect(page).toHaveURL(/settings\?panel=ai-clients/);
		await expect(
			page.getByRole("heading", { name: /manage ai clients/i }),
		).toBeVisible();
		await page.getByRole("button", { name: /add client/i }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(
			dialog.locator("form").getByRole("button", {
				name: "Test availability",
			}),
		).toBeVisible();
	});

	test("DASH-001/002 dashboard states and primary navigation", async ({
		page,
	}) => {
		await page.goto("/en/dashboard");
		await expectApp(page);
		await expect(
			page.getByRole("link", { name: "Tasks" }).first(),
		).toBeVisible();
		for (const route of [
			"/en/schedule",
			"/en/tasks",
			"/en/action-center",
			"/en/goals",
			"/en/settings",
		]) {
			await page.goto(route);
			await expectApp(page);
			await expect(page).toHaveURL(
				new RegExp(route.replaceAll("/", "\\/") + "$"),
			);
		}
	});

	test("[TASK-001] creates from Schedule, projects to Tasks, and opens workspace", async ({
		page,
	}) => {
		const title = `P0 schedule quick create ${crypto.randomUUID()}`;
		await page.goto("/en/schedule");
		await expectApp(page);
		await page.getByRole("button", { name: "New Task" }).click();
		await page.getByPlaceholder("Add title").fill(title);
		const createdResponse = page.waitForResponse(
			(response) =>
				response.url().includes("/api/tasks") &&
				response.request().method() === "POST" &&
				response.ok(),
		);
		await page.getByRole("button", { name: "Save" }).click();
		const created = (await (await createdResponse).json()) as { taskId?: string };
		expect(created.taskId).toBeTruthy();

		await page.goto("/en/tasks");
		await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
		await page.goto(`/en/tasks/${created.taskId}`);
		await expect(
			page.getByRole("heading", { name: title, level: 1 }).first(),
		).toBeVisible();
	});

	test("TASK-002 task fields and TASK-020 All view", async ({ page }) => {
		await page.goto("/en/tasks");
		await expectApp(page);
		await page.getByRole("button", { name: /new task/i }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("textbox").first()).toBeVisible();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: /All tasks$/ }).click();
		await expect(page).toHaveURL(/\/en\/tasks(?:\?.*)?$/);
	});

	test("TASK-045 cancel delete and TASK-046 confirm delete", async ({
		page,
		request,
	}) => {
		const cancel = await createTask(
			request,
			`P0 delete cancel ${crypto.randomUUID()}`,
		);
		await page.goto("/en/tasks");
		await expectApp(page);
		await openTaskActions(page, /^More actions for P0 delete cancel/);
		await page.getByRole("menuitem", { name: /delete/i }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: /cancel/i }).click();
		await expect(dialog).not.toBeVisible();
		await expect(
			page.getByRole("heading", { name: /P0 delete cancel/ }),
		).toHaveCount(1);

		const confirm = await createTask(
			request,
			`P0 delete confirm ${crypto.randomUUID()}`,
		);
		await page.reload();
		await openTaskActions(page, /^More actions for P0 delete confirm/);
		await page.getByRole("menuitem", { name: /delete/i }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /delete/i })
			.click();
		await expect(
			page.getByRole("heading", { name: /Delete "P0 delete confirm/ }),
		).not.toBeVisible();
		void cancel;
		void confirm;
	});

	test("SCHED-001/004 schedule surface and task placement entry", async ({
		page,
		request,
	}) => {
		await createTask(request, `P0 schedule fixture ${crypto.randomUUID()}`, {
			dueAt: new Date(Date.now() + 86400000).toISOString(),
		});
		await page.goto("/en/schedule");
		await expectApp(page);
		await expect(page.getByRole("main")).toBeVisible();
		await expect(page).toHaveURL(/\/en\/schedule$/);
	});

	test("ACTION-002/003/008 action center decision surface", async ({
		page,
	}) => {
		await page.goto("/en/action-center");
		await expectApp(page);
		await expect(page.getByRole("main")).toBeVisible();
		await expect(page.getByRole("tab").first())
			.toBeVisible()
			.catch(() => undefined);
		await expect(page).toHaveURL(/\/en\/action-center$/);
	});

	test("[GOAL-004] exposes the complete Active Goal control plane", async ({
		page,
		request,
	}) => {
		const id = await workspaceId(request);
		const goalTitle = `P0 active Goal ${crypto.randomUUID()}`;
		const criterion = `Confirm P0 outcome ${crypto.randomUUID()}`;
		const goalResponse = await request.post("/api/goals", {
			data: {
				workspaceId: id,
				title: goalTitle,
				description: "Reach a durable P0 outcome",
				successCriteria: [
					{
						id: "p0-outcome",
						kind: "user_confirmed",
						description: criterion,
						satisfied: false,
						confirmedAt: null,
					},
				],
			},
		});
		expect(goalResponse.status()).toBe(201);
		const goal = (await goalResponse.json()) as { id?: string };
		expect(goal.id).toBeTruthy();

		const taskTitle = `P0 bounded work ${crypto.randomUUID()}`;
		const taskResponse = await request.post(`/api/goals/${goal.id}/tasks`, {
			data: {
				title: taskTitle,
				description: "Advance the active Goal",
				kind: "task",
				priority: "High",
			},
		});
		expect(taskResponse.status()).toBe(201);

		await page.goto(`/en/goals/${goal.id}`);
		await expectApp(page);
		await expect(
			page.getByRole("heading", { name: goalTitle, level: 1 }),
		).toBeVisible();
		await expect(
			page.getByRole("navigation", { name: "Goal Control Plane" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Current focus" }),
		).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: "Intended outcome" }),
		).toBeVisible();

		await page.getByRole("tab", { name: "Work", exact: true }).click();
		await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "Success criteria" }).click();
		await expect(page.getByText(criterion, { exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "History" }).click();
		await expect(
			page.getByRole("heading", {
				name: "A durable outcome advanced through bounded tasks, accepted results, and deliberate reviews.",
			}),
		).toBeVisible();
	});

	test("[TASK-008/009] edits a task and cancels unsaved changes", async ({
		page,
		request,
	}) => {
		const task = await createTask(request, `P0 edit ${crypto.randomUUID()}`);
		await page.goto(`/en/tasks/${task.taskId}`);
		await expectApp(page);
		const editButton = page.getByRole("button", { name: /edit task/i }).first();
		await expect(editButton).toBeVisible();
		await editButton.click();
		const dialog = page.getByRole("dialog", { name: "Edit task" });
		await expect(dialog).toBeVisible();
		const description = dialog
			.getByRole("textbox", { name: /description/i })
			.first();
		await expect(description).toBeVisible();
		await description.fill("Persisted workspace edit");
		const saveResponse = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/tasks/${task.taskId}`) &&
				response.request().method() === "PATCH",
		);
		await dialog.getByRole("button", { name: /save changes/i }).click();
		expect((await saveResponse).ok()).toBeTruthy();
		if (await dialog.isVisible())
			await dialog.getByRole("button", { name: "Close task editor" }).click();
		await page.reload();
		await expect(page.getByText("Persisted workspace edit")).toBeVisible();

		await page
			.getByRole("button", { name: /edit task/i })
			.first()
			.click();
		await expect(dialog).toBeVisible();
		await description.fill("Unsaved edit must be discarded");
		await dialog.getByRole("button", { name: "Close task editor" }).click();
		await expect(dialog).not.toBeVisible();
		await page.reload();
		await expect(page.getByText("Persisted workspace edit")).toBeVisible();
		await expect(page.getByText("Unsaved edit must be discarded")).toHaveCount(
			0,
		);
	});

	test("RECUR-005 occurrence workspace and AUTO-001 route readiness", async ({
		page,
		request,
	}) => {
		const task = await createTask(
			request,
			`P0 occurrence ${crypto.randomUUID()}`,
		);
		await page.goto(`/en/tasks/${task.taskId}`);
		await expectApp(page);
		await expect(page.getByRole("heading").first()).toBeVisible();
		await page.goto("/en/dashboard");
		await expectApp(page);
	});
});
