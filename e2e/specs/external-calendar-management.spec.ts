import { expect, test } from "@playwright/test";

const EVENT_DAY = "2026-12-12";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}&day=${EVENT_DAY}`;
}

test.describe("external calendar source management", () => {
  test("disables, re-enables, refreshes, renames, and removes a source", async ({ page }, testInfo) => {
    const sourceName = `Managed calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const renamedSourceName = `Renamed calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const eventTitle = `Managed standup ${testInfo.project.name}`;
    await page.goto(`/en/schedule?day=${EVENT_DAY}`);
    await page.getByRole("tab", { name: /calendar/i }).click();
    await page.getByRole("button", { name: /connect calendar/i }).click();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl(eventTitle, sourceName));
    await page.getByRole("button", { name: /connect calendar/i }).click();
    const sourceRow = page.getByRole("listitem").filter({ hasText: sourceName });
    await expect(sourceRow).toBeVisible();

    await sourceRow.getByRole("button", { name: /manage/i }).click();
    const sourceDialog = page.getByRole("dialog").first();
    await expect(sourceDialog).toBeVisible();

    await sourceDialog.getByRole("button", { name: /disable/i }).click();
    await expect(sourceDialog.getByRole("button", { name: /enable/i })).toBeVisible();

    await sourceDialog.getByRole("button", { name: /enable/i }).click();
    await expect(sourceDialog.getByRole("button", { name: /disable/i })).toBeVisible();

    await sourceDialog.getByRole("button", { name: /refresh/i }).click();
    await expect(sourceDialog.getByText(/success|partial/i).first()).toBeVisible();

    await sourceDialog.getByLabel(/display name/i).fill(renamedSourceName);
    await sourceDialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("dialog", { name: renamedSourceName })).toBeVisible();
    const renamedSourceRow = page.getByRole("listitem").filter({ hasText: renamedSourceName });

    await sourceDialog.getByRole("button", { name: /remove/i }).click();
    await expect(sourceDialog.getByText(/remove this calendar source/i)).toBeVisible();
    await sourceDialog.getByRole("button", { name: /remove/i }).click();
    await expect(renamedSourceRow).toHaveCount(0);
  });
});
