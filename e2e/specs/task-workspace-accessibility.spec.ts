import { expect, test } from "@playwright/test";
import { getPrimaryTaskWorkspaceAction, setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

test.describe("Task workspace accessibility", () => {
  test("reaches primary schedule actions by keyboard and accessible names", async ({ page }) => {
    await setTaskWorkspaceViewport(page, "desktop");
    await page.goto("/en/schedule");

    const quickAdd = getPrimaryTaskWorkspaceAction(page, "Quick add");
    await expect(quickAdd).toBeVisible();
    await quickAdd.focus();
    await expect(quickAdd).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("Add title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
