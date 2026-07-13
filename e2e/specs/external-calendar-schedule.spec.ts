import { expect, test } from "@playwright/test";

const EVENT_DAY = "2026-12-12";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}&day=${EVENT_DAY}`;
}

test.describe("external calendar events on schedule", () => {
  test("shows imported calendar tasks", async ({ page }, testInfo) => {
    const sourceName = `Planning calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const eventTitle = `External standup ${testInfo.project.name}`;
    await page.goto(`/en/schedule?day=${EVENT_DAY}`);
    await page.getByRole("tab", { name: /calendar/i }).click();
    await page.getByRole("button", { name: /connect calendar/i }).click();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl(eventTitle, sourceName));
    await page.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.getByRole("listitem").filter({ hasText: sourceName })).toBeVisible();
    await page.goto(`/en/schedule?day=${EVENT_DAY}`);

    await expect(page.getByText(eventTitle).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
