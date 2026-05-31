import { expect, test } from "@playwright/test";
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function fixtureUrl() {
  const source = resolve(process.cwd(), "packages/integrations/src/calendar/fixtures/valid.ics");
  const target = join(tmpdir(), `chrona-e2e-${Date.now()}.ics`);
  copyFileSync(source, target);
  return new URL(`file://${target}`).href;
}

test.describe("external calendar source setup", () => {
  test("adds a read-only calendar source and rejects an invalid link", async ({ page }, testInfo) => {
    const sourceName = `Team calendar ${testInfo.project.name}`;
    await page.goto("/en/schedule");
    await page.getByRole("tab", { name: /calendar/i }).click();

    await expect(page.getByRole("heading", { name: /connect external calendar/i })).toBeVisible();
    await expect(page.getByText(/read-only/i).first()).toBeVisible();

    await page.getByLabel(/display name/i).first().fill(sourceName);
    await page.getByLabel(/calendar url/i).fill(fixtureUrl());
    await page.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.locator("article").filter({ hasText: sourceName })).toContainText(/imported events/i);

    await page.getByLabel(/display name/i).first().fill(`Bad calendar ${testInfo.project.name}`);
    await page.getByLabel(/calendar url/i).fill("ftp://example.test/private.ics");
    await page.getByRole("button", { name: /connect calendar/i }).click();
    await expect(page.getByRole("alert")).toContainText(/http|https|file|calendar/i);
  });
});
