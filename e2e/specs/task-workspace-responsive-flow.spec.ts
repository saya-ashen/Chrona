import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { setTaskWorkspaceViewport, type TaskWorkspaceViewport } from "./task-workspace-test-helpers";

async function createResponsiveTask(request: APIRequestContext, viewport: TaskWorkspaceViewport) {
  const workspaceResponse = await request.get("/api/workspaces/default");
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspaceBody = (await workspaceResponse.json()) as { id?: string; workspace?: { id?: string }; workspaceId?: string };
  const workspaceId = workspaceBody.workspaceId ?? workspaceBody.id ?? workspaceBody.workspace?.id;
  expect(workspaceId).toBeTruthy();

  const response = await request.post("/api/tasks", {
    data: {
      workspaceId,
      title: `Responsive workspace ${viewport}`,
      description: "Verify task workspace navigation remains usable across viewport sizes.",
      priority: "Medium",
    },
  });
  expect(response.ok()).toBeTruthy();
  const created = (await response.json()) as { taskId?: string };
  expect(created.taskId).toBeTruthy();
  return created.taskId!;
}

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    bodyOverflow: document.body.scrollWidth > window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }))).toEqual({ bodyOverflow: false, documentOverflow: false });
}

test.describe("Task workspace responsive flow", () => {
  for (const viewport of ["desktop", "tablet", "mobile"] as const) {
    test(`keeps primary task workflow visible on ${viewport}`, async ({ page, request }) => {
      const taskId = await createResponsiveTask(request, viewport);
      await setTaskWorkspaceViewport(page, viewport);
      await page.goto(`/en/tasks/${taskId}`);

      await expect(page.getByRole("heading", { name: `Responsive workspace ${viewport}` })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/en/tasks/${taskId}$`));
      await expect(page.getByText("Plan").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }
});
