import { expect, test } from "@playwright/test";
import { gotoSeededTaskWorkspace, setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

const WORKSPACE_ID = "cmp72s4oy0007hgfu74srky2u";
const TASK_ID = "cmp72tzoq00008hfurndtr5q9";

test.describe("Task workspace layout", () => {
  for (const viewport of ["desktop", "mobile"] as const) {
    test(`keeps workspace execution regions reachable on ${viewport}`, async ({ page }) => {
      await setTaskWorkspaceViewport(page, viewport);
      await gotoSeededTaskWorkspace(page, WORKSPACE_ID, TASK_ID);

      await expect(page.getByRole("region", { name: "Workspace state" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Execution flow" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Current node details" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Execution overview" })).toBeVisible();

      if (viewport === "mobile") {
        const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(hasHorizontalScroll).toBe(false);
      }
    });
  }
});
