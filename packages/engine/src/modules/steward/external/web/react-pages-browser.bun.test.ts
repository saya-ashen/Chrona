import { expect, test } from "bun:test";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

test("React queries and workspace preserve independent loading, drafts, focus and reading position", async () => {
  const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
  if (!chrome) throw new Error("Set CHRONA_TEST_CHROME to a Chrome/Chromium executable");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const styles = await Promise.all(["src/base.css", "src/pages.css", "shell.css"].map(path => Bun.file(join(import.meta.dir, path)).text()));
  try {
    for (const [entry, name, minimum] of [["workspace", "workspaceTest", 30], ["pages-loading", "pageLoadingTest", 4]] as const) {
      const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, `src/${entry}.browser-test.tsx`)], target: "browser", minify: true,
        define: { "process.env.NODE_ENV": '"production"' } });
      if (!bundle.success) throw new AggregateError(bundle.logs, "Browser fixture build failed");
      const script = await bundle.outputs[0]!.text();
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/test.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
        if (path === "/style.css") return new Response(styles.join("\n"), { headers: { "content-type": "text/css" } });
        return new Response('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main></main><script type="module" src="/test.js"></script></body></html>', { headers: { "content-type": "text/html" } });
      } });
      try {
        for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
          const page = await browser.newPage(), errors: string[] = [];
          page.on("pageerror", error => errors.push(String(error)));
          try {
            await page.setViewport(viewport); await page.goto(server.url.href);
            await page.waitForFunction(name => name in window, {}, name);
            const checks = await page.evaluate(name => (window as unknown as Record<string, { run: () => Promise<string[]> }>)[name]!.run(), name);
            expect(checks.length).toBeGreaterThanOrEqual(minimum);
            expect(errors).toEqual([]);
          } finally { await page.close(); }
        }
      } finally { server.stop(true); }
    }
  } finally { await browser.close(); }
}, 60_000);
