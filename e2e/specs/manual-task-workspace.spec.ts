import { expect, test, type Page } from "@playwright/test";
import { getPrimaryTaskWorkspaceAction } from "./task-workspace-test-helpers";

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

function localDateTimeValue(date: Date, hours: number, minutes: number) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(hours)}:${part(minutes)}`;
}

async function openTaskEditor(page: Page) {
  await page.getByRole("button", { name: "More task actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
}

test.describe("Manual task workspace", () => {
  test("edits ordinary fields then completes and reopens with the refreshed revision", async ({ page }, testInfo) => {
    await page.goto("/en/schedule");
    await getPrimaryTaskWorkspaceAction(page, "New Task").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Add title").fill(`Manual browser task ${testInfo.project.name}`);
    await dialog.getByRole("radio", { name: "Manual task" }).click();
    await expect(dialog.getByText("Chrona will not create a plan or use an AI provider.")).toBeVisible();
    const createResponse = page.waitForResponse((response) =>
      response.url().includes("/api/tasks") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    const response = await createResponse;
    expect(JSON.parse(response.request().postData() ?? "{}")).toMatchObject({
      taskExecutionMode: "manual",
      aiClientId: null,
    });
    const created = (await response.json()) as { taskId: string };
    await page.goto(`/en/tasks/${created.taskId}`);

    await expect(page).toHaveURL(new RegExp(`/en/tasks/${created.taskId}$`));
    await expect(page.getByText("Manual task", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete task" })).toBeVisible();
    await expect(page.getByText(/Needs plan|Start AI/)).toHaveCount(0);

    await openTaskEditor(page);
    const editor = page.getByRole("dialog", { name: "Edit task" });
    await expect(editor).toBeVisible();
    await expect(editor.getByText("Repeat", { exact: true })).toHaveCount(0);
    await expect(editor.getByText("Automation", { exact: true })).toHaveCount(0);
    await expect(editor.getByText("Execution preferences", { exact: true })).toHaveCount(0);

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + 7);
    scheduledDate.setHours(0, 0, 0, 0);
    const editedTitle = `Edited manual ${testInfo.project.name}`;
    await editor.locator('input[name="title"]').fill(editedTitle);
    await editor.locator('textarea[name="description"]').fill("Saved without an AI request");
    await editor.locator('input[name="dueAt"]').fill(localDateTimeValue(scheduledDate, 17, 0));
    await editor.locator('input[name="scheduledDate"]').locator("xpath=following::button[1]").click();
    await page.getByRole("button", {
      name: new RegExp(scheduledDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })),
    }).click();
    await editor.locator("#task-config-scheduledStartTime").click();
    await page.getByRole("option", { name: "09:00", exact: true }).click();
    await editor.locator("#task-config-scheduledEndTime").click();
    await page.getByRole("option", { name: "09:30", exact: true }).click();

    const patchResponse = page.waitForResponse((candidate) =>
      candidate.url().includes(`/api/tasks/${created.taskId}`) && candidate.request().method() === "PATCH",
    );
    const scheduleResponse = page.waitForResponse((candidate) =>
      candidate.url().includes(`/api/tasks/${created.taskId}/schedule`) && candidate.request().method() === "PUT",
    );
    await editor.getByRole("button", { name: "Save changes" }).click();
    const [patch] = await Promise.all([patchResponse, scheduleResponse]);
    expect(patch.ok()).toBeTruthy();
    expect(JSON.parse(patch.request().postData() ?? "{}")).toEqual({
      title: editedTitle,
      description: "Saved without an AI request",
      priority: "Medium",
    });

    // This lifecycle transition must use the refreshed revision from the save,
    // not a reload that could hide a stale optimistic revision.
    await editor.getByRole("button", { name: "Close task editor" }).click();
    await expect(editor).not.toBeVisible();
    await page.getByRole("button", { name: "Complete task" }).click();
    await expect(page.getByRole("button", { name: "Reopen task" })).toBeVisible();
    await expect(page.getByText(/Needs plan|Start AI/)).toHaveCount(0);
    await page.getByRole("button", { name: "Reopen task" }).click();
    await expect(page.getByRole("button", { name: "Complete task" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Reload separately proves durable field persistence after the immediate
    // save → complete → reopen sequence above.
    await page.reload();
    await openTaskEditor(page);
    const reloadedEditor = page.getByRole("dialog", { name: "Edit task" });
    await expect(reloadedEditor.locator('input[name="title"]').first()).toHaveValue(editedTitle);
    await expect(reloadedEditor.locator('textarea[name="description"]').first()).toHaveValue("Saved without an AI request");
    await expect(reloadedEditor.locator('input[name="dueAt"]').first()).toHaveValue(localDateTimeValue(scheduledDate, 17, 0));
    await expect(reloadedEditor.locator('input[name="scheduledDate"]').first()).toHaveValue(localDateTimeValue(scheduledDate, 0, 0).slice(0, 10));
    await expectNoHorizontalScroll(page);
  });
});
