import { expect, test } from "@playwright/test";

test("schedule page shows seeded scheduled, unscheduled, proposal, and risk examples", async ({
  page,
}) => {
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Scheduled Blocks")).toBeVisible();
  await expect(page.getByText("Unscheduled Queue")).toBeVisible();
  await expect(page.getByText("AI Proposals")).toBeVisible();
  await expect(page.getByText("Conflicts / Overdue Risks")).toBeVisible();

  await expect(page.getByRole("link", { name: "Prepare release schedule" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Queue follow-up docs" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Recover overdue adapter run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept Proposal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject Proposal" })).toBeVisible();
});
