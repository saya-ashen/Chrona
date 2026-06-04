import { expect, test } from "@playwright/test";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}`;
}

test.describe("external calendar source management", () => {
  test("disables, re-enables, refreshes, renames, and removes a source", async ({ page }, testInfo) => {
    const sourceName = `Managed calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const renamedSourceName = `Renamed calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const eventTitle = `Managed standup ${testInfo.project.name}`;
    await page.goto("/en/schedule?day=2026-05-04");
    await page.getByRole("tab", { name: /calendar/i }).click();
    await page.getByRole("button", { name: /connect calendar/i }).click();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl(eventTitle, sourceName));
    await page.getByRole("button", { name: /connect calendar/i }).click();
    const sourceRow = page.locator("article").filter({ hasText: sourceName });
    await expect(sourceRow).toBeVisible();

    await sourceRow.getByRole("button", { name: /disable/i }).click();
    await expect(sourceRow.getByRole("button", { name: /enable/i })).toBeVisible();

    await sourceRow.getByRole("button", { name: /enable/i }).click();
    await expect(sourceRow.getByRole("button", { name: /disable/i })).toBeVisible();

    await sourceRow.getByRole("button", { name: /refresh/i }).click();
    await expect(sourceRow.getByText(/success|partial/i).first()).toBeVisible();

    await sourceRow.getByLabel(/display name/i).fill(renamedSourceName);
    await sourceRow.getByRole("button", { name: /save changes/i }).click();
    const renamedSourceRow = page.locator("article").filter({ hasText: renamedSourceName });
    await expect(renamedSourceRow).toBeVisible();

    await renamedSourceRow.getByRole("button", { name: /remove/i }).click();
    await expect(renamedSourceRow.getByText(/remove this calendar source/i)).toBeVisible();
    await renamedSourceRow.getByRole("button", { name: /remove/i }).click();
    await expect(renamedSourceRow).toHaveCount(0);
  });
});
