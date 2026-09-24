import { expect, type Page } from "@playwright/test";

/** Usable content follows the host width, not the old narrow article column. */
export async function expectContentLayout(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector('[data-domain="work-pages"], [data-domain="content-library"]');
    const main = frame?.closest("main");
    if (!frame || !main) return false;
    const style = getComputedStyle(main);
    const available = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.abs(frame.getBoundingClientRect().width - Math.min(1360, available)) < 2
      && document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth;
  })).toBe(true);
}
