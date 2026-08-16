import { expect, test, type Page } from "@playwright/test";
import {
  createTaskWorkspaceTask,
  generateTaskWorkspacePlan,
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
  test("[WORK-006] reopens the correct node detail after refresh", async ({ page, request }, testInfo) => {
    const viewport = (testInfo.project.name === "tablet" || testInfo.project.name === "mobile")
      ? testInfo.project.name
      : "desktop" satisfies TaskWorkspaceViewport;
    const task = await createTaskWorkspaceTask(request, {
      title: `E2E Drawer Reliability ${viewport}`,
      description: "Verify task workspace node drawer open, close, and reopen reliability.",
    });
    await generateTaskWorkspacePlan(request, task.taskId);
    await page.goto(`/en/tasks/${task.taskId}`);

    await expect(page.getByRole("heading", { name: `E2E Drawer Reliability ${viewport}` })).toBeVisible();
    await expect(page.getByTestId("accepted-plan-surface")).toBeVisible();

    await clickPlanNode(page);
    await expect(page.getByText("Inspecting step: Collect boundary context", { exact: true })).toBeVisible();
    await expect(page.getByTestId("accepted-plan-surface")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("accepted-plan-surface")).toBeVisible();
    const secondNode = page.getByRole("button", { name: /Route execution/ });
    await expect(secondNode).toBeVisible();
    await secondNode.click();
    await expect(page.getByText("Inspecting step: Route execution", { exact: true })).toBeVisible();
    await expect(page.getByText("Inspecting step: Collect boundary context", { exact: true })).toHaveCount(0);

    if (viewport === "mobile") {
      await expectNoHorizontalScroll(page);
    }
  });
});
