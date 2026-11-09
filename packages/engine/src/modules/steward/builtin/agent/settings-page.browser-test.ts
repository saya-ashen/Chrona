// Run with Bun. Uses a fresh browser and temporary app data; no HTTP server or model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createModelPolicy } from "./model-policy";
import { SETTINGS_PAGE as agentPage } from "./settings-page";
import { SETTINGS_PAGE as notifyPage } from "../../external/notify/settings-page";
import { openStore } from "../../external/notify/store";
import { createNotify } from "../../external/notify/notify";

const root = await mkdtemp("/tmp/chrona-settings-browser-test-");
const web = resolve(import.meta.dir, "../../external/web");
const bundle = await Bun.build({ entrypoints: [join(web, "src/pages.tsx")], target: "browser", minify: true });
assert(bundle.success, bundle.logs.map(String).join("\n"));
const javascript = await bundle.outputs[0]!.text();
const css = await readFile(join(web, "src/pages.css"), "utf8");
const policy = createModelPolicy(join(root, "agent"), async () => ({ authorized: true }), async () => false);
await mkdir(join(root, "notify"));
const store = openStore(join(root, "notify"));
const notify = createNotify({ store, publicUrl: null, directory: async () => ({ modules: [], tools: [] }), call: async () => { throw new Error("Unexpected delivery"); }, status: async () => { throw new Error("Unexpected delivery"); } });
const chrome = process.env.CHRONA_TEST_CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");
assert(chrome, "Chrome/Chromium is required");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: join(root, "browser"), args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
const errors: string[] = [], checks: string[] = [];
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    for (const [module, settings] of [["agent", agentPage], ["notify", notifyPage]] as const) {
      const page = await browser.newPage();
      page.on("pageerror", error => errors.push(String(error)));
      await page.setViewport({ width: width!, height: height! });
      await page.setRequestInterception(true);
      page.on("request", request => { if (request.url().startsWith("blob:")) void request.continue(); else void request.abort(); });
      let writes = 0;
      await page.exposeFunction("settingsCall", async (target: string, args: Record<string, unknown>) => {
        if (args.form) writes++;
        if (target === "agent.configure") return policy.configure(args, "browser-owner");
        if (target === "notify.ui-settings") return notify.handle("ui-settings", args, { kind: "owner", via: null }, new Date());
        throw new Error(`Unexpected tool ${target}`);
      });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main style="padding:16px;max-width:900px;margin:auto"></main></body></html>');
      await page.addStyleTag({ content: css });
      await page.evaluate(async ({ javascript, settings, module }) => {
        const renderer = await import(URL.createObjectURL(new Blob([javascript], { type: "text/javascript" })));
        const host = window as unknown as { settingsCall(target: string, args: Record<string, unknown>): Promise<unknown> };
        renderer.mount(document.querySelector("main"), { ...settings, module }, { call: host.settingsCall, navigate() {}, content: async () => new Blob() });
      }, { javascript, settings, module });
      const input = module === "agent" ? "fast-model" : "daily-cap";
      await page.waitForSelector(`input[name="${input}"]`);
      assert.equal(writes, 0, `${module}: opening page never saves`);
      assert.equal(await page.$("textarea"), null, `${module}: concrete controls`);
      const setInput = async (name: string, value: string) => page.$eval(`input[name="${name}"]`, (element, value) => {
        const input = element as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await setInput(input, module === "agent" ? "fixture/fast" : "7");
      if (module === "agent") {
        await page.select('select[name="fast-thinking"]', "high");
        await setInput("preferred-timeout-ms", "2500");
      }
      await page.click("button");
      await page.waitForFunction(expected => document.body.textContent!.includes(expected), {}, module === "agent" ? "Agent 设置已保存" : "通知设置已保存");
      assert.equal(writes, 1);
      if (module === "agent") assert.deepEqual((await policy.configure({}, "browser-owner")).config?.tiers.fast, { model: "fixture/fast", thinking: "high" });
      else assert.equal(store.settings().dailyCap, 7);
      await setInput(module === "agent" ? "preferred-timeout-ms" : "daily-cap", module === "agent" ? "0" : "51");
      await page.click("button");
      await page.waitForFunction(() => !!document.querySelector('[role="alert"]')?.textContent.includes("保存失败"));
      assert.equal(await page.$eval(`input[name="${module === "agent" ? "preferred-timeout-ms" : "daily-cap"}"]`, element => (element as HTMLInputElement).value), module === "agent" ? "0" : "51");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${module} ${width}: no horizontal scrolling`);
      checks.push(`${module} ${width}×${height}: read, explicit save, Chinese success/error, retained draft, no overflow`);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(checks.join("\n"));
} finally { await browser.close(); store.close(); await rm(root, { recursive: true, force: true }); }
