// Run with Bun; local fixture only, no service, model, or external network.
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { PAGE } from "./page";
import { expandComponents } from "../web/composition";
const registered = { ...PAGE, module: "coding-web", spec: expandComponents(PAGE.spec, PAGE.components, "coding-web"), keyed: ["ui-command", "ui-receipt"], needs: { detail: ["session-id"] } };
const bundle = await Bun.build({ entrypoints: [join(import.meta.dirname, "browser-fixture.tsx")], target: "browser", format: "esm", define: { REGISTERED_PAGE: JSON.stringify(registered) } });
if (!bundle.success) throw new Error(bundle.logs.join("\n"));
const script = await bundle.outputs[0]!.text();
const web = join(import.meta.dirname, "../web");
const css = (await Promise.all(["style.css", "shell.css", "src/pages.css"].map(p => Bun.file(join(web, p)).text()))).join("\n");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/app.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
  if (path === "/style.css") return new Response(css, { headers: { "content-type": "text/css" } });
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main></main><script type="module" src="/app.js"></script></html>', { headers: { "content-type": "text/html" } });
} });
const executablePath = process.env.CHRONA_TEST_CHROME ?? ["/run/current-system/sw/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  if (!executablePath) throw new Error("Set CHRONA_TEST_CHROME to a local Chromium executable.");
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run"] });
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(String(error)); console.error(String(error)); });
    await page.setViewport({ width: width!, height: height! });
    await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" });
    await page.waitForFunction("window.codingWebTest", { timeout: 5000 });
    const checks = await page.evaluate("window.codingWebTest.run()") as string[];
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport: `${width}x${height}`, checks }));
    await page.close();
  }
  const left = await browser.newPage(), right = await browser.newPage();
  for (const page of [left, right]) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" });
    await page.waitForFunction("window.codingWebTest", { timeout: 5000 });
  }
  await left.bringToFront();
  await left.evaluate('window.codingWebTest.choose("示例项目", "修复测试", "左侧草稿")');
  await right.bringToFront();
  await right.evaluate('window.codingWebTest.choose("另一项目", "另一对话", "右侧草稿")');
  assert.deepEqual(await left.evaluate("window.codingWebTest.selection()"), { project: "p1", session: "s1", draft: "左侧草稿" });
  assert.deepEqual(await right.evaluate("window.codingWebTest.selection()"), { project: "p2", session: "s2", draft: "右侧草稿" });
  console.log(JSON.stringify({ checks: ["two browser pages keep independent projects, conversations and drafts"] }));
  await left.close(); await right.close();
} finally { await browser?.close(); server.stop(true); }
