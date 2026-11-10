import { test, expect } from "bun:test";
import puppeteer from "puppeteer-core";
import { join } from "node:path";

type Fixture = {
  deliveryAfterTimeout: () => Promise<string[]>;
  deliveryAfterReload: () => Promise<string[]>;
  failureAndStates: () => Promise<string[]>;
  afterFailureReload: () => Promise<string[]>;
  loseContinue: () => Promise<string[]>;
  reconcileAfterReload: () => Promise<string[]>;
  loseOrdinaryMessage: () => Promise<string[]>;
  reconcileOrdinaryAfterReload: () => Promise<string[]>;
};
declare global { interface Window { chatBrowserTest: Fixture } }

// Run under /tmp/chrona-permanent-check.lock; no DB, model, or external service.
test("entry chat preserves failure and reconciles continuation offline across remount and reload", async () => {
  const bundle = await Bun.build({
    entrypoints: [join(import.meta.dir, "src/chat.browser-test.tsx")],
    target: "browser", minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!bundle.success) throw new Error(bundle.logs.join("\n"));
  const script = await bundle.outputs[0]!.text();
  // Compose source styles exactly as build.ts does, without writing generated assets.
  const base = (await Bun.file(join(import.meta.dir, "style.css")).text())
    .split("/* Shared renderer primitives:")[0]!.split("/* Web shell theme:")[0]!.trimEnd();
  const css = [base, await Bun.file(join(import.meta.dir, "src/pages.css")).text(),
    await Bun.file(join(import.meta.dir, "shell.css")).text()].join("\n\n");
  const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="web-shell-app"><main id="main"></main><script type="module" src="/test.js"></script></body></html>';
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/test.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (path === "/style.css") return new Response(css, { headers: { "content-type": "text/css" } });
      if (path !== "/" && !path.startsWith("/sessions/")) return new Response("Not found", { status: 404 });
      return new Response(html, { headers: {
        "content-type": "text/html",
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'",
      } });
    },
  });
  const chrome = process.env.CHRONA_TEST_CHROME ?? "/run/current-system/sw/bin/google-chrome";
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
      "--disable-component-update", "--no-first-run", "--no-default-browser-check",
    ] });
    // One browser and one page at a time: viewport cases deliberately run serially.
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage();
      const errors: string[] = [], external: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.setViewport(viewport);
      await page.setRequestInterception(true);
      page.on("request", request => {
        if (new URL(request.url()).origin !== server.url.origin) {
          external.push(request.url()); void request.abort();
        } else void request.continue();
      });
      try {
        await page.goto(new URL("/sessions/web-agent%3Abrowser-regression", server.url).href);
        await page.waitForFunction(() => "chatBrowserTest" in window);
        const failure = await page.evaluate(() => window.chatBrowserTest.failureAndStates());
        expect(failure).toContain("actual early text is retained and labeled as progress, not completion");
        await page.reload();
        await page.waitForFunction(() => "chatBrowserTest" in window);
        const reloaded = await page.evaluate(() => window.chatBrowserTest.afterFailureReload());
        expect(reloaded).toContain("reload reconstructs failure and continue from persisted service data");
        const lost = await page.evaluate(() => window.chatBrowserTest.loseContinue());
        expect(lost).toContain("double-click submits one request and accepts one run");
        await page.reload();
        await page.waitForFunction(() => "chatBrowserTest" in window);
        const reconciled = await page.evaluate(() => window.chatBrowserTest.reconcileAfterReload());
        expect(reconciled).toContain("remount and reload preserve original runId and requestKey");
        expect(reconciled).toContain("explicit reconciliation retries transport once and creates no second run");
        expect(reconciled).toContain(`active continuation: no document horizontal overflow at ${viewport.width}x${viewport.height}`);
        const ordinaryLost = await page.evaluate(() => window.chatBrowserTest.loseOrdinaryMessage());
        expect(ordinaryLost).toContain("polling never resubmits or reconciles an ordinary message");
        await page.reload();
        await page.waitForFunction(() => "chatBrowserTest" in window);
        const ordinaryReconciled = await page.evaluate(() => window.chatBrowserTest.reconcileOrdinaryAfterReload());
        expect(ordinaryReconciled).toContain("ordinary reload and explicit retries retain the exact persisted request key and session");
        expect(ordinaryReconciled).toContain("ordinary reconciliation recovers one admitted run without sending another message");
        expect(ordinaryReconciled).toContain(`reconciled ordinary admission: no document horizontal overflow at ${viewport.width}x${viewport.height}`);
        const delivered = await page.evaluate(() => window.chatBrowserTest.deliveryAfterTimeout());
        expect(delivered).toContain("read-only delivery polling preserves timeout and never starts a Run");
        await page.reload();
        await page.waitForFunction(() => "chatBrowserTest" in window);
        const deliveryReloaded = await page.evaluate(() => window.chatBrowserTest.deliveryAfterReload());
        expect(deliveryReloaded).toContain("reload reconstructs exact delivery independently of the current Run");
        expect(deliveryReloaded).toContain("mismatched active hash retains unknown page and browser proof");
        expect(errors).toEqual([]);
        expect(external).toEqual([]);
      } catch (error) {
        throw new Error(`Entry chat ${viewport.width}x${viewport.height}: ${(error as Error).message}`, { cause: error });
      } finally { await page.close(); }
    }
  } finally { try { await browser?.close(); } finally { server.stop(true); } }
}, 120_000);
