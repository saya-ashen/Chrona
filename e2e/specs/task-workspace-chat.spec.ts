import { expect, test, type APIRequestContext } from "@playwright/test";

type CreatedTask = {
	taskId: string;
	workspaceId: string;
};

async function createTask(
	request: APIRequestContext,
	title: string,
	description: string,
): Promise<CreatedTask> {
	let workspaceId: string | undefined;
	await expect
		.poll(
			async () => {
				const workspaceResponse = await request.get("/api/workspaces/default");
				if (!workspaceResponse.ok()) return null;
				const workspaceBody = (await workspaceResponse.json()) as {
					id?: string;
					workspace?: { id?: string };
					workspaceId?: string;
				};
				workspaceId =
					workspaceBody.workspaceId ??
					workspaceBody.id ??
					workspaceBody.workspace?.id;
				return workspaceId ?? null;
			},
			{ timeout: 15_000, intervals: [200, 500, 1_000] },
		)
		.not.toBeNull();

	const createTaskResponse = await request.post("/api/tasks", {
		data: {
			workspaceId,
			title,
			description,
			priority: "Medium",
		},
	});
	expect(createTaskResponse.ok()).toBeTruthy();

	const createdTask = (await createTaskResponse.json()) as CreatedTask;
	expect(createdTask.taskId).toBeTruthy();
	expect(createdTask.workspaceId).toBeTruthy();
	return createdTask;
}

test.describe("Task Workspace Assistant Surface", () => {
	test("[ASSIST-005] shows disabled task-aware assistant status while drawer is unavailable", async ({
		page,
		request,
	}) => {
		const createdTask = await createTask(
			request,
			"E2E Assistant Surface Task",
			"Verify the page-aware assistant surface status.",
		);

		await page.goto(`/en/tasks/${createdTask.taskId}`);
		await expect(
			page.getByRole("heading", { name: "E2E Assistant Surface Task" }),
		).toBeVisible();

		const taskEditor = page.getByRole("dialog", { name: "Edit task" });
		if (await taskEditor.isVisible()) {
			await taskEditor
				.getByRole("button", { name: "Close task editor" })
				.click();
			await expect(taskEditor).not.toBeVisible();
		}

		const trigger = page.getByRole("button", {
			name: "Open Chrona AI dropdown",
		});
		await expect(trigger).toBeVisible();
		await expect(trigger).toBeDisabled();
		await expect(
			page.getByText("Needs plan", { exact: true }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Edit task" }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("dialog", { name: "Task context" }),
		).toHaveCount(0);
	});
});
