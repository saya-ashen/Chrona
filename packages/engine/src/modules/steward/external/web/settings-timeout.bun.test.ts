import { test, expect } from "bun:test";
import puppeteer from "puppeteer-core";
import { join } from "node:path";

test("global Settings saves and clears the optional task timeout across viewports", async () => {
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "src/settings-timeout.browser.test.tsx")], target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
  expect(bundle.success).toBe(true);
  const [script, base, primitives, shell] = await Promise.all([
    bundle.outputs[0]!.text(), Bun.file(join(import.meta.dir, "style.css")).text(),
    Bun.file(join(import.meta.dir, "src/pages.css")).text(), Bun.file(join(import.meta.dir, "shell.css")).text(),
  ]);
  const style = `${base.split("/* Shared renderer primitives:")[0]!.split("/* Web shell theme:")[0]}\n${primitives}\n${shell}`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === "/test.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/style.css") return new Response(style, { headers: { "content-type": "text/css" } });
    return new Response('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><script type="module" src="/test.js"></script></body></html>', { headers: { "content-type": "text/html" } });
  } });
  const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
  if (!chrome) { server.stop(true); throw new Error("Set CHRONA_TEST_CHROME to a Chrome/Chromium executable"); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      try {
        await page.setViewport(viewport);
        await page.goto(server.url.href);
        await page.waitForFunction(() => "timeoutSettingsTest" in window);
        const checks = await page.evaluate(() => (window as unknown as { timeoutSettingsTest: { run: () => Promise<string[]> } }).timeoutSettingsTest.run());
        expect(checks.length).toBe(19);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); server.stop(true); }
}, 60000);
