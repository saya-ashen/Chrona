import { expect, test } from "@playwright/test";
import { setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

test.describe("Task workspace layout", () => {
  for (const viewport of ["desktop", "mobile"] as const) {
    test(`keeps schedule task creation controls reachable on ${viewport}`, async ({ page }) => {
      await setTaskWorkspaceViewport(page, viewport);
      await page.goto("/en/schedule");

      await expect(page.getByRole("button", { name: "Quick add" })).toBeVisible();
      await page.getByRole("button", { name: "Quick add" }).click();
      await expect(page.getByPlaceholder("Add title")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    });
  }
});
