// Offline browser boundary fixture, exercised by inline-settings.bun.test.ts.
import { mountSystem, type Page } from "./pages";
import type { SystemHost } from "./system/adapter";

type Args = Record<string, unknown>;
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(yes => { resolve = yes; });
  return { promise, resolve };
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error("Inline settings did not settle");
}
function settingsPage(module: string, revision: string): Page {
  return { module, moduleId: `${module}-id`, id: "preferences", title: `${module} 偏好`, purpose: "settings", revision, contracts: { read: "read-contract", save: "save-contract" }, keyed: ["save"],
    data: { prefs: { tool: "read" } }, spec: { root: "form", state: { prefs: { value: "" } }, elements: {
      form: { type: "Stack", props: {}, children: ["input", "save", "image", "escape"] },
      input: { type: "Input", props: { name: "preference", label: "偏好", value: { $bindState: "/prefs/value" } } },
      save: { type: "Button", props: { label: "保存应用偏好" }, on: { press: { action: "call", params: { tool: "save", args: { value: { $state: "/prefs/value" } }, reload: false }, onSuccess: { navigate: "/saved" }, onError: { set: { "/failed": true } } } } },
      image: { type: "Image", props: { ref: "logo &图", alt: "应用图标" } },
      // Even a malformed/unvalidated app spec cannot use a system-only component.
      escape: { type: "SystemAction", props: { label: "禁止借用系统操作", tool: "settings-update", args: {} } },
    } } };
}
async function run() {
  const checks: string[] = [];
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  const element = document.createElement("main"); document.body.append(element);
  const has = (text: string) => element.textContent.includes(text);
  const input = () => element.querySelector<HTMLInputElement>('input[name="preference"]')!;
  const click = (label: string) => Array.from(element.querySelectorAll("button")).find(button => button.textContent === label)!.click();
  const draft = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  };
  // Drive only the detail's regular authority polling, without wall-clock waits.
  const intervals = new Map<number, () => void>(), originalSet = window.setInterval, originalClear = window.clearInterval;
  let timer = 0;
  window.setInterval = ((callback: () => void) => { intervals.set(++timer, callback); return timer; }) as typeof setInterval;
  window.clearInterval = id => { if (typeof id === "number") intervals.delete(id); };
  const poll = async () => { for (const callback of [...intervals.values()]) callback(); await frame(); await frame(); };
  const calls: { target: string; args: Args; page: { module: string; id: string; revision: string } }[] = [];
  const paths: string[] = [], navigation: string[] = [];
  let version = "v1", status = "active", registered = true, failGet = false, mismatch = false, stale = false;
  let pendingGet: ReturnType<typeof deferred> | undefined, pendingRead: ReturnType<typeof deferred> | undefined, pendingSave: ReturnType<typeof deferred> | undefined;
  const owner = (module: string) => ({ id: `${module}-id`, name: module, activeHash: version, status, origin: "external", capabilities: {}, health: {} });
  const entries = () => registered ? ["alpha", "beta"].map(module => ({ module, moduleId: `${module}-id`, id: "preferences", purpose: "settings", title: `${module} 偏好` })) : [];
  const host: SystemHost = {
    async web(path, options) {
      paths.push(path);
      if (path === "/pages") return entries();
      if (path.startsWith("/modules/")) return { app: owner(path.includes("alpha-id") ? "alpha" : "beta") };
      if (path.includes("/content?")) { assert(options?.raw === true, "content retains raw transport"); return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], { type: "image/svg+xml" }); }
      if (path.startsWith("/pages/")) {
        if (pendingGet) return pendingGet.promise;
        if (failGet) throw new Error("受控登记读取故障");
        const page = settingsPage(path.split("/")[2]!, version);
        return mismatch ? { ...page, moduleId: "replaced-owner" } : page;
      }
      if (path === "/call") {
        const body = options!.body as typeof calls[number]; calls.push(body);
        if (stale) throw new Error("页面已更新，请重新打开页面");
        if (body.target.endsWith(".save")) return pendingSave?.promise ?? {};
        return pendingRead?.promise ?? { value: `${body.page.module}-${body.page.revision}` };
      }
      throw new Error(`Unexpected web path ${path}`);
    },
    tool: async () => { throw new Error("App must never receive system tool adapter"); },
    login: async () => { throw new Error("App must never receive login adapter"); },
  };
  let unmount = () => {};
  const open = (module: string) => { unmount(); unmount = mountSystem(element, { name: "app", id: `${module}-id`, tab: "settings", session: "" }, host, path => navigation.push(path)); };
  try {
    pendingGet = deferred(); const lateGet = pendingGet;
    open("alpha"); await until(() => has("正在读取应用设置页面"));
    assert(has("alpha") && element.querySelector('nav[aria-label="应用标签"]'), "detail heading and tabs remain during page loading");
    pendingGet = undefined; open("beta"); await until(() => input()?.value === "beta-v1");
    lateGet.resolve(settingsPage("alpha", "v1")); await frame(); await frame();
    assert(input().value === "beta-v1" && !calls.some(call => call.page.module === "alpha"), "late page fetch cannot mount the previous app");
    assert(element.querySelectorAll("iframe").length === 0 && element.querySelectorAll('input[name="preference"]').length === 1, "one inline form without iframe");
    assert(!element.querySelector('button[title="禁止借用系统操作"]') && !Array.from(element.querySelectorAll("button")).some(button => button.textContent === "禁止借用系统操作"), "app cannot render system-only action");
    assert(paths.includes("/pages/beta/preferences/content?ref=logo%20%26%E5%9B%BE"), "embedded image uses original app content path");
    draft("beta-draft"); await frame(); await poll();
    assert(input().value === "beta-draft", "detail authority polling preserves the app store and draft");
    const readsBefore = calls.length;
    version = "v2"; await poll(); await until(() => input()?.value === "beta-v2");
    assert(calls.length > readsBefore && input().value !== "beta-draft", "active version change remounts a fresh app store");
    draft("saved-value"); await frame(); click("保存应用偏好"); await until(() => navigation.includes("/saved"));
    const save = calls.find(call => call.target === "beta.save")!;
    assert(save.page.module === "beta" && save.page.id === "preferences" && save.page.revision === "v2" && save.args.value === "saved-value" && typeof save.args["request-key"] === "string", "save retains app target, page revision, binding and request key");
    stale = true; click("保存应用偏好"); await until(() => has("页面已更新"));
    stale = false; version = "v3"; click("重新读取设置"); await until(() => input()?.value === "beta-v3");
    assert(input().value === "beta-v3", "stale authority retry refetches original page and resets stale draft");
    status = "paused"; await poll(); await until(() => has("恢复后"));
    assert(!input(), "paused owner unmounts app form");
    status = "active"; registered = false; await poll(); await until(() => has("尚未登记设置页面"));
    assert(!input(), "unregistered settings has an empty state without a form");
    registered = true; failGet = true; await poll(); await until(() => has("受控登记读取故障"));
    failGet = false; mismatch = true; click("重试读取设置"); await until(() => has("应用设置页面已变化"));
    assert(!input(), "owner mismatch never mounts returned form");
    mismatch = false; click("重试读取设置"); await until(() => input()?.value === "beta-v3");
    assert(input().value === "beta-v3", "page fetch failure supports explicit retry");
    pendingRead = deferred(); const lateRead = pendingRead;
    open("alpha"); await until(() => calls.some(call => call.target === "alpha.read"));
    pendingRead = undefined; open("beta"); await until(() => input()?.value === "beta-v3");
    lateRead.resolve({ value: "WRONG-ALPHA-DATA" }); await frame(); await frame();
    assert(input().value === "beta-v3" && !has("WRONG-ALPHA-DATA"), "late app read cannot overwrite the next app draft");
    pendingSave = deferred(); const lateSave = pendingSave;
    click("保存应用偏好"); await until(() => calls.filter(call => call.target.endsWith(".save")).length === 3);
    const navigationsBefore = navigation.length;
    open("alpha"); await until(() => input()?.value === "alpha-v3"); lateSave.resolve({}); await frame(); await frame();
    assert(navigation.length === navigationsBefore && input().value === "alpha-v3", "late save cannot navigate or update after app unmount");
    assert(calls.every(call => /^(alpha|beta)\.(read|save)$/.test(call.target) && call.target.startsWith(`${call.page.module}.`) && call.page.id === "preferences"), "all app calls retain page identity without system adapter");
    return checks;
  } catch (error) {
    throw new Error(`${(error as Error).message}; last check: ${checks.at(-1)}; DOM: ${element.textContent}`, { cause: error });
  } finally {
    unmount(); window.setInterval = originalSet; window.clearInterval = originalClear; element.remove();
  }
}
Object.assign(window, { inlineSettingsTest: { run } });
