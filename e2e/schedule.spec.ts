import { expect, test } from "@playwright/test";

test("schedule page emphasizes planning surfaces and starter presets", async ({ page }) => {
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scheduled Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unscheduled Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI Proposals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conflicts / Overdue Risks" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Create Task Block" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Create Task Block" }).first().click();

  await expect(page.getByText("Starter presets")).toBeVisible();
  await page.getByRole("button", { name: /Bug investigation/i }).click();

  await expect(page.getByLabel("Priority")).toHaveValue("High");
  await expect(page.getByLabel("Model")).toHaveValue("gpt-5.4");
  await expect(page.getByLabel("Prompt / instructions")).toContainText("Reproduce the issue");
});
