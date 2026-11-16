import { settingsJavascript } from "./settings-fixture";
import { mountSystem, type Page } from "./pages";
import type { SystemHost } from "./system/adapter";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) { for (let i = 0; i < 180; i++) { if (check()) return; await frame(); } throw new Error("Inline settings did not settle"); }
function settingsPage(module: string, version: string): Page {
  return { module, moduleId: `${module}-id`, hash: version, revision: version, id: "preferences", title: `${module} 偏好`, purpose: "settings", props: {}, keyed: ["save"], tools: ["read", "save"],
    javascript: settingsJavascript };
}
// eslint-disable-next-line max-statements -- A single offline browser lifecycle scenario keeps its ordered assertions together.
async function run() {
  const checks: string[] = [], assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  const element = document.body.appendChild(document.createElement("main")), calls: { target: string; args: Record<string, unknown>; page: { module: string; revision: string } }[] = [], navigation: string[] = [];
  let version = "v1", status = "active", registered = true, failGet = false, mismatch = false;
  const timers = new Map<number, () => void>(), originalSet = window.setInterval, originalClear = window.clearInterval;
  let id = 0;
  window.setInterval = ((callback: () => void) => { timers.set(++id, callback); return id; }) as typeof setInterval;
  window.clearInterval = handle => { timers.delete(Number(handle)); };
  const owner = () => ({ id: "alpha-id", name: "alpha", status, activeHash: version, origin: "external", capabilities: {}, health: {} });
  const entry = { module: "alpha", moduleId: "alpha-id", id: "preferences", title: "偏好", purpose: "settings" };
  const host: SystemHost = { tool: async () => { throw new Error("No system adapter for apps"); }, web: async (path, options) => {
    if (path === "/pages") return registered ? [entry] : [];
    if (path.startsWith("/modules/")) return { app: owner() };
    if (path.startsWith("/pages/")) { if (failGet) throw new Error("受控登记读取故障"); const page = settingsPage("alpha", version); return mismatch ? { ...page, moduleId: "wrong" } : page; }
    if (path === "/call") { const call = options!.body as typeof calls[number]; calls.push(call); return call.target.endsWith(".read") ? { value: `alpha-${call.page.revision}` } : {}; }
    throw new Error(`Unexpected ${path}`);
  } };
  const input = () => element.querySelector<HTMLInputElement>('input[name="preference"]');
  const has = (text: string) => element.textContent.includes(text);
  const click = (label: string) => Array.from(element.querySelectorAll("button")).find(button => button.textContent === label)!.click();
  const poll = async () => { timers.forEach(callback => callback()); await frame(); await frame(); };
  const unmount = mountSystem(element, { name: "app", id: "alpha-id", tab: "settings", session: "" }, host, path => navigation.push(path));
  try {
    await until(() => input()?.value === "alpha-v1"); assert(element.querySelector('nav[aria-label="应用标签"]'), "detail tabs remain"); assert(!element.querySelector("iframe"), "inline form uses same document");
    input()!.value = "draft"; const original = input(); await poll(); assert(input() === original && input()!.value === "draft", "authority polling preserves draft and DOM");
    click("保存应用偏好"); await until(() => navigation.includes("/saved"));
    const save = calls.find(call => call.target.endsWith(".save"))!; assert(save.args.value === "draft", "save uses local draft"); assert(typeof save.args["request-key"] === "string", "non-idempotent key is supplied"); assert(save.page.revision === "v1", "call pins page revision");
    version = "v2"; await poll(); await until(() => input()?.value === "alpha-v2"); assert(input() !== original, "active version creates fresh page");
    status = "paused"; await poll(); await until(() => has("恢复后")); assert(!input(), "pause unmounts form");
    status = "active"; registered = false; await poll(); await until(() => has("尚未登记")); assert(!input(), "missing registration has empty state");
    registered = true; failGet = true; await poll(); await until(() => has("受控登记读取故障")); assert(!input(), "failed load never mounts form");
    failGet = false; mismatch = true; click("重试读取设置"); await until(() => has("应用设置页面已变化")); assert(!input(), "wrong owner is rejected");
    mismatch = false; click("重试读取设置"); await until(() => input()?.value === "alpha-v2"); assert(input(), "explicit retry restores page");
    assert(calls.every(call => call.target.startsWith("alpha.") && call.page.module === "alpha"), "all callbacks retain actual page owner");
    return checks;
  } finally { unmount(); window.setInterval = originalSet; window.clearInterval = originalClear; element.remove(); }
}
Object.assign(window, { inlineSettingsTest: { run } });
