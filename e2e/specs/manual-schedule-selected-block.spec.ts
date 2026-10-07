import { expect, test, type Locator, type Page } from "@playwright/test";
import { openAdvancedTaskCreation } from "./advanced-navigation-helpers";

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

function localDateTimeValue(date: Date, hours: number, minutes: number) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(hours)}:${part(minutes)}`;
}

async function clearOneOffSchedule(page: Page, sheet: Locator) {
  const dateInput = sheet.locator('input[name="scheduledDate"]');
  const dateValue = await dateInput.inputValue();
  const date = new Date(`${dateValue}T00:00:00`);
  await dateInput.locator("xpath=following::button[1]").click();
  await page.getByRole("button", {
    name: new RegExp(date.toLocaleDateString("en-US", { month: "long", day: "numeric" })),
  }).click();
  await page.keyboard.press("Escape");
  await sheet.locator("#task-config-scheduledStartTime").click();
  await page.getByRole("option", { name: "--", exact: true }).click();
  await sheet.locator("#task-config-scheduledEndTime").click();
  await page.getByRole("option", { name: "--", exact: true }).click();
}

test.describe("Manual Schedule selected-block editor", () => {
  test("edits a manual scheduled task without AI controls or AI PATCH fields", async ({ page }, testInfo) => {
    await page.goto("/en/schedule");
    await openAdvancedTaskCreation(page);
    const dialog = page.getByRole("dialog");
    const title = `Manual selected block ${testInfo.project.name}`;
    await dialog.getByPlaceholder("Add title").fill(title);
    await dialog.getByRole("radio", { name: "Manual task" }).click();
    const createResponse = page.waitForResponse((response) =>
      response.url().includes("/api/tasks") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    const created = (await (await createResponse).json()) as { taskId: string };
    await page.goto(`/en/schedule?task=${created.taskId}`);

    let sheet = page.getByRole("dialog", { name: "Task Details" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Execution status", { exact: true })).toHaveCount(0);
    await expect(sheet.getByText("Current plan", { exact: true })).toHaveCount(0);
    await expect(sheet.getByText("Repeat", { exact: true })).toHaveCount(0);
    await expect(sheet.getByText("Automation", { exact: true })).toHaveCount(0);

    const editedTitle = `${title} edited`;
    await sheet.locator('input[name="title"]').fill(editedTitle);
    const patchResponse = page.waitForResponse((response) =>
      response.url().includes("/api/tasks/") && response.request().method() === "PATCH",
    );
    await sheet.getByRole("button", { name: "Save task" }).click();
    const patch = await patchResponse;
    expect(patch.ok()).toBeTruthy();
    expect(JSON.parse(patch.request().postData() ?? "{}")).toEqual({
      title: editedTitle,
      description: null,
      priority: "Medium",
    });
    await expect(sheet).toBeVisible();
    await page.goto(`/en/schedule?task=${created.taskId}`);
    sheet = page.getByRole("dialog", { name: "Task Details" });
    await expect(sheet).toBeVisible();

    // Clear the existing one-off block in the UI while setting the first
    // deadline. The ordered DELETE then deadline-only PUT must be observable.
    const firstDue = new Date();
    firstDue.setDate(firstDue.getDate() + 5);
    firstDue.setHours(0, 0, 0, 0);
    await sheet.locator('input[name="dueAt"]').fill(localDateTimeValue(firstDue, 17, 0));
    await clearOneOffSchedule(page, sheet);
    const clearResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/tasks/${created.taskId}/schedule`) && response.request().method() === "DELETE",
    );
    const deadlineResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/tasks/${created.taskId}/schedule`) && response.request().method() === "PUT",
    );
    await sheet.getByRole("button", { name: "Save task" }).click();
    const [clear, deadline] = await Promise.all([clearResponse, deadlineResponse]);
    expect(clear.ok()).toBeTruthy();
    expect(deadline.ok()).toBeTruthy();
    const firstDeadlineBody = JSON.parse(deadline.request().postData() ?? "{}") as { dueAt?: string | null };
    expect(firstDeadlineBody).toMatchObject({ scheduledStartAt: null, scheduledEndAt: null });
    expect(firstDeadlineBody.dueAt).toEqual(expect.any(String));
    await page.goto(`/en/schedule?task=${created.taskId}`);
    sheet = page.getByRole("dialog", { name: "Task Details" });
    await expect(sheet).toBeVisible();
    const firstSavedDue = await sheet.locator('input[name="dueAt"]').inputValue();
    expect(firstSavedDue).not.toBe("");
    await expect(sheet.locator('input[name="scheduledDate"]')).toHaveValue("");

    // Changing then clearing a deadline with no schedule remains a dueAt-only
    // operation; no one-off window may be recreated.
    const secondDue = new Date(firstDue);
    secondDue.setDate(secondDue.getDate() + 2);
    const changedDeadlineResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/tasks/${created.taskId}/schedule`) && response.request().method() === "PUT",
    );
    await sheet.locator('input[name="dueAt"]').fill(localDateTimeValue(secondDue, 16, 0));
    await sheet.getByRole("button", { name: "Save task" }).click();
    const changedDeadline = await changedDeadlineResponse;
    const changedDeadlineBody = JSON.parse(changedDeadline.request().postData() ?? "{}") as { dueAt?: string | null };
    expect(changedDeadlineBody).toMatchObject({ scheduledStartAt: null, scheduledEndAt: null });
    expect(changedDeadlineBody.dueAt).toEqual(expect.any(String));
    expect(changedDeadlineBody.dueAt).not.toBe(firstDeadlineBody.dueAt);
    await page.goto(`/en/schedule?task=${created.taskId}`);
    sheet = page.getByRole("dialog", { name: "Task Details" });
    await expect(sheet).toBeVisible();
    const secondSavedDue = await sheet.locator('input[name="dueAt"]').inputValue();
    expect(secondSavedDue).not.toBe("");
    expect(secondSavedDue).not.toBe(firstSavedDue);

    const clearedDeadlineResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/tasks/${created.taskId}/schedule`) && response.request().method() === "PUT",
    );
    await sheet.locator('input[name="dueAt"]').fill("");
    await sheet.getByRole("button", { name: "Save task" }).click();
    const clearedDeadline = await clearedDeadlineResponse;
    expect(JSON.parse(clearedDeadline.request().postData() ?? "{}")).toMatchObject({
      dueAt: null, scheduledStartAt: null, scheduledEndAt: null,
    });

    // Read back after reload rather than trusting optimistic Schedule state.
    await page.reload();
    const reloadedSheet = page.getByRole("dialog", { name: "Task Details" });
    await expect(reloadedSheet).toBeVisible();
    await expect(reloadedSheet.locator('input[name="title"]')).toHaveValue(editedTitle);
    await expect(reloadedSheet.locator('input[name="dueAt"]')).toHaveValue("");
    await expect(reloadedSheet.locator('input[name="scheduledDate"]')).toHaveValue("");
    await expectNoHorizontalScroll(page);
  });
});
