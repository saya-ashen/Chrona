// Run: bun packages/engine/src/modules/steward/external/web/shell.browser-test.ts
// Isolated HTTP/browser integration: no running Chrona service, database or model calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import puppeteer, { type Page as BrowserPage } from "puppeteer-core";
import { expandComponents } from "./composition";

const directory = import.meta.dir;
const csp = "default-src 'self'; img-src 'self' blob: data:; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const read = (path: string) => Bun.file(join(directory, path)).text();
const bundle = await Bun.build({ entrypoints: [join(directory, "src/pages.tsx")], target: "browser", minify: true });
assert(bundle.success, bundle.logs.map(String).join("\n"));
const [index, app, base, primitives, shell, pages] = await Promise.all([
  read("index.html"), read("app.js"), read("style.css"), read("src/pages.css"), read("shell.css"), bundle.outputs[0]!.text(),
]);
const style = `${base.split("/* Shared renderer primitives:")[0]!.split("/* Web shell theme:")[0]}\n${primitives}\n${shell}`;
const emptyToday = { approvals: [], problems: [], upcoming: [], updates: [], apps: [], sessions: [] };
const settings = { settings: { timezone: "Asia/Shanghai", moduleModel: null } };
const fixtureApp = { id: "fixture-id", name: "fixture", status: "active", activeHash: "active", origin: "external", capabilities: {}, health: {} };
const links: { module: string; moduleId: string; id: string; title: string; purpose?: "settings" }[] = [
  ...["document", "workspace"].map(id => ({ module: "fixture", moduleId: "fixture-id", id, title: id === "document" ? "文档应用" : "编码工作台" })),
  { module: "fixture", moduleId: "fixture-id", id: "preferences", title: "应用偏好", purpose: "settings" },
];
function registered(id: string) {
  const documentSpec = { root: "doc", elements: {
    doc: { type: "fixture:Document", props: { title: "文档应用内容" }, children: ["body", "action"] },
    body: { type: "Text", props: { text: "模块注册的普通文档页" } },
    action: { type: "Button", props: { label: "调用应用操作" }, on: { press: { action: "call", params: { tool: "ping", reload: false } } } },
  } };
  const workspaceSpec = { root: "workspace", state: { draft: "" }, elements: {
    workspace: { type: "Workspace", props: { title: "编码工作台", description: "把想法交代清楚，把成果带回来。", mobileSidebarOpen: false }, slots: { sidebar: ["side"] }, children: ["title", "scroll", "composer"] },
    side: { type: "Heading", props: { text: "最近工作" } },
    title: { type: "WorkspaceHeader", props: { title: "工作区内容", status: "进行中" } },
    scroll: { type: "ScrollArea", props: { label: "工作进展" }, children: ["message"] },
    message: { type: "Message", props: { author: "助手" }, children: ["body"] },
    body: { type: "Markdown", props: { content: "当前工作已准备好。\n\n" + "响应式工作区内容。\n\n".repeat(30) } },
    composer: { type: "Composer", props: { hint: "继续补充" }, children: ["draft"] },
    draft: { type: "Textarea", props: { name: "draft", label: "继续补充", rows: 2, value: { $bindState: "/draft" } } },
  } };
  return { module: "fixture", moduleId: "fixture-id", ...(id === "preferences" ? { purpose: "settings" } : {}), id, title: id, revision: 1, layout: id === "workspace" ? "workspace" : "document", data: {}, spec: expandComponents(id === "workspace" ? workspaceSpec : documentSpec, { "fixture:Document": { props: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }, slots: ["default"], spec: { root: "doc", elements: { doc: { type: "Stack", props: {}, children: ["title", "$slot:default"] }, title: { type: "Heading", props: { text: { $prop: "title" } } } } } } }, "fixture") };
}
let expired = false, delayed: (() => void) | undefined, delayedUnauthorized: (() => void) | undefined;
type ScopedCall = { target: string; page?: { module: string; id: string; revision: number } };
const calls: ScopedCall[] = [];
const unexpected: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  // eslint-disable-next-line complexity -- The mock routes mirror the public HTTP boundary in one place.
  async fetch(request) {
  const url = new URL(request.url), path = url.pathname;
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (path === "/app.js") return new Response(app, { headers: { "content-type": "text/javascript" } });
  if (path === "/pages.js") return new Response(pages, { headers: { "content-type": "text/javascript" } });
  if (path === "/style.css") return new Response(style, { headers: { "content-type": "text/css" } });
  if (!path.startsWith("/api/web")) return new Response(index, { headers: { "content-type": "text/html", "content-security-policy": csp } });
  if (expired || request.headers.get("authorization") !== "Bearer fixture-key") return json({ message: "Unauthorized" }, 401);
  const endpoint = path.slice("/api/web".length);
  if (endpoint === "/events") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": connected\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
  if (endpoint === "/pages") return json(links);
  if (endpoint === "/pages/fixture/slow") { await new Promise<void>(resolve => { delayed = resolve; }); return json(registered("workspace")); }
  if (endpoint === "/pages/fixture/broken") return json({ message: "受控页面故障" }, 500);
  if (endpoint === "/pages/fixture/old-session") { await new Promise<void>(resolve => { delayedUnauthorized = resolve; }); return json({ message: "old session expired" }, 401); }
  if (endpoint.startsWith("/pages/fixture/")) return json(registered(endpoint.split("/").at(-1)!));
  if (endpoint === "/today") return json(emptyToday);
  if (endpoint === "/modules") return json([fixtureApp, { ...fixtureApp, id: "paused", name: "已暂停的应用", status: "paused" }, { ...fixtureApp, id: "unregistered", name: "未登记的应用" }]);
  if (["/runs", "/system-apps", "/catalog", "/credentials", "/sessions", "/tools"].includes(endpoint)) return json([]);
  if (endpoint === "/settings") return json(settings);
  if (endpoint === "/activity") return json({ items: [], before: null });
  if (endpoint === "/modules/fixture-id/overview") return json({ app: fixtureApp });
  if (endpoint === "/modules/agent/overview") return json({ description: "系统能力内容", work: [], tools: [], activity: [], settings: { values: {} } });
  if (endpoint === "/modules/missing/overview") return json({ app: null });
  if (endpoint === "/call") { calls.push(await request.json() as ScopedCall); return json({ ok: true }); }
  unexpected.push(`${request.method} ${endpoint}`); return json({ message: "Unexpected fixture request" }, 500);
} });
const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
assert(chrome, "Set CHRONA_TEST_CHROME to a Chrome/Chromium executable");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const failures: string[] = [], checks: string[] = [];
async function text(page: BrowserPage, value: string) {
  await page.waitForFunction(expected => document.querySelector("main")?.textContent.includes(expected), {}, value);
}
async function capture(page: BrowserPage, name: string) {
  const output = process.env.CHRONA_SHELL_SCREENSHOTS;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, `${name}.png`) });
}
async function navigate(page: BrowserPage, path: string, expected: string) {
  await page.evaluate(href => { const anchor = document.createElement("a"); anchor.href = href; document.body.append(anchor); anchor.click(); anchor.remove(); }, path);
  await text(page, expected);
}
async function geometry(page: BrowserPage, workspace: boolean, label: string) {
  const result = await page.evaluate(() => {
    const main = document.querySelector("body > main")!, header = document.querySelector("body > header")!;
    const area = document.querySelector(".renderer-workspace"), input = document.querySelector("textarea");
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, mainLeft: main.getBoundingClientRect().left, headerRight: header.getBoundingClientRect().right, workspaceLeft: area?.getBoundingClientRect().left, inputBottom: input?.getBoundingClientRect().bottom, classes: document.body.className, bg: getComputedStyle(document.body).backgroundColor, accent: getComputedStyle(document.body).getPropertyValue("--accent").trim(), active: Array.from(document.querySelectorAll('header a[aria-current="page"]')).map(a => a.getAttribute("href")) };
  });
  assert(result.scrollWidth <= result.width, `${label}: horizontal overflow ${JSON.stringify(result)}`);
  assert(result.classes.includes("web-shell-app"), `${label}: authenticated shell`);
  assert.equal(result.classes.includes("web-shell-workspace"), workspace, `${label}: explicit layout`);
  if (workspace) {
    assert(result.inputBottom! <= result.height + 1, `${label}: composer visible ${JSON.stringify(result)}`);
    assert(result.scrollHeight <= result.height + 1, `${label}: workspace fits viewport`);
    if (result.width > 700) assert(Math.abs(result.workspaceLeft! - result.headerRight) <= 1, `${label}: single rail offset ${JSON.stringify(result)}`);
  }
  checks.push(label);
  return result;
}
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await browser.newPage();
    page.on("pageerror", error => failures.push(String(error)));
    page.on("console", message => { if (message.type() === "error" && message.text().includes("Content Security Policy")) failures.push(message.text()); });
    await page.setViewport({ width: width!, height: height! });
    await page.goto(server.url.href + "today");
    await page.waitForSelector('input[name="key"]');
    assert(await page.$eval("body", body => body.classList.contains("web-shell-login")));
    assert(await page.$eval("header nav", nav => (nav as HTMLElement).hidden));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: login has no horizontal overflow`);
    await page.type('input[name="key"]', "wrong-key"); await page.click('form button.primary');
    await text(page, "密钥不正确");
    await page.$eval('input[name="key"]', input => { (input as HTMLInputElement).value = ""; });
    await page.type('input[name="key"]', "fixture-key"); await page.click('form button.primary');
    await text(page, "没有待处理的事项");
    const today = await geometry(page, false, `${width}: Today`);
    await page.waitForSelector('header a[data-page]');
    assert.deepEqual(today.active, ["/today"]);
    await capture(page, `today-${width}`);
    for (const [path, expected, current] of [["/chat", "新会话", "/chat"], ["/apps", "应用", "/apps"], ["/apps/missing", "没有这个应用", "/apps"], ["/apps/system/agent", "系统能力内容", "/apps"], ["/activity", "活动", "/activity"], ["/settings", "保存内核额度", "/settings"]]) {
      await navigate(page, path!, expected!);
      const state = await geometry(page, false, `${width}: ${path}`);
      assert.deepEqual(state.active, [current]); assert.equal(state.accent, today.accent); assert.equal(state.bg, today.bg);
      if (path === "/settings") await capture(page, `settings-${width}`);
    }
    await navigate(page, "/apps/fixture-id", "打开设置");
    await page.waitForSelector('main nav[aria-label="应用标签"] a[href="/apps/fixture-id?tab=settings"]');
    await page.click('main nav[aria-label="应用标签"] a[href="/apps/fixture-id?tab=settings"]');
    await text(page, "文档应用内容");
    await page.waitForSelector('main nav[aria-label="应用标签"] a[aria-current="page"][href="/apps/fixture-id?tab=settings"]');
    assert.equal(await page.$$('main .registered-page .registered-page').then(nodes => nodes.length), 1);
    assert.equal(await page.$$('main iframe').then(nodes => nodes.length), 0);
    await geometry(page, false, `${width}: app settings`);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/apps/fixture-id?tab=settings");
    await capture(page, `app-settings-${width}`);
    await navigate(page, "/settings", "保存内核额度");
    await text(page, "恢复后可打开设置"); await text(page, "尚未登记设置页面");
    await page.click('main a[href="/apps/fixture-id?tab=settings"]'); await text(page, "文档应用内容");
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/apps/fixture-id?tab=settings");
    await navigate(page, "/p/fixture/document", "文档应用内容");
    await page.waitForSelector('header a[href="/p/fixture/document"][aria-current="page"]');
    await geometry(page, false, `${width}: registered document`);
    await capture(page, `document-${width}`);
    assert.equal(await page.$eval('main a[aria-label="应用设置"]', a => a.getAttribute("href")), "/apps/fixture-id?tab=settings");
    await page.evaluate(() => Array.from(document.querySelectorAll("main button")).find(button => button.textContent === "调用应用操作")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForFunction(() => !document.querySelector("main button[disabled]"));
    await navigate(page, "/p/fixture/workspace", "工作区内容");
    await page.waitForSelector("textarea");
    await geometry(page, true, `${width}: registered workspace`);
    await capture(page, `workspace-${width}`);
    await navigate(page, "/today", "没有待处理的事项");
    await geometry(page, false, `${width}: workspace → Today`);
    await page.goBack(); await text(page, "工作区内容"); await geometry(page, true, `${width}: history restores workspace`);
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    const dark = await geometry(page, true, `${width}: dark workspace`); assert.notEqual(dark.bg, today.bg);
    await navigate(page, "/settings", "保存内核额度");
    assert.equal((await geometry(page, false, `${width}: dark settings`)).bg, dark.bg);
    await navigate(page, "/p/fixture/broken", "受控页面故障");
    await geometry(page, false, `${width}: system error shell`);
    await page.click("#logout"); await page.waitForSelector('input[name="key"]');
    assert.equal(await page.$$eval("header a[data-page]", nodes => nodes.length), 0);
    assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
    await page.close();
  }
  // Stale registered-page responses cannot replace the next route or reapply workspace layout.
  const page = await browser.newPage();
  page.on("pageerror", error => failures.push(String(error)));
    page.on("console", message => { if (message.type() === "error" && message.text().includes("Content Security Policy")) failures.push(message.text()); });
  await page.goto(server.url.href);
  await page.evaluate(() => localStorage.setItem("chrona.accessKey", "fixture-key")); await page.reload(); await text(page, "没有待处理的事项");
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "/p/fixture/slow"; document.body.append(a); a.click(); a.remove(); });
  await page.waitForResponse(response => response.url().endsWith("/api/web/pages"));
  await navigate(page, "/settings", "保存内核额度");
  assert(delayed, "slow page request started"); delayed();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert(await page.$eval("body", body => !body.classList.contains("web-shell-workspace")));
  await text(page, "保存内核额度"); checks.push("stale route response ignored");
  links.push({ module: "fixture", moduleId: "fixture-id", id: "added", title: "动态应用" });
  await navigate(page, "/p/fixture/added", "文档应用内容");
  await page.waitForSelector('header a[href="/p/fixture/added"][aria-current="page"]'); checks.push("dynamic registered link becomes active");
  expired = true; await navigate(page, "/today", "密钥不正确");
  assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
  assert.equal(await page.$$eval("header a[data-page]", nodes => nodes.length), 0); checks.push("401 clears authenticated shell and app links");
  expired = false; await page.type('input[name="key"]', "fixture-key"); await page.click('form button.primary'); await text(page, "没有待处理的事项");
  await page.waitForSelector('header a[data-page]'); checks.push("relogin restores shell and links");
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "/p/fixture/old-session"; document.body.append(a); a.click(); a.remove(); });
  await page.waitForResponse(response => response.url().endsWith("/api/web/pages"));
  await page.click("#logout"); await page.waitForSelector('input[name="key"]');
  await page.evaluate(() => history.replaceState(null, "", "/today"));
  await page.type('input[name="key"]', "fixture-key"); await page.click('form button.primary');
  await text(page, "没有待处理的事项");
  assert(delayedUnauthorized, "old session request started");
  const oldResponse = page.waitForResponse(response => response.url().endsWith("/api/web/pages/fixture/old-session") && response.status() === 401);
  delayedUnauthorized(); await oldResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert(await page.$eval("body", body => body.classList.contains("web-shell-app")));
  assert.equal(await page.evaluate(() => localStorage.getItem("chrona.accessKey")), "fixture-key");
  await text(page, "没有待处理的事项"); checks.push("old session 401 cannot clear a new login");
  assert(calls.some(call => call.target === "fixture.ping" && call.page?.module === "fixture" && call.page.id === "document" && call.page.revision === 1), "registered calls retain module/page scope");
  assert.deepEqual(unexpected, []); assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await browser.close(); server.stop(true); }
