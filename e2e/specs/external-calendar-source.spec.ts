import { expect, test } from "@playwright/test";

const EVENT_DAY = "2026-06-12";

function fixtureUrl(eventTitle: string, key: string) {
  return `https://calendar-fixtures.test/valid.ics?title=${encodeURIComponent(eventTitle)}&key=${encodeURIComponent(key)}&day=${EVENT_DAY}`;
}

test.describe("external calendar source setup", () => {
  test("adds a read-only calendar source and rejects an invalid link", async ({ page }, testInfo) => {
    const sourceName = `Team calendar ${testInfo.project.name} ${crypto.randomUUID()}`;
    await page.goto("/en/schedule");
    await page.getByRole("tab", { name: /calendar/i }).click();

    await expect(page.getByRole("heading", { name: /connect external calendar/i })).toBeVisible();
    await expect(page.getByText(/read-only/i).first()).toBeVisible();
    await page.getByRole("button", { name: /connect calendar/i }).click();
    const connectDialog = page.getByRole("dialog", { name: /connect external calendar/i });

    await connectDialog.getByLabel(/display name/i).fill(sourceName);
    await connectDialog.getByLabel(/calendar url/i).fill(fixtureUrl(`External standup ${testInfo.project.name}`, sourceName));
    await connectDialog.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.getByRole("listitem").filter({ hasText: sourceName })).toBeVisible();

    await expect(connectDialog).not.toBeVisible();
    await page.getByLabel("Calendar", { exact: true }).getByRole("button", { name: /connect calendar/i }).click();
    const invalidDialog = page.getByRole("dialog", { name: /connect external calendar/i });
    await invalidDialog.getByLabel(/display name/i).fill(`Bad calendar ${testInfo.project.name}`);
    await invalidDialog.getByLabel(/calendar url/i).fill("ftp://example.test/private.ics");
    await invalidDialog.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.getByRole("alert")).toContainText(/https|calendar/i);
  });
});
