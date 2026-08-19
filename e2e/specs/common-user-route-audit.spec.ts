import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

async function getWorkspaceId(request: APIRequestContext) {
	const response = await request.get("/api/workspaces/default");
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		id?: string;
		workspaceId?: string;
		workspace?: { id?: string };
	};
	const id = body.workspaceId ?? body.id ?? body.workspace?.id;
	expect(id).toBeTruthy();
	return id!;
}

async function expectNoHorizontalScroll(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => ({
				body: document.body.scrollWidth > window.innerWidth,
				document: document.documentElement.scrollWidth > window.innerWidth,
			})),
		)
		.toEqual({ body: false, document: false });
}

test.describe("Common user route audit", () => {
	test.setTimeout(120_000);

	test("preserves navigation state through locale redirects and Not Found recovery", async ({
		page,
	}) => {
		await page.goto("/?source=e2e#route-audit");
		await expect(page).toHaveURL(/\/en\/dashboard\?source=e2e#route-audit$/);

		await page.goto("/invalid-locale/tasks?source=e2e");
		await expect(page).toHaveURL(/\/en\/tasks\?source=e2e$/);

		await page.goto("/en/missing-route");
		await expect(
			page.getByRole("heading", { name: "Page not found" }),
		).toBeVisible();
		await page.getByRole("link", { name: "Go home" }).click();
		await expect(page).toHaveURL(/\/en\/dashboard$/);
	});

	test("[BOOT-002] switches locale without losing route state", async ({
		page,
	}) => {
		await page.goto("/en/tasks?source=locale#task-list");
		await page.getByRole("link", { name: "中文" }).click();

		await expect(page).toHaveURL(/\/zh\/tasks\?source=locale#task-list$/);
		await expect(
			page.getByRole("link", { name: "任务" }).first(),
		).toHaveAttribute("aria-current", "page");
		await expect(
			page.getByRole("button", { name: "新建任务" }).first(),
		).toBeVisible();
	});

	test("[WORK-004] shows Not Found for an unknown task workspace", async ({
		page,
	}) => {
		await page.goto("/en/tasks/nonexistent-task-id");
		await expect(
			page.getByRole("heading", { name: "Page not found" }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: "Go home" })).toBeVisible();
	});

	test("[WORK-008] opens a Goal-owned Task through its inspector route", async ({
		page,
		request,
	}) => {
		const workspaceId = await getWorkspaceId(request);
		const goalResponse = await request.post("/api/goals", {
			data: {
				workspaceId,
				title: "Goal inspector route",
				successCriteria: [
					{
						id: "done",
						kind: "user_confirmed",
						description: "Task completed",
						satisfied: false,
						confirmedAt: null,
					},
				],
			},
		});
		expect(goalResponse.ok()).toBeTruthy();
		const goal = (await goalResponse.json()) as { id: string };
		const taskResponse = await request.post(`/api/goals/${goal.id}/tasks`, {
			data: {
				kind: "task",
				title: "Inspector-owned task",
				priority: "Medium",
				autoPlanGeneration: false,
			},
		});
		expect(taskResponse.ok()).toBeTruthy();
		const task = (await taskResponse.json()) as { taskId: string };

		await page.goto(`/en/goals/${goal.id}/workbench/tasks/${task.taskId}`);

		await expect(page).toHaveURL(
			new RegExp(`/en/goals/${goal.id}/workbench/tasks/${task.taskId}$`),
		);
		await expect(
			page.getByRole("heading", { name: "Inspector-owned task" }).first(),
		).toBeVisible();
		await expect(page.locator('[data-domain="tasks"]')).toBeVisible();
	});

	test("[BOOT-011] keeps primary navigation highlight and browser back state", async ({
		page,
	}) => {
		await page.goto("/en/dashboard");
		await expect(
			page.getByRole("link", { name: "Dashboard", exact: true }).first(),
		).toHaveAttribute("aria-current", "page");
		await page
			.getByRole("link", { name: "Schedule", exact: true })
			.first()
			.click();
		await expect(page).toHaveURL(/\/en\/schedule$/);
		await expect(
			page.getByRole("link", { name: "Schedule", exact: true }).first(),
		).toHaveAttribute("aria-current", "page");
		await page.goBack();
		await expect(page).toHaveURL(/\/en\/dashboard$/);
		await expect(
			page.getByRole("link", { name: "Dashboard", exact: true }).first(),
		).toHaveAttribute("aria-current", "page");
	});

	test("opens every primary route without overflow or browser errors", async ({
		page,
	}) => {
		const pageErrors: string[] = [];
		const consoleErrors: string[] = [];
		const serverErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("response", (response) => {
			if (response.status() >= 500)
				serverErrors.push(`${response.status()} ${response.url()}`);
		});

		for (const route of [
			"/en/dashboard",
			"/en/schedule",
			"/en/tasks",
			"/en/action-center",
			"/en/goals",
			"/en/settings",
		]) {
			await test.step(`open ${route}`, async () => {
				await page.goto(route, {
					waitUntil: "domcontentloaded",
					timeout: 60_000,
				});
				await expect(page).toHaveURL(
					new RegExp(`${route.replaceAll("/", "\\/")}(?:\\?.*)?$`),
				);
				await expect(page.locator(".chrona-app-main")).toBeVisible({
					timeout: 20_000,
				});
				await expect(page.getByText("Page not found")).toHaveCount(0);
				await expectNoHorizontalScroll(page);
			});
		}

		expect(pageErrors).toEqual([]);
		expect(consoleErrors).toEqual([]);
		expect(serverErrors).toEqual([]);
	});
});
