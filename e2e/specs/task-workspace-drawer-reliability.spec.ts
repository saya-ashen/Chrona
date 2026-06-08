import { expect, test, type Page } from "@playwright/test";
import {
  createTaskWorkspaceTask,
  generateDebugTaskWorkspacePlan,
  type TaskWorkspaceViewport,
} from "./task-workspace-test-helpers";


async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    bodyOverflow: document.body.scrollWidth > window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }))).toEqual({ bodyOverflow: false, documentOverflow: false });
}

async function clickPlanNode(page: Page) {
  const node = page.getByRole("button", { name: /Collect boundary context/ });
  await expect(node).toBeVisible();
  await node.click();
}

test.describe("Task workspace node drawer reliability", () => {
  test("opens, collapses, and reopens selected node drawer", async ({ page, request }, testInfo) => {
    const viewport = (testInfo.project.name === "tablet" || testInfo.project.name === "mobile")
      ? testInfo.project.name
      : "desktop" satisfies TaskWorkspaceViewport;
    const task = await createTaskWorkspaceTask(request, {
      title: `E2E Drawer Reliability ${viewport}`,
      description: "Verify task workspace node drawer open, close, and reopen reliability.",
    });
    await generateDebugTaskWorkspacePlan(request, task.taskId);
    await page.goto(`/en/tasks/${task.taskId}`);

    await expect(page.getByRole("heading", { name: `E2E Drawer Reliability ${viewport}` })).toBeVisible();
    await expect(page.getByTestId("task-plan-graph")).toBeVisible();

    await clickPlanNode(page);
    const drawer = page.getByRole("region", { name: "Current node details" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Collect boundary context");

    await drawer.getByRole("button", { name: "Close selected node drawer" }).click();
    const collapsedDrawer = page.getByRole("button", { name: "Open selected node drawer" });
    await expect(collapsedDrawer).toBeVisible();
    await expect(collapsedDrawer).toContainText("Collect boundary context");

    await clickPlanNode(page);
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Collect boundary context");

    if (viewport === "mobile") {
      await expectNoHorizontalScroll(page);
    }
  });
});
