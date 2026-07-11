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
  const workspaceResponse = await request.get("/api/workspaces/default");
  expect(workspaceResponse.ok()).toBeTruthy();

  const workspaceBody = (await workspaceResponse.json()) as {
    id?: string;
    workspace?: { id?: string };
    workspaceId?: string;
  };
  const workspaceId = workspaceBody.workspaceId ?? workspaceBody.id ?? workspaceBody.workspace?.id;
  expect(workspaceId).toBeTruthy();

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
  test("shows disabled task-aware assistant status while drawer is unavailable", async ({
    page,
    request,
  }) => {
    const createdTask = await createTask(
      request,
      "E2E Assistant Surface Task",
      "Verify the page-aware assistant surface status.",
    );

    await page.goto(`/en/tasks/${createdTask.taskId}`);
    await expect(page.getByRole("heading", { name: "E2E Assistant Surface Task" })).toBeVisible();

    const taskEditor = page.getByRole("dialog", { name: "Edit task" });
    if (await taskEditor.isVisible()) {
      await taskEditor.getByRole("button", { name: "Close task editor" }).click();
      await expect(taskEditor).not.toBeVisible();
    }

    const trigger = page.getByRole("button", { name: "Open Chrona AI dropdown" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeDisabled();
    await expect(page.getByText("Generate a plan before execution can start", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate plan" }).first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Task context" })).toHaveCount(0);
  });
});
