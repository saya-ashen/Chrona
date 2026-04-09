import { expect, test } from "@playwright/test";

test("task center leads to task page and work page without falling back to chat-first UI", async ({
  page,
}) => {
  await page.goto("/tasks");

  await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();
  await page.getByRole("link", { name: "Write task projection" }).click();
  await expect(page.getByRole("button", { name: "Start Run" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Schedule" })).toBeVisible();
  await expect(page.getByText("Block Reason")).toBeVisible();

  await page.getByRole("link", { name: "Open Work Page" }).click();
  await expect(page.getByRole("link", { name: "Open Schedule" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending Approvals" })).toBeVisible();
});
