import { test, expect } from "bun:test";
import puppeteer from "puppeteer-core";
import { join } from "node:path";

test("inline settings retains app lifecycle, authority and store isolation", async () => {
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "src/settings-inline.browser.test.tsx")], target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
  expect(bundle.success).toBe(true);
  const script = await bundle.outputs[0]!.text();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => new URL(request.url).pathname === "/test.js"
    ? new Response(script, { headers: { "content-type": "text/javascript" } })
    : new Response('<!doctype html><html lang="zh"><body><script type="module" src="/test.js"></script></body></html>', { headers: { "content-type": "text/html" } }) });
  const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
  if (!chrome) { server.stop(true); throw new Error("Set CHRONA_TEST_CHROME to a Chrome/Chromium executable"); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(server.url.href);
    await page.waitForFunction(() => "inlineSettingsTest" in window);
    const checks = await page.evaluate(() => (window as unknown as { inlineSettingsTest: { run: () => Promise<string[]> } }).inlineSettingsTest.run());
    expect(checks.length).toBeGreaterThanOrEqual(18);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 60000);
