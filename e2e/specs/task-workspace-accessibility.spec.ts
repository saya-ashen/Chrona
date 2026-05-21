import { expect, test } from "@playwright/test";
import { getPrimaryTaskWorkspaceAction, setTaskWorkspaceViewport } from "./task-workspace-test-helpers";

test.describe("Task workspace accessibility", () => {
  test("reaches primary schedule actions by keyboard and accessible names", async ({ page }) => {
    await setTaskWorkspaceViewport(page, "desktop");
    await page.goto("/en/schedule");

    const newTask = getPrimaryTaskWorkspaceAction(page, "New Task");
    await expect(newTask).toBeVisible();
    await newTask.focus();
    await expect(newTask).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("Add title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
