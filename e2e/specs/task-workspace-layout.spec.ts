import { expect, test, type APIRequestContext } from "@playwright/test";
import { setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

async function createTask(request: APIRequestContext, title: string) {
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
      description: "Verify current task workspace layout.",
      priority: "Medium",
    },
  });
  expect(createTaskResponse.ok()).toBeTruthy();
  const createdTask = (await createTaskResponse.json()) as { taskId?: string };
  expect(createdTask.taskId).toBeTruthy();
  return createdTask.taskId;
}

test.describe("Task workspace layout", () => {
  for (const viewport of ["desktop", "mobile"] as const) {
    test(`keeps workspace execution regions reachable on ${viewport}`, async ({ page, request }) => {
      const taskId = await createTask(request, `E2E Layout ${viewport}`);
      await setTaskWorkspaceViewport(page, viewport);
      await page.goto(`/en/tasks/${taskId}`);

      await expect(page.getByText(`E2E Layout ${viewport}`).first()).toBeVisible();
      await expect(page.getByText("Plan").first()).toBeVisible();

      if (viewport === "mobile") {
        const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(hasHorizontalScroll).toBe(false);
      }
    });
  }
});
