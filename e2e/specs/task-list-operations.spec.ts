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
	priority = "Medium",
) {
	const response = await request.post("/api/tasks", {
		data: {
			workspaceId: await workspaceId(request),
			title,
			description: "Task list operations fixture",
			priority,
		},
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as { taskId?: string };
	expect(body.taskId).toBeTruthy();
	return body.taskId as string;
}

function taskHeading(page: Page, title: string) {
	return page.getByRole("heading", { name: title, exact: true });
}

async function expectTaskHeadingVisible(page: Page, title: string) {
	await expect(taskHeading(page, title)).toHaveCount(1);
}

test.describe("Task list operations", () => {
	test.setTimeout(60_000);

	test("[TASK-021] switches task views and persists URL state", async ({
		page,
	}) => {
		await page.goto("/en/tasks");
		await page.getByRole("button", { name: "In progress" }).click();
		await expect(page).toHaveURL(/filter=running/);
		await page.getByRole("button", { name: "Results" }).click();
		await expect(page).toHaveURL(/view=results/);
		await page.getByRole("button", { name: "All tasks" }).click();
		await expect(page).toHaveURL(/\/en\/tasks(?:\?|$)/);
	});

	test("[TASK-022] applies status filter and exposes filtered empty state", async ({
		page,
	}) => {
		await page.goto("/en/tasks");
		await page.getByRole("button", { name: "Needs attention" }).click();
		await expect(page).toHaveURL(/filter=needs_me/);
		await expect(page.locator(".chrona-app-main")).toBeVisible();
		await page.getByRole("button", { name: "All tasks" }).click();
		await expect(page).not.toHaveURL(/filter=needs_me/);
	});

	test("[TASK-025] changes sort field and direction", async ({ page }) => {
		await page.goto("/en/tasks");
		const sort = page.getByRole("combobox", { name: /sort/i });
		await sort.click();
		await page.getByRole("option").nth(1).click();
		await expect(page).toHaveURL(/sort=/);
		const direction = page.getByRole("button", { name: "Descending" });
		await expect(direction).toBeVisible();
		await direction.click();
		await expect(page).toHaveURL(/order=asc/);
		await expect(page.getByRole("button", { name: "Ascending" })).toBeVisible();
	});

	test("[TASK-026] changes page size and navigates pagination", async ({
		page,
		request,
	}) => {
		const token = crypto.randomUUID();
		for (let index = 0; index < 3; index += 1)
			await createTask(request, `Pagination ${token} ${index}`);
		await page.goto("/en/tasks?pageSize=1");
		const pageSize = page
			.locator('[role="combobox"][aria-label*="page" i]')
			.last();
		await expect(pageSize).toBeVisible();
		await page.getByRole("button", { name: /next page/i }).click();
		await expect(page).toHaveURL(/page=2/);
		await pageSize.click();
		await page.getByRole("option", { name: /20/ }).click();
		await expect(page).toHaveURL(/pageSize=20/);
	});

	test("[TASK-023/024] searches, clears, and filters by priority", async ({
		page,
		request,
	}) => {
		const token = crypto.randomUUID();
		const urgentTitle = `Urgent searchable ${token}`;
		const normalTitle = `Normal hidden ${token}`;
		await createTask(request, urgentTitle, "Urgent");
		await createTask(request, normalTitle, "Low");

		await page.goto("/en/tasks");
		const search = page.getByRole("searchbox", { name: /search/i });
		await search.fill(urgentTitle);
		await search.press("Enter");
		await expect(page).toHaveURL(/search=/);
		await expectTaskHeadingVisible(page, urgentTitle);
		await expect(taskHeading(page, normalTitle)).toHaveCount(0);

		await page.getByRole("button", { name: "Clear search" }).click();
		await expect(page).not.toHaveURL(/search=/);
		await expectTaskHeadingVisible(page, normalTitle);

		await page.getByRole("combobox", { name: /priority/i }).click();
		await page.getByRole("option", { name: "Urgent", exact: true }).click();
		await expect(page).toHaveURL(/priority=Urgent/);
		await expectTaskHeadingVisible(page, urgentTitle);
		await expect(taskHeading(page, normalTitle)).toHaveCount(0);
	});

	test("[TASK-028/029] selects visible tasks and cancels bulk deletion", async ({
		page,
		request,
	}) => {
		const token = crypto.randomUUID();
		const first = `Bulk cancel A ${token}`;
		const second = `Bulk cancel B ${token}`;
		await createTask(request, first);
		await createTask(request, second);

		await page.goto("/en/tasks");
		await expectTaskHeadingVisible(page, first);
		await expectTaskHeadingVisible(page, second);
		await page.getByRole("button", { name: /select visible/i }).click();
		await expect(
			page.getByRole("button", { name: /delete selected/i }),
		).toBeEnabled();
		await page.getByRole("button", { name: /delete selected/i }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: /cancel/i }).click();
		await expect(dialog).not.toBeVisible();
		await expect(taskHeading(page, first)).toHaveCount(1);
		await expect(taskHeading(page, second)).toHaveCount(1);
	});

	test("[TASK-030] bulk deletion removes only selected tasks", async ({
		page,
		request,
	}) => {
		const token = crypto.randomUUID();
		const selected = `Bulk delete selected ${token}`;
		const retained = `Bulk delete retained ${token}`;
		await createTask(request, selected);
		await createTask(request, retained);

		await page.goto("/en/tasks");
		await expectTaskHeadingVisible(page, selected);
		await expectTaskHeadingVisible(page, retained);
		await page.getByRole("button", { name: /select visible/i }).click();
		const retainedCheckbox = page.getByRole("checkbox", {
			name: `Select ${retained}`,
		});
		await expect(retainedCheckbox).toBeVisible();
		await retainedCheckbox.click({ force: true });
		await expect(
			page.getByRole("button", { name: /delete selected/i }),
		).toBeEnabled();
		await page.getByRole("button", { name: /delete selected/i }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /delete/i })
			.click();
		await expect(taskHeading(page, selected)).toHaveCount(0);
		await expect(taskHeading(page, retained)).toHaveCount(1);
	});
});
