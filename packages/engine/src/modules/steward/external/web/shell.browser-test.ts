// Run: bun packages/engine/src/modules/steward/external/web/shell.browser-test.ts
// Isolated HTTP/browser integration: no running Chrona service, database or model calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import puppeteer, { type BrowserContext, type Page as BrowserPage } from "puppeteer-core";
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
  { module: "chat", moduleId: "chat-id", id: "main", title: "Chat" },
  { module: "chat", moduleId: "chat-id", id: "main", title: "重复的 Chat 主页面" },
  ...["document", "workspace"].map(id => ({ module: "fixture", moduleId: "fixture-id", id, title: id === "document" ? "文档应用" : "编码工作台" })),
  { module: "fixture", moduleId: "fixture-id", id: "preferences", title: "应用偏好", purpose: "settings" },
];
function registered(id: string) {
  if (id === "chat") return { module: "chat", moduleId: "chat-id", id: "main", title: "Chat", revision: 1, layout: "document", data: {}, spec: { root: "chat", elements: { chat: { type: "Text", props: { text: "Chat 应用内容" } } } } };
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
const initialPassword = "fixture-password", changedPassword = "changed-password";
let password: string | null = initialPassword, canSetup = true, statusFailure = false;
let nextSession = 0;
const sessions = new Set<string>();
const authRequests: { endpoint: string; body: Record<string, unknown>; authorization: string | null }[] = [];
const webRequests: { endpoint: string; cookie: string | null; authorization: string | null }[] = [];
let expired = false, delayed: (() => void) | undefined, delayedUnauthorized: (() => void) | undefined;
type ScopedCall = { target: string; page?: { module: string; id: string; revision: number } };
const calls: ScopedCall[] = [];
const unexpected: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  // eslint-disable-next-line complexity, max-statements -- The mock routes mirror the public HTTP boundary in one place.
  async fetch(request) {
  const url = new URL(request.url), path = url.pathname;
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (path === "/app.js") return new Response(app, { headers: { "content-type": "text/javascript" } });
  if (path === "/pages.js") return new Response(pages, { headers: { "content-type": "text/javascript" } });
  if (path === "/style.css") return new Response(style, { headers: { "content-type": "text/css" } });
  const sessionId = request.headers.get("cookie")?.match(/(?:^|; )fixture_session=([^;]+)/)?.[1];
  const authenticated = !!sessionId && sessions.has(sessionId) && !expired;
  const authStatus = () => ({ passwordSet: password !== null, authenticated, canSetup: password === null && (canSetup || request.headers.get("authorization") === "Bearer fixture-key") });
  const sessionResponse = () => {
    const id = `session-${++nextSession}`; sessions.add(id);
    return Response.json({ ok: true }, { headers: { "set-cookie": `fixture_session=${id}; HttpOnly; SameSite=Strict; Path=/` } });
  };
  if (path.startsWith("/api/auth/")) {
    const endpoint = path.slice("/api/auth".length), body = request.method === "POST" ? await request.json() as Record<string, unknown> : {};
    authRequests.push({ endpoint, body, authorization: request.headers.get("authorization") });
    if (endpoint === "/status" && request.method === "GET") return statusFailure ? json({ message: "认证状态读取失败" }, 503) : json(authStatus());
    if (endpoint === "/logout" && request.method === "POST") {
      if (sessionId) sessions.delete(sessionId);
      return Response.json({ ok: true }, { headers: { "set-cookie": "fixture_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" } });
    }
    if (endpoint === "/login" && request.method === "POST") return password !== null && body.password === password ? sessionResponse() : json({ message: "密码不正确" }, 401);
    if (endpoint === "/setup" && request.method === "POST") {
      if (!authStatus().canSetup) return json({ message: "需要原访问授权" }, 403);
      if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 256) return json({ message: "密码长度应为 10–256 个字符" }, 400);
      password = body.password; return sessionResponse();
    }
    if (endpoint === "/password" && request.method === "POST") {
      if (!authenticated || body.currentPassword !== password) return json({ message: "当前密码不正确" }, 401);
      if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 256) return json({ message: "密码长度应为 10–256 个字符" }, 400);
      password = body.password; sessions.clear();
      return sessionResponse();
    }
    unexpected.push(`${request.method} ${path}`); return json({ message: "Unexpected auth request" }, 500);
  }
  if (!path.startsWith("/api/web")) return new Response(index, { headers: { "content-type": "text/html", "content-security-policy": csp } });
  const endpoint = path.slice("/api/web".length);
  webRequests.push({ endpoint, cookie: request.headers.get("cookie"), authorization: request.headers.get("authorization") });
  if (!authenticated) return json({ message: "Unauthorized" }, 401);
  if (endpoint === "/events") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": connected\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
  if (endpoint === "/pages") return json(links);
  if (endpoint === "/pages/chat/main") return json(registered("chat"));
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
  try { await page.waitForFunction(expected => document.querySelector("main")?.textContent.includes(expected), {}, value); }
  catch (error) { throw new Error(`Expected ${value}; visible: ${await page.$eval("main", main => main.textContent)}`, { cause: error }); }
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
async function fill(page: BrowserPage, name: string, value: string) {
  const selector = `input[name="${name}"]`;
  await page.waitForSelector(selector);
  await page.waitForFunction(selector => !document.querySelector<HTMLInputElement>(selector)?.disabled, {}, selector);
  await page.focus(selector); await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
  await page.type(selector, value);
}
async function submitPassword(page: BrowserPage) {
  await page.$eval('input[name="password"]', input => (input as HTMLInputElement).form!.requestSubmit());
}
async function signIn(page: BrowserPage, value: string) {
  await fill(page, "password", value); await submitPassword(page); await text(page, "没有待处理的事项");
}
async function noStoredCredentials(page: BrowserPage) {
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).filter(([key, value]) => /password|accessKey/i.test(key) || ["fixture-key", "fixture-password", "changed-password"].includes(value))), []);
  assert.equal(await page.evaluate(() => document.cookie.includes("fixture_session")), false, "session cookie is HttpOnly");
}
async function failedStatus() {
  // A failed status request must leave the browser in the unauthenticated shell.
  const context = await browser.createBrowserContext(), page = await context.newPage();
  statusFailure = true;
  const webCount = webRequests.length;
  await page.goto(server.url.href + "today"); await text(page, "认证状态读取失败");
  assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
  assert.equal(webRequests.length, webCount, "failed auth status cannot start protected requests");
  statusFailure = false;
  await page.click("main button"); await page.waitForSelector('input[name="password"]');
  assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
  assert.equal(webRequests.length, webCount, "retry loads login without issuing protected requests");
  await page.evaluate(() => localStorage.setItem("chrona.accessKey", "fixture-key"));
  const statusStart = authRequests.length;
  await page.reload(); await page.waitForSelector('input[name="password"]'); await noStoredCredentials(page);
  assert(authRequests.slice(statusStart).every(request => request.authorization === null), "an existing password removes the legacy key without sending it");
  await context.close(); checks.push("status failure stays unauthenticated and supports retry");

}
async function firstSetup() {
  // First setup validates confirmation/length before creating a cookie session.
  password = null; canSetup = true; sessions.clear();
  const setupContext = await browser.createBrowserContext(), setup = await setupContext.newPage();
  await setup.goto(server.url.href + "today"); await setup.waitForSelector('input[name="confirmPassword"]');
  for (const name of ["password", "confirmPassword"]) {
    assert.equal(await setup.$eval(`input[name="${name}"]`, input => (input as HTMLInputElement).autocomplete), "new-password");
  }
  assert.equal(await setup.$eval('input[name="password"]', input => (input as HTMLInputElement).minLength), 10);
  assert.equal(await setup.$eval('input[name="password"]', input => (input as HTMLInputElement).maxLength), 256);
  const setupCount = () => authRequests.filter(request => request.endpoint === "/setup").length;
  const beforeSetup = setupCount();
  await fill(setup, "password", "short"); await fill(setup, "confirmPassword", "short"); await submitPassword(setup);
  assert.equal(await setup.$eval('input[name="password"]', input => (input as HTMLInputElement).checkValidity()), false);
  assert.equal(setupCount(), beforeSetup, "short password is rejected before setup request");
  await setup.$$eval('input[type="password"]', inputs => { for (const input of inputs) (input as HTMLInputElement).value = "x".repeat(257); });
  await submitPassword(setup); await text(setup, "10–256");
  assert.equal(setupCount(), beforeSetup, "overlong password is rejected before setup request");
  await fill(setup, "password", initialPassword); await fill(setup, "confirmPassword", "different-password"); await submitPassword(setup);
  await text(setup, "一致"); assert.equal(setupCount(), beforeSetup, "mismatched confirmation is rejected before setup request");
  await fill(setup, "confirmPassword", initialPassword); await submitPassword(setup); await text(setup, "没有待处理的事项");
  await noStoredCredentials(setup); await setupContext.close(); checks.push("first password setup and validation");

}
async function bootstrapMigration() {
  // A remote bootstrap needs the original access authorization; migrate a saved key only for auth setup.
  password = null; canSetup = false; sessions.clear();
  const migrationContext = await browser.createBrowserContext(), migration = await migrationContext.newPage();
  await migration.goto(server.url.href + "today"); await migration.waitForSelector('input[name="accessKey"]');
  await text(migration, "原访问授权");
  assert.equal(await migration.$eval("body", body => body.className), "web-shell-login");
  await fill(migration, "accessKey", "fixture-key");
  await migration.$eval('input[name="accessKey"]', input => (input as HTMLInputElement).form!.requestSubmit());
  await migration.waitForSelector('input[name="confirmPassword"]');
  await noStoredCredentials(migration);
  await migration.reload(); await migration.waitForSelector('input[name="accessKey"]');
  checks.push("manually supplied bootstrap authorization is used only in memory");
  await migration.evaluate(() => localStorage.setItem("chrona.accessKey", "fixture-key"));
  const migrationStart = authRequests.length;
  await migration.reload(); await migration.waitForSelector('input[name="confirmPassword"]');
  await fill(migration, "password", initialPassword); await fill(migration, "confirmPassword", initialPassword); await submitPassword(migration);
  await text(migration, "没有待处理的事项"); await noStoredCredentials(migration);
  assert(authRequests.slice(migrationStart).some(request => request.endpoint === "/setup" && request.authorization === "Bearer fixture-key"), "saved key authorizes initial setup");
  await migration.reload(); await text(migration, "没有待处理的事项"); await noStoredCredentials(migration);
  checks.push("remote setup requires authorization and migrates saved bootstrap key");

  return { migrationContext, migration };
}
async function changePassword(migration: BrowserPage) {
  // A second browser session is revoked on password change, while the submitting session remains usable.
  const otherContext = await browser.createBrowserContext(), other = await otherContext.newPage();
  await other.goto(server.url.href + "today"); await signIn(other, initialPassword);
  await navigate(migration, "/settings", "登录密码");
  const previousCookie = (await migration.browserContext().cookies()).find(item => item.name === "fixture_session")!.value;
  assert.equal(await migration.$eval('input[name="currentPassword"]', input => (input as HTMLInputElement).autocomplete), "current-password");
  assert.equal(await migration.$eval('input[name="password"]', input => (input as HTMLInputElement).autocomplete), "new-password");
  await fill(migration, "currentPassword", initialPassword); await fill(migration, "password", changedPassword); await fill(migration, "confirmPassword", "different-password");
  const changesBefore = authRequests.filter(request => request.endpoint === "/password").length;
  await submitPassword(migration); await text(migration, "一致");
  assert.equal(authRequests.filter(request => request.endpoint === "/password").length, changesBefore);
  await fill(migration, "confirmPassword", changedPassword);
  await fill(migration, "currentPassword", "wrong-password");
  await submitPassword(migration); await text(migration, "当前密码不正确");
  assert.equal(await migration.$eval("body", body => body.classList.contains("web-shell-app")), true, "wrong current password stays in Settings");
  assert.equal(await migration.$eval('input[name="password"]', input => (input as HTMLInputElement).value), changedPassword, "failed change preserves the draft");
  await fill(migration, "currentPassword", initialPassword);
  const changed = migration.waitForResponse(response => response.url().endsWith("/api/auth/password") && response.status() === 200);
  await submitPassword(migration); await changed; await text(migration, "登录密码已更新");
  assert.deepEqual(await migration.$$eval('input[type="password"]', inputs => inputs.map(input => (input as HTMLInputElement).value)), ["", "", ""], "successful change clears every password field");
  assert.notEqual((await migration.browserContext().cookies()).find(item => item.name === "fixture_session")!.value, previousCookie, "password change accepts the replacement cookie");
  await navigate(migration, "/today", "没有待处理的事项"); await noStoredCredentials(migration);
  await other.reload(); await other.waitForSelector('input[name="password"]'); await text(other, "登录");
  await fill(other, "password", initialPassword); await submitPassword(other); await text(other, "密码不正确");
  await signIn(other, changedPassword); await noStoredCredentials(other);
  checks.push("password change revokes other sessions and retains current session");

  await otherContext.close();
}
async function logoutCookie(migrationContext: BrowserContext, migration: BrowserPage) {
  const cookie = (await migrationContext.cookies()).find(item => item.name === "fixture_session");
  assert(cookie, "setup created a session cookie");
  const logout = migration.waitForResponse(response => response.url().endsWith("/api/auth/logout") && response.request().method() === "POST");
  await migration.click("#logout"); assert.equal((await logout).status(), 200); await migration.waitForSelector('input[name="password"]');
  assert.equal((await migrationContext.cookies()).some(item => item.name === "fixture_session"), false);
  const replay = await fetch(new URL("api/web/today", server.url), { headers: { cookie: `fixture_session=${cookie.value}` } });
  assert.equal(replay.status, 401, "logout invalidates the server session as well as its cookie");
  await migration.reload(); await migration.waitForSelector('input[name="password"]');
  assert.equal(await migration.$eval("body", body => body.className), "web-shell-login");
  checks.push("logout POST invalidates server session and cookie");
  await migrationContext.close();
  password = initialPassword; canSetup = true; sessions.clear();
}
// Test the shell/renderer boundary independently of the application's implementation.
// The fixture Chat consumes ?new=1 itself, exactly as a registered application can.
// eslint-disable-next-line complexity, max-lines-per-function, max-statements -- Keep the isolated routing fixture and its browser lifecycle assertions together.
async function chatRouting() {
  const renderer = `
    export function registeredDeps(page, web) {
      return { call: (target, args) => web('/call', { method: 'POST', body: { target, args, page: { module: page.module, id: page.id, revision: page.revision } } }) };
    }
    export function mount(element, page, deps) {
      element.textContent = 'Chat 应用内容';
      const url = new URL(location.href);
      if (url.searchParams.get('new') === '1') {
        void deps.call('chat.new', { url: url.pathname + url.search + url.hash });
        url.searchParams.delete('new');
        history.replaceState(null, '', url);
      }
      return () => {};
    }
    export function mountSystem(element, params) {
      element.textContent = JSON.stringify(params);
      return () => {};
    }
  `;
  let fixtureAuth = true, manifestStatus = 200, inventoryMissing = false, holdManifest = false;
  let release: (() => void) | undefined;
  const delegated: { target: string; args: { url: string }; page: { module: string; id: string } }[] = [];
  const requested: string[] = [];
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    requested.push(path);
    if (path === "/app.js") return new Response(app, { headers: { "content-type": "text/javascript" } });
    if (path === "/pages.js") return new Response(renderer, { headers: { "content-type": "text/javascript" } });
    if (path === "/style.css") return new Response("");
    if (path === "/api/auth/status") return Response.json({ passwordSet: true, authenticated: fixtureAuth, canSetup: false });
    if (path === "/api/auth/logout") { fixtureAuth = false; return Response.json({ ok: true }); }
    if (path === "/api/web/events") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": connected\n\n")); } }));
    if (path === "/api/web/pages") return Response.json(inventoryMissing ? [] : links);
    if (path === "/api/web/pages/chat/main") {
      const status = manifestStatus;
      if (holdManifest) await new Promise<void>(resolve => { release = resolve; });
      return Response.json(status === 200 ? registered("chat") : { message: status === 404 ? "Chat 主页面未登记" : "Chat 应用已停用" }, { status });
    }
    if (path === "/api/web/call") { delegated.push(await request.json() as typeof delegated[number]); return Response.json({ ok: true }); }
    if (path.startsWith("/api/")) throw new Error(`Unexpected routing fixture request: ${path}`);
    return new Response(index, { headers: { "content-type": "text/html", "content-security-policy": csp } });
  } });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on("pageerror", error => failures.push(String(error)));
  const current = () => page.$$eval('header a[aria-current="page"]', links => links.map(link => link.getAttribute("href")));
  const settled = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const chatNav = async () => {
    await page.waitForSelector('header a[href="/p/chat/main"]');
    assert.deepEqual(await page.$$eval('header a', links => links.filter(link => link.getAttribute("href") === "/p/chat/main").map(link => link.textContent)), ["Chat"]);
    assert.equal(await page.$$('header a[href="/chat"], header a[href="/conversations"], header a[href="/history"], header a[href^="/sessions/"]').then(links => links.length), 0);
  };
  try {
    await page.goto(new URL("/chat?entry=direct#latest", fixture.url).href);
    await text(page, "Chat 应用内容");
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash, "/p/chat/main?entry=direct#latest");
    await chatNav(); assert.deepEqual(await current(), ["/p/chat/main"]);
    for (const alias of ["/chat?draft=a%20b#latest", "/conversations?draft=a%20b#latest"]) {
      const previousLength = await page.evaluate(() => history.length);
      await navigate(page, alias, "Chat 应用内容");
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash, "/p/chat/main?draft=a%20b#latest");
      assert.equal(await page.evaluate(() => history.length), previousLength + 1, "alias replaces its entry without adding another history entry");
      assert.deepEqual(await current(), ["/p/chat/main"]);
    }
    for (const path of ["/chat/new?keep=two&new=0#draft", "/p/chat/main?keep=two&new=1#draft"]) {
      const before = delegated.length;
      const call = page.waitForResponse(response => response.url().endsWith("/api/web/call"));
      await navigate(page, path, "Chat 应用内容"); await call;
      await page.waitForFunction(() => !new URL(location.href).searchParams.has("new"));
      assert.equal(delegated.length, before + 1, "Chat owns one new-session delegation");
      assert.deepEqual(delegated.at(-1), { target: "chat.new", args: { url: "/p/chat/main?keep=two&new=1#draft" }, page: { module: "chat", id: "main", revision: 1 } });
      await navigate(page, "/today?from=chat", '"name":"today"');
      await page.goBack(); await text(page, "Chat 应用内容");
      assert.equal(new URL(page.url()).search, "?keep=two");
      assert.equal(delegated.length, before + 1, "browser back cannot delegate the consumed new flag again");
    }
    checks.push("one Chat nav, canonical aliases preserve queries, and Chat owns one-time new delegation");
    for (const path of ["/history?filter=web#latest", "/sessions/legacy-id?tab=messages", "/sessions/id%20with%20spaces"]) {
      await navigate(page, "/today", '"name":"today"');
      const before = delegated.length;
      const previousLength = await page.evaluate(() => history.length);
      await navigate(page, path, "Chat 应用内容");
      const original = new URL(path, fixture.url), redirected = new URL(page.url());
      assert.equal(redirected.pathname + redirected.search + redirected.hash, "/p/chat/main" + original.search + original.hash);
      assert.equal(await page.evaluate(() => history.length), previousLength + 1, "legacy redirect replaces the navigation entry");
      assert.equal(delegated.length, before, "legacy redirects do not create a Chat session");
      assert.deepEqual(await current(), ["/p/chat/main"]);
      await chatNav();
      await page.reload(); await text(page, "Chat 应用内容");
      assert.equal(delegated.length, before, "reload does not create a Chat session");
    }
    assert(!requested.some(path => path === "/api/web/history" || path.startsWith("/api/web/sessions")), "legacy routes never request old conversation data");
    checks.push("history and legacy session routes redirect to Chat without reading old conversations");
    inventoryMissing = true;
    // Refresh the display snapshot immediately; no real 30-second wait.
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 31000; });
    for (const status of [404, 409, 503]) {
      manifestStatus = status;
      await navigate(page, "/chat", '"name":"chat-unavailable"');
      const unavailable = JSON.parse(await page.$eval("main", main => main.textContent!)) as { name: string; message: string };
      assert(unavailable.message.includes("Chat 应用页面暂时无法打开"));
      assert(unavailable.message.includes(status === 404 ? "Chat 主页面未登记" : "Chat 应用已停用"));
      assert(unavailable.message.includes("请前往应用"));
      assert.deepEqual(await current(), ["/p/chat/main"]); await chatNav();
    }
    checks.push("missing inventory/manifest and unavailable Chat render an explicit system-page failure");
    manifestStatus = 200; holdManifest = true;
    const pending = page.waitForRequest(request => request.url().endsWith("/api/web/pages/chat/main"));
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>('header a[href="/p/chat/main"]')!.click()); await pending;
    await navigate(page, "/today", '"name":"today"');
    const staleResponse = page.waitForResponse(response => response.url().endsWith("/api/web/pages/chat/main"));
    assert(release); release(); await staleResponse; await settled();
    await text(page, '"name":"today"'); assert.deepEqual(await current(), ["/today"]);
    const loggedOutPending = page.waitForRequest(request => request.url().endsWith("/api/web/pages/chat/main"));
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>('header a[href="/p/chat/main"]')!.click()); await loggedOutPending;
    await page.click("#logout"); await text(page, '"name":"login"');
    const loggedOutResponse = page.waitForResponse(response => response.url().endsWith("/api/web/pages/chat/main"));
    assert(release); release(); await loggedOutResponse; await settled();
    await text(page, '"name":"login"');
    assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
    assert.equal(await page.$$("header a[data-page]").then(links => links.length), 0);
    fixtureAuth = true; holdManifest = false; manifestStatus = 401;
    await page.reload(); await text(page, '"name":"login"');
    assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
    assert(!requested.includes("/api/web/chat"), "the shell never falls back to the old composer endpoint");
    checks.push("Chat manifest navigation/auth races and 401 preserve the current route and login shell");
  } finally { release?.(); await context.close(); fixture.stop(true); }
}
try {
  await chatRouting();
  await failedStatus();
  await firstSetup();
  const { migrationContext, migration } = await bootstrapMigration();
  await changePassword(migration);
  await logoutCookie(migrationContext, migration);
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    const page = await browser.newPage();
    page.on("pageerror", error => failures.push(String(error)));
    page.on("console", message => { if (message.type() === "error" && message.text().includes("Content Security Policy")) failures.push(message.text()); });
    await page.setViewport({ width: width!, height: height! });
    await page.goto(server.url.href + "today");
    await page.waitForSelector('input[name="password"]');
    await text(page, "登录");
    assert.equal(await page.$eval('input[name="password"]', input => (input as HTMLInputElement).autocomplete), "current-password");
    assert(await page.$eval("body", body => body.classList.contains("web-shell-login")));
    assert(await page.$eval("header nav", nav => (nav as HTMLElement).hidden));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: login has no horizontal overflow`);
    await page.type('input[name="password"]', "wrong-password"); await page.click('form button.primary');
    await text(page, "密码不正确");
    await page.$eval('input[name="password"]', input => { (input as HTMLInputElement).value = ""; });
    await page.type('input[name="password"]', initialPassword); await page.click('form button.primary');
    await text(page, "没有待处理的事项");
    const today = await geometry(page, false, `${width}: Today`);
    await page.waitForSelector('header a[data-page]');
    assert.deepEqual(today.active, ["/today"]);
    await capture(page, `today-${width}`);
    for (const [path, expected, current] of [["/chat", "Chat 应用内容", "/p/chat/main"], ["/apps", "应用", "/apps"], ["/apps/missing", "没有这个应用", "/apps"], ["/apps/system/agent", "系统能力内容", "/apps"], ["/activity", "活动", "/activity"], ["/settings", "保存内核额度", "/settings"]]) {
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
    const navigationReads = webRequests.filter(request => request.endpoint === "/pages").length;
    await page.evaluate(() => Array.from(document.querySelectorAll("main button")).find(button => button.textContent === "调用应用操作")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await text(page, "已完成");
    assert.equal(webRequests.filter(request => request.endpoint === "/pages").length, navigationReads, "application POST does not rediscover navigation");
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
    await page.click("#logout"); await page.waitForSelector('input[name="password"]');
    assert.equal(await page.$$eval("header a[data-page]", nodes => nodes.length), 0);
    assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
    await page.close();
  }
  // Stale registered-page responses cannot replace the next route or reapply workspace layout.
  const page = await browser.newPage();
  page.on("pageerror", error => failures.push(String(error)));
    page.on("console", message => { if (message.type() === "error" && message.text().includes("Content Security Policy")) failures.push(message.text()); });
  await page.goto(server.url.href);
  await signIn(page, initialPassword);
  const slowRequest = page.waitForRequest(request => request.url().endsWith("/api/web/pages/fixture/slow"));
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "/p/fixture/slow"; document.body.append(a); a.click(); a.remove(); });
  await slowRequest;
  await navigate(page, "/settings", "保存内核额度");
  assert(delayed, "slow page request started"); delayed();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert(await page.$eval("body", body => !body.classList.contains("web-shell-workspace")));
  await text(page, "保存内核额度"); checks.push("stale route response ignored");
  links.push({ module: "fixture", moduleId: "fixture-id", id: "added", title: "动态应用" });
  // Advance the navigation display refresh window without a real 30-second wait.
  await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 31000; });
  await navigate(page, "/p/fixture/added", "文档应用内容");
  await page.waitForSelector('header a[href="/p/fixture/added"][aria-current="page"]'); checks.push("dynamic registered link becomes active");
  expired = true; await navigate(page, "/today", "登录");
  assert.equal(await page.$eval("body", body => body.className), "web-shell-login");
  assert.equal(await page.$$eval("header a[data-page]", nodes => nodes.length), 0); checks.push("401 clears authenticated shell and app links");
  expired = false; await page.type('input[name="password"]', initialPassword); await page.click('form button.primary'); await text(page, "没有待处理的事项");
  await page.waitForSelector('header a[data-page]'); checks.push("relogin restores shell and links");
  const oldRequest = page.waitForRequest(request => request.url().endsWith("/api/web/pages/fixture/old-session"));
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "/p/fixture/old-session"; document.body.append(a); a.click(); a.remove(); });
  await oldRequest;
  await page.click("#logout"); await page.waitForSelector('input[name="password"]');
  await page.evaluate(() => history.replaceState(null, "", "/today"));
  await page.type('input[name="password"]', initialPassword); await page.click('form button.primary');
  await text(page, "没有待处理的事项");
  assert(delayedUnauthorized, "old session request started");
  const oldResponse = page.waitForResponse(response => response.url().endsWith("/api/web/pages/fixture/old-session") && response.status() === 401);
  delayedUnauthorized(); await oldResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert(await page.$eval("body", body => body.classList.contains("web-shell-app")));
  assert.equal(await page.evaluate(() => localStorage.getItem("chrona.accessKey")), null);
  await text(page, "没有待处理的事项"); checks.push("old session 401 cannot clear a new login");
  assert(calls.some(call => call.target === "fixture.ping" && call.page?.module === "fixture" && call.page.id === "document" && call.page.revision === 1), "registered calls retain module/page scope");
  assert(webRequests.some(request => request.endpoint === "/events" && request.cookie), "SSE uses the session cookie");
  assert(webRequests.every(request => request.authorization === null), "normal Web API and SSE never send bootstrap bearer credentials");
  assert(authRequests.every(request => !request.authorization || ["/status", "/setup"].includes(request.endpoint)), "bootstrap bearer is limited to status/setup");
  assert(authRequests.filter(request => request.endpoint === "/logout").every(request => Object.keys(request.body).length === 0), "logout sends an empty JSON object");
  assert.deepEqual(unexpected, []); assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await browser.close(); server.stop(true); }
