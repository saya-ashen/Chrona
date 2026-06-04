import { expect, test } from "@playwright/test";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}`;
}

test.describe("external calendar events on schedule", () => {
  test("shows imported calendar tasks on desktop, tablet, and mobile", async ({ page }, testInfo) => {
    const sourceName = `Planning calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    const eventTitle = `External standup ${testInfo.project.name}`;
    await page.goto("/en/schedule?day=2026-05-04");
    await page.getByRole("tab", { name: /calendar/i }).click();
    await page.getByRole("button", { name: /connect calendar/i }).click();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl(eventTitle, sourceName));
    await page.getByRole("button", { name: /connect calendar/i }).click();
    const sourceRow = page.locator("article").filter({ hasText: sourceName });
    await expect(sourceRow).toContainText(/imported events/i);
    await expect(sourceRow).toContainText("1");

    await page.goto("/en/schedule?day=2026-05-04");

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByText(eventTitle).first()).toBeVisible();
      await expect(page.getByText(/Read-only/)).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    }
  });
});
