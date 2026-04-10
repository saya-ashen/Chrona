import { expect, test } from "@playwright/test";

test("task detail is secondary while work remains the primary execution surface", async ({ page }) => {
  await page.goto("/tasks");

  await expect(page.getByRole("heading", { name: "Task Center" })).toBeVisible();
  await page.getByRole("link", { name: "Missing prompt task" }).click();

  await expect(page.getByText("Secondary task detail")).toBeVisible();
  await expect(page.getByText("Use the primary surfaces")).toBeVisible();
  await expect(page.getByText("Runtime configuration")).toBeVisible();
  await expect(page.getByText("Needs prompt").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Schedule" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Workbench" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Run" })).toHaveCount(0);

  await page.getByRole("link", { name: "Open Workbench" }).click();
  await expect(page.getByRole("link", { name: "Open Schedule" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View task detail" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next Action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shared Output" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution Workstream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conversation" })).toBeVisible();
});
