import { expect, test } from "@playwright/test";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}`;
}

test.describe("external calendar source setup", () => {
  test("adds a read-only calendar source and rejects an invalid link", async ({ page }, testInfo) => {
    const sourceName = `Team calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    await page.goto("/en/schedule");
    await page.getByRole("tab", { name: /calendar/i }).click();

    await expect(page.getByRole("heading", { name: /connect external calendar/i })).toBeVisible();
    await expect(page.getByText(/read-only/i).first()).toBeVisible();
    await page.getByRole("button", { name: /connect calendar/i }).click();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl(`External standup ${testInfo.project.name}`, sourceName));
    await page.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.locator("article").filter({ hasText: sourceName })).toContainText(/imported events/i);

    await page.getByLabel(/display name/i).first().fill(`Bad calendar ${testInfo.project.name}`);
    await page.getByLabel(/calendar url/i).fill("ftp://example.test/private.ics");
    await page.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.getByRole("alert")).toContainText(/https|calendar/i);
  });
});
