import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPages, type ModuleState, type PageTool } from "./pages";
import { appsSpec } from "./src/system/apps";
import { detailSpec } from "./src/system/detail";
import { systemCall } from "./src/system/adapter";
import { installationRequest, settleInstallation } from "./src/system/install";
import { moduleLifecycleFixtures } from "../../module-lifecycle.fixtures";

const cleanups: string[] = [];
afterEach(async () => { for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true }); });
const spec = { root: "text", elements: { text: { type: "Text", props: { text: "示例" }, children: [], on: {} } } };
const withRead = { root: "button", elements: { button: { type: "Button", props: { label: "读取" }, children: [], on: { press: { action: "call", params: { tool: "read", args: { path: "x" } } } } } } };
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-web-lifecycle-"); cleanups.push(dataDir);
  const state = { modules: [{ id: "alpha-id", name: "alpha", status: "active", activeHash: "a" }, { id: "beta-id", name: "beta", status: "active", activeHash: "b" }] as ModuleState[], fail: false,
    tools: new Map<string, PageTool>([["read", { moduleId: "alpha-id", contractHash: "a".repeat(64), inputSchema: { properties: { path: { type: "string" } }, required: ["path"] } }]]) };
  const pages = createPages({ dataDir, modules: async () => { if (state.fail) throw new Error("directory unavailable"); return state.modules; }, tools: async name => name === "alpha" ? state.tools : new Map() });
  const caller = { kind: "module", module: "alpha", moduleId: "alpha-id" };
  const register = () => pages.tool("page-set", { id: "main", title: "主页面", spec: withRead, data: { content: { tool: "read", args: { path: "x" } } } }, caller);
  return { dataDir, state, pages, caller, register };
}
test("real owner identity, repeated registration and two apps with the same page id stay separate", async () => {
  const f = await fixture();
  await expect(f.pages.tool("page-set", { id: "main", title: "x", spec }, { kind: "module", module: "alpha" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.pages.tool("page-set", { id: "main", title: "x", spec }, { ...f.caller, moduleId: "fake" })).rejects.toMatchObject({ code: "conflict" });
  await f.register(); await f.register();
  await f.pages.tool("page-set", { id: "main", title: "乙", spec }, { kind: "module", module: "beta", moduleId: "beta-id" });
  expect(await f.pages.list()).toHaveLength(2);
  expect((await f.pages.get("alpha", "main"))?.revision).toMatch(/^[a-f0-9-]{36}$/);
  expect((await f.pages.get("beta", "main"))?.title).toBe("乙");
  expect(await f.pages.tool("page-remove", { id: "main" }, { kind: "module", module: "beta", moduleId: "beta-id" })).toEqual({ removed: true });
  expect((await f.pages.get("alpha", "main"))?.title).toBe("主页面");
});
test("concurrent registration and inventory pruning cannot drop another application's page", async () => {
  const f = await fixture();
  await Promise.all([f.register(), f.pages.list(), f.pages.tool("page-set", { id: "main", title: "乙", spec }, { kind: "module", module: "beta", moduleId: "beta-id" })]);
  expect(await f.pages.list()).toHaveLength(2);
  expect((await f.pages.get("alpha", "main"))?.moduleId).toBe("alpha-id");
  expect((await f.pages.get("beta", "main"))?.moduleId).toBe("beta-id");
});
test("pause hides but preserves, resume restores, delete and same-name replacement cannot inherit a page", async () => {
  const f = await fixture(); await f.register();
  f.state.modules[0]!.status = "paused";
  expect(await f.pages.list()).toEqual([]);
  await expect(f.pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  f.state.modules[0]!.status = "active";
  expect((await f.pages.get("alpha", "main"))?.moduleId).toBe("alpha-id");
  f.state.modules[0]!.id = "replacement-id";
  expect(await f.pages.get("alpha", "main")).toBeNull();
  expect(JSON.parse(await readFile(join(f.dataDir, "pages.json"), "utf8")).pages).toEqual([]);
});
test("failed inventory reads cannot erase registrations and legacy pages never guess an owner", async () => {
  const f = await fixture(); await f.register(); f.state.fail = true;
  await expect(f.pages.list()).rejects.toThrow("directory unavailable");
  f.state.fail = false; expect(await f.pages.list()).toHaveLength(1);
  const legacyDir = await mkdtemp("/tmp/chrona-web-legacy-"); cleanups.push(legacyDir);
  await writeFile(join(legacyDir, "pages.json"), JSON.stringify({ pages: [{ module: "alpha", id: "old", title: "旧页面", spec, data: {} }] }));
  const legacy = createPages({ dataDir: legacyDir, modules: async () => f.state.modules, tools: async () => f.state.tools });
  expect(await legacy.list()).toEqual([]);
  await expect(legacy.get("alpha", "old")).rejects.toThrow("重新登记");
});
test("code-only updates preserve contracts, callback changes fail until re-registration and metadata is derived anew", async () => {
  const f = await fixture(); await f.register(); f.state.modules[0]!.activeHash = "new-code";
  expect((await f.pages.get("alpha", "main"))?.needs).toEqual({ content: ["path"] });
  f.state.tools.get("read")!.contractHash = "b".repeat(64);
  f.state.tools.get("read")!.inputSchema = { properties: { path: {}, "request-key": {} }, required: ["path", "request-key"] };
  await expect(f.pages.get("alpha", "main")).rejects.toThrow("重新登记");
  await f.register();
  const page = await f.pages.get("alpha", "main");
  expect(page?.keyed).toEqual(["read"]); expect(page?.needs).toEqual({ content: ["path", "request-key"] });
  f.state.tools.delete("read"); await expect(f.pages.get("alpha", "main")).rejects.toThrow("重新登记");
});
const app = (builtin: boolean) => { const fixture = builtin ? moduleLifecycleFixtures.builtin : moduleLifecycleFixtures.external; return { ...fixture.row, origin: fixture.origin, capabilities: fixture.capabilities, health: {}, runs: [], versions: [{ hash: "f".repeat(64), status: "approved", createdAt: "2026-11-05" }] }; };
const overview = (builtin: boolean) => ({ app: app(builtin), permissions: { capabilities: ["联网"], secrets: [], grants: [], approvals: [], model: null }, settings: { declarations: {}, values: {} }, activity: [] });
test.each([true, false])("capabilities gate lifecycle controls and immutable version actions: builtin=%s", builtin => {
  const view = overview(builtin), route = { id: "id", tab: "overview", session: "" };
  const nodes = Object.values(detailSpec({ overview: view }, route).elements);
  expect(nodes.some(node => node.type === "AppRemoval")).toBe(!builtin);
  view.app.capabilities = { ...view.app.capabilities, remove: false, disable: false, enable: false };
  const disabled = Object.values(detailSpec({ overview: view }, route).elements);
  expect(disabled.some(node => node.type === "AppRemoval" || node.type === "SystemAction")).toBe(false);
  const versions = JSON.stringify(detailSpec({ overview: view }, { ...route, tab: "versions" }));
  expect(versions.includes("回滚到此版本")).toBe(!builtin);
  expect(JSON.stringify(detailSpec({ overview: view }, { ...route, tab: "permissions" }))).toContain("联网");
});
test.each(["pending", "building", "pending_approval", "installed", "failed", "unavailable"])("official installation state %s stays distinct from paused", status => {
  const receipt = { ...moduleLifecycleFixtures.failedInstall, status, error: status === "failed" ? moduleLifecycleFixtures.failedInstall.error : null };
  const result = JSON.stringify(appsSpec({ apps: [], systemApps: [], credentials: [], catalog: [{ name: "qq", available: true, description: "消息入口", releaseHash: "x", moduleId: null, installation: receipt, error: null }] }));
  expect(result).not.toContain("已暂停");
  expect(result.includes("PackageInstall")).toBe(!["pending", "building", "pending_approval"].includes(status));
  if (status === "pending_approval") expect(result).toContain("等待现有请求");
});
test("empty, loading, configuration and missing-active states expose next actions", () => {
  expect(JSON.stringify(appsSpec({}))).toContain("加载中");
  expect(JSON.stringify(appsSpec({ apps: [], systemApps: [], catalog: [] }))).toContain("还没有应用");
  const view = overview(false); view.app.activeHash = ""; view.permissions.secrets = [{ configured: false }] as never;
  const serialized = JSON.stringify(detailSpec({ overview: view }, { id: "id", tab: "overview", session: "" }));
  expect(serialized).toContain("尚未启用"); expect(serialized).toContain("待配置"); expect(serialized).not.toContain("已暂停");
});
test("lost installation receipts and pending requests retain a key across reopening; only explicit terminal retry gets a new key", () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const first = installationRequest("qq", "install", storage);
  expect(installationRequest("qq", "install", storage)).toEqual(first);
  const receipt = { ...moduleLifecycleFixtures.failedInstall, requestKey: first.requestKey };
  settleInstallation({ ...receipt, status: "pending", error: null }, "install", storage);
  expect(installationRequest("qq", "install", storage)).toEqual(first);
  settleInstallation({ ...receipt, requestKey: "old-attempt" }, "install", storage);
  expect(installationRequest("qq", "install", storage)).toEqual(first);
  settleInstallation(receipt, "install", storage);
  expect(installationRequest("qq", "install", storage).requestKey).not.toBe(first.requestKey);
  expect(installationRequest("qq", "update", storage).mode).toBe("update");
});
test("catalog/install/rollback adapters preserve exact request keys and failures", async () => {
  const mapped: unknown[] = [], call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  const request = moduleLifecycleFixtures.install;
  await call("$web.install", request); await call("$web.install", request); await call("$web.catalog", {}); await call("$web.module-rollback", { id: "a/b", hash: "a".repeat(64) });
  expect(mapped).toEqual([["/install", { method: "POST", body: request }], ["/install", { method: "POST", body: request }], ["/catalog"], ["/modules/a%2Fb/rollback", { method: "POST", body: { hash: "a".repeat(64) } }]]);
  const failing = systemCall({ web: async () => { throw new Error("需先处置活动会话"); }, tool: async () => ({}), login: async () => {} });
  await expect(failing("$web.module-remove", { id: "alpha" })).rejects.toThrow("活动会话");
  await expect(failing("$web.pages", {})).rejects.toThrow("活动会话");
});
