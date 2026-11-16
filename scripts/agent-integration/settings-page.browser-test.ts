// Run with Bun against an isolated loopback fixture and temporary app data.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createConfiguration } from "../../packages/engine/src/modules/steward/external/pi/configuration";
import { SETTINGS_PAGE as piPage } from "../../packages/engine/src/modules/steward/external/pi/settings-page";
import { SETTINGS_PAGE as notifyPage } from "../../packages/engine/src/modules/steward/external/notify/settings-page";
import { openStore } from "../../packages/engine/src/modules/steward/external/notify/store";
import { createNotify } from "../../packages/engine/src/modules/steward/external/notify/notify";

const root = await mkdtemp("/tmp/chrona-settings-browser-test-");
const web = resolve(import.meta.dir, "../../packages/engine/src/modules/steward/external/web");
const bundle = await Bun.build({ entrypoints: [join(web, "src/pages.tsx")], target: "browser", minify: true });
assert(bundle.success, bundle.logs.map(String).join("\n"));
const javascript = await bundle.outputs[0]!.text();
const css = await readFile(join(web, "src/pages.css"), "utf8");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  const script = path === "/pages.js" ? javascript : path === "/pi-settings.js" ? piPage.javascript : path === "/notify-settings.js" ? notifyPage.javascript : undefined;
  return script
    ? new Response(script, { headers: { "content-type": "text/javascript" } })
    : new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main style="padding:16px;max-width:900px;margin:auto"></main></body></html>', { headers: { "content-type": "text/html" } });
} });
const policy = createConfiguration(join(root, "pi"), { agentDir: root, chronaExtension: join(root, "unused-extension.ts"), agentUrl: "http://127.0.0.1:1/api/steward-agent" });
await mkdir(join(root, "notify"));
const store = openStore(join(root, "notify"));
const notify = createNotify({ store, publicUrl: null, listModules: async () => [], describeTools: async () => [], call: async () => { throw new Error("Unexpected delivery"); }, status: async () => { throw new Error("Unexpected delivery"); } });
const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
assert(chrome, "Chrome/Chromium is required");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: join(root, "browser"), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
const errors: string[] = [], checks: string[] = [];
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    for (const [module, settings] of [["pi", piPage], ["notify", notifyPage]] as const) {
      const page = await browser.newPage();
      page.on("pageerror", error => errors.push(String(error)));
      await page.setViewport({ width: width!, height: height! });
      await page.setRequestInterception(true);
      page.on("request", request => {
        if (request.url().startsWith("blob:") || request.url().startsWith(server.url.origin)) void request.continue();
        else void request.abort();
      });
      let writes = 0;
      await page.exposeFunction("settingsCall", async (target: string, args: Record<string, unknown>) => {
        if (args.form) writes++;
        if (target === "pi.configure") return policy.configure(args);
        if (target === "pi.models") return policy.models();
        if (target === "notify.ui-settings") return notify.handle("ui-settings", args, { kind: "owner", via: null }, new Date());
        throw new Error(`Unexpected tool ${target}`);
      });
      await page.goto(server.url.href);
      await page.addStyleTag({ content: css });
      await page.evaluate(async ({ settings, module }) => {
        const renderer = await import("/pages.js");
        const host = window as unknown as { settingsCall(target: string, args: Record<string, unknown>): Promise<unknown> };
        renderer.mount(document.querySelector("main")!, { ...settings, layout: "document", purpose: "settings", module, moduleId: `${module}-fixture`, hash: "fixture", revision: "1", keyed: [], props: {} }, { call: host.settingsCall, source: new URL(`/${module}-settings.js?fixture=1`, location.href).href, navigate() {}, content: async () => new Blob() });
      }, { settings, module });
      const input = module === "pi" ? "model" : "daily-cap";
      try { await page.waitForSelector(`input[name="${input}"]`); }
      catch (error) {
        console.error(JSON.stringify({ component: "settings-browser-test", event: "page_unavailable", module, errors, text: await page.$eval("body", element => element.textContent), error: String(error) }));
        throw error;
      }
      assert.equal(writes, 0, `${module}: opening page never saves`);
      assert.equal(await page.$("textarea"), null, `${module}: concrete controls`);
      const setInput = async (name: string, value: string) => page.$eval(`input[name="${name}"]`, (element, value) => {
        const input = element as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await setInput(input, module === "pi" ? "fixture/fast" : "7");
      if (module === "pi") {
        await page.select('select[name="thinking"]', "high");
      }
      await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find(button => button.textContent!.includes("保存")); if (!button) throw new Error("Save button missing"); button.click(); });
      await page.waitForFunction(expected => document.body.textContent!.includes(expected), {}, module === "pi" ? "Pi 设置已保存" : "通知设置已保存")
        .catch(async error => { console.error(JSON.stringify({ component: "settings-browser-test", event: "save_unavailable", module, text: await page.$eval("body", element => element.textContent), error: String(error) })); throw error; });
      assert.equal(writes, 1);
      if (module === "pi") assert.deepEqual((await policy.configure({})).config, { model: "fixture/fast", thinking: "high" });
      else assert.equal(store.settings().dailyCap, 7);
      await setInput(module === "pi" ? "profile" : "daily-cap", module === "pi" ? "relative" : "51");
      await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find(button => button.textContent!.includes("保存")); if (!button) throw new Error("Save button missing"); button.click(); });
      await page.waitForFunction(expected => document.querySelector('[role="alert"]')?.textContent.includes(expected), {}, module === "pi" ? "设置无效" : "Error: invalid").catch(async error => { console.error(JSON.stringify({ component: "settings-browser-test", event: "error_unavailable", module, text: await page.$eval("body", element => element.textContent), error: String(error) })); throw error; });
      assert.equal(await page.$eval(`input[name="${module === "pi" ? "profile" : "daily-cap"}"]`, element => (element as HTMLInputElement).value), module === "pi" ? "relative" : "51");
      if (module === "pi") assert.deepEqual((await policy.configure({})).config, { model: "fixture/fast", thinking: "high" });
      else assert.equal(store.settings().dailyCap, 7);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${module} ${width}: no horizontal scrolling`);
      checks.push(`${module} ${width}×${height}: read, explicit save, success/error, rejected invalid settings, retained draft, no overflow`);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(checks.join("\n"));
} finally { await browser.close(); await server.stop(true); store.close(); await rm(root, { recursive: true, force: true }); }
