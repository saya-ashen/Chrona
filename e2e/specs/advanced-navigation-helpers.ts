import { expect, type Page } from "@playwright/test";

/** Advanced task controls remain available, but are no longer the primary New page action. */
export async function openMoreTools(page: Page, label = "More tools") {
  await expect(page.locator(".chrona-app-main")).toBeVisible();
  const summary = page.locator("summary").filter({ hasText: label });
  const button = page.getByRole("button", { name: label, exact: true });
  // URL can update before the localized shell is committed. Wait for either
  // real navigation control before choosing desktop versus mobile behavior.
  await expect(summary.or(button).filter({ visible: true }).first()).toBeVisible();
  if (await summary.isVisible()) {
    const details = summary.locator("..");
    if (await details.getAttribute("open") === null) { await summary.focus(); await page.keyboard.press("Enter"); }
  } else {
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
  }
}
export async function openAdvancedTaskCreation(page: Page) {
  await openMoreTools(page);
  const item = page.getByRole("menuitem", { name: "New Task", exact: true });
  if (await item.isVisible()) await item.click();
  else await page.getByRole("button", { name: "New Task", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
