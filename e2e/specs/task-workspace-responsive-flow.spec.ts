import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createResponsiveTask(request: APIRequestContext, viewport: string) {
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
  test("keeps primary task workflow visible", async ({ page, request }, testInfo) => {
    const viewport = testInfo.project.name === "chromium" ? "desktop" : testInfo.project.name;
    const taskId = await createResponsiveTask(request, viewport);
    await page.goto(`/en/tasks/${taskId}`);

    await expect(page.getByRole("heading", { name: `Responsive workspace ${viewport}` })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/en/tasks/${taskId}$`));
    await expect(page.getByRole("region", { name: "Task execution workspace" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Task command center" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
