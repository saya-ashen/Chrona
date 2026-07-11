import { expect, test } from "@playwright/test";
import { createTaskWorkspaceTask, setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

test.describe("Task workspace smoke", () => {
  test("shows header, plan panel, command center, and activity without provider", async ({ page, request }) => {
    const { taskId } = await createTaskWorkspaceTask(request, {
      title: "Workspace smoke task",
      description: "Verify task workspace first paint without external LLM/provider.",
    });

    await setTaskWorkspaceViewport(page, "desktop");
    await page.goto(`/en/tasks/${taskId}`);

    await expect(page.getByRole("heading", { name: "Workspace smoke task" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Task execution workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You can create a plan now" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Plan creation action" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Task brief" })).toBeVisible();
  });
});
