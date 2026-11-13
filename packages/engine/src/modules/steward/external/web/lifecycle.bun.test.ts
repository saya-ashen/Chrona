import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPages, type ModuleState, type PageTool } from "./pages";
import { appsSpec } from "./src/system/apps";
import { detailSpec, detailData } from "./src/system/detail";
import { systemCall } from "./src/system/adapter";
import { historicalConversation } from "./src/system/chat-stream";
import { toolArguments } from "./src/system/forms";
import { moduleIdentity } from "../../module-identity";

const cleanups: string[] = [];
afterEach(async () => { for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true }); });
const spec = { root: "text", elements: { text: { type: "Text", props: { text: "示例" }, children: [], on: {} } } };
const withRead = { root: "button", elements: { button: { type: "Button", props: { label: "读取" }, children: [], on: { press: { action: "call", params: { tool: "read", args: { path: "x" } } } } } } };
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-web-lifecycle-"); cleanups.push(dataDir);
  const state = { modules: [{ id: "alpha-id", name: "alpha", status: "active", activeHash: "a" }, { id: "beta-id", name: "beta", status: "active", activeHash: "b" }] as ModuleState[], fail: false,
    tools: new Map<string, PageTool>([["read", { moduleId: "alpha-id", inputSchema: { properties: { path: { type: "string" } }, required: ["path"] } }]]) };
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
test("description upgrades preserve registered pages and legacy contracts while current schemas derive metadata and reject removed arguments", async () => {
  const f = await fixture(); await f.register();
  const revision = (await f.pages.get("alpha", "main"))!.revision;
  f.state.modules[0]!.activeHash = "new-code";
  f.state.tools.get("read")!.inputSchema.description = "Updated read description";
  expect(await f.pages.get("alpha", "main")).toMatchObject({ revision, needs: { content: ["path"] } });
  const file = join(f.dataDir, "pages.json"), stored = JSON.parse(await readFile(file, "utf8"));
  expect(stored.pages[0]).not.toHaveProperty("contracts");
  stored.pages[0].contracts = { read: "obsolete", unreferenced: "legacy-pin" };
  await writeFile(file, JSON.stringify(stored));
  const restarted = createPages({ dataDir: f.dataDir, modules: async () => f.state.modules, tools: async () => f.state.tools });
  expect(await restarted.list()).toHaveLength(1);
  expect(await restarted.get("alpha", "main")).toMatchObject({ revision });
  f.state.tools.get("read")!.inputSchema = { properties: { renamed: {} }, required: ["renamed"] };
  await expect(restarted.get("alpha", "main")).rejects.toThrow("重新登记");
  await expect(f.register()).rejects.toMatchObject({ code: "invalid" });
  f.state.tools.get("read")!.inputSchema = { properties: { path: {}, "request-key": {} }, required: ["path", "request-key"] };
  const page = await restarted.get("alpha", "main");
  expect(page?.revision).toBe(revision);
  expect(page?.keyed).toEqual(["read"]); expect(page?.needs).toEqual({ content: ["path", "request-key"] });
  f.state.tools.delete("read"); await expect(restarted.get("alpha", "main")).rejects.toThrow("重新登记");
});
const app = (name = "alpha") => {
  const row = { id: `fixture-${name}`, name, builtin: false, status: "active", activeHash: "a".repeat(64) };
  return { ...row, ...moduleIdentity(row), health: {}, runs: [], versions: [{ hash: "f".repeat(64), status: "approved", createdAt: "2026-11-05" }] };
};
const overview = (name = "alpha") => ({ app: app(name) });
const route = { id: "id", tab: "overview", session: "" };
const contract = (target: string) => ({ target, description: "合同", inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "object" } } } }, outputSchema: { type: "object" }, idempotent: false });
test("contracts come from exact target prefixes and only user-discovered tools get forms", () => {
  const view = overview("pi"), tools = [contract("pi.configure"), contract("pi.models"), contract("other.pi"), contract("pi-extra.read")];
  const result = detailSpec({ overview: view, tools, userTools: [contract("pi.models"), contract("other.pi")] }, { ...route, tab: "tools" });
  const nodes = Object.values(result.elements);
  expect(nodes.filter(node => node.type === "ToolContract").map(node => (node.props.tool as { target: string }).target)).toEqual(["pi.configure", "pi.models"]);
  expect(nodes.filter(node => node.type === "ToolForm").map(node => (node.props.tool as { target: string }).target)).toEqual(["pi.models"]);
  const noUser = detailSpec({ overview: view, tools }, { ...route, tab: "tools" });
  expect(Object.values(noUser.elements).some(node => node.type === "ToolForm")).toBe(false);
});
test.each(["pi", "alpha"])("ordinary %s capabilities gate removal and version actions", name => {
  const view = overview(name);
  expect(view.app).toMatchObject({ builtin: false, origin: "external" });
  const managed = Object.values(appsSpec({ apps: [view.app], systemApps: [] }).elements);
  expect(managed.some(node => node.type === "AppRemoval")).toBe(true);
  expect(Object.values(detailSpec({ overview: view }, route).elements).some(node => node.type === "AppRemoval" || node.type === "SystemAction")).toBe(false);
  const versions = JSON.stringify(detailSpec({ overview: view }, { ...route, tab: "versions" }));
  expect(versions.includes("回滚到此版本")).toBe(true);
  view.app.capabilities = { ...view.app.capabilities, remove: false, disable: false, enable: false, rollback: false };
  const disabled = Object.values(appsSpec({ apps: [view.app], systemApps: [] }).elements);
  expect(disabled.some(node => node.type === "AppRemoval" || node.type === "SystemAction")).toBe(false);
  expect(JSON.stringify(detailSpec({ overview: view }, { ...route, tab: "versions" }))).not.toContain("回滚到此版本");
});
test.each(["active", "paused", "migrating"])("application list owns lifecycle actions for %s apps", status => {
  const current = { ...app(), status };
  const result = appsSpec({ apps: [current], systemApps: [] });
  const nodes = Object.values(result.elements), control = nodes.find(node => node.type === "SystemAction");
  expect(nodes.some(node => node.type === "AppRemoval")).toBe(status !== "migrating");
  if (status === "migrating") expect(control).toBeUndefined();
  else expect(control?.props).toMatchObject({ label: status === "active" ? "暂停" : "恢复", tool: status === "active" ? "module-disable" : "module-enable", args: { id: current.id } });
  const missingActive = Object.values(appsSpec({ apps: [{ ...current, activeHash: null }], systemApps: [] }).elements);
  expect(missingActive.some(node => node.type === "AppRemoval" || node.type === "SystemAction")).toBe(false);
});
test("directory retains exactly kernel and module groups without distribution controls", () => {
  const external = app(), pi = app("pi");
  expect([external, pi].filter(app => app.builtin)).toEqual([]);
  const result = appsSpec({ apps: [pi, external], systemApps: [{ name: "approvals", description: "审批" }] });
  expect(Object.values(result.elements).filter(node => node.type === "Card").map(node => node.props.title)).toEqual(["内核", "模块"]);
  const text = JSON.stringify(result);
  for (const value of [`/apps/${external.id}`, `/apps/${pi.id}`, "/apps/system/approvals", "外置"]) expect(text).toContain(value);
  expect(text).not.toContain("内置");
  expect(text).not.toContain("PackageInstall"); expect(text).not.toContain("安装目录");
});
test.each(["configured", "unconfigured", "registered"] as const)("kernel runtime %s remains factual and read-only", status => {
  const runtime = { status, backend: status === "configured" ? "pi" : null, responsibility: "治理 Agent 和已注册 Provider", configuration: "修改启动配置后重启" };
  const directory = appsSpec({ apps: [], systemApps: [{ name: "agent", description: "执行能力", runtime }] });
  expect(JSON.stringify(directory)).toContain(status === "configured" ? "后端已配置：pi" : status === "unconfigured" ? "后端未配置" : "已注册 · 按需使用");
  for (const tab of ["overview", "tools"]) {
    const result = detailSpec({ overview: { description: "执行能力", runtime }, tools: [contract("agent.run")], userTools: [contract("agent.run")] }, { id: "agent", tab, session: "" }, true);
    const nodes = Object.values(result.elements), text = JSON.stringify(result);
    expect(result.elements[result.root]!.props.title).toBe("agent · 内核");
    expect(text).toContain("内核接口");
    expect(nodes.some(node => ["SystemAction", "AppRemoval", "ToolForm", "SettingsForm"].includes(node.type))).toBe(false);
    if (tab === "overview") expect(text).toContain("修改启动配置后重启");
    else expect(text).toContain("agent.run");
  }
});
test.each(["pi", "web", "notify"])("preinstalled %s retains ordinary lifecycle and version history", name => {
  const current = app(name);
  const nodes = Object.values(appsSpec({ apps: [current], systemApps: [] }).elements);
  expect(nodes.find(node => node.type === "AppRemoval")?.props.name).toBe(name);
  expect(nodes.find(node => node.type === "SystemAction")?.props.tool).toBe("module-disable");
  expect(JSON.stringify(detailSpec({ overview: { app: current } }, { ...route, tab: "versions" }))).toContain("回滚到此版本");
  const unavailable = Object.values(appsSpec({ apps: [{ ...current, capabilities: { ...current.capabilities, remove: false } }], systemApps: [] }).elements);
  expect(unavailable.some(node => node.type === "AppRemoval")).toBe(false);
});
test("old configuration tabs and health reports do not invent supported actions", () => {
  const view = overview();
  Object.assign(view.app.health, { runtime: { state: "running" }, healthCheck: true, readiness: { summary: "stale report" } });
  for (const tab of ["overview", "settings", "permissions"]) {
    const result = JSON.stringify(detailSpec({ overview: view }, { ...route, tab }));
    expect(result).toContain(tab === "settings" ? "正在读取应用设置入口" : "运行中");
    for (const removed of ["stale report", "module-refresh-health", "SettingsForm", "构建需求", "tab=permissions"]) expect(result).not.toContain(removed);
  }
  expect(JSON.stringify(appsSpec({}))).toContain("加载中");
  expect(JSON.stringify(appsSpec({ apps: [], systemApps: [] }))).toContain("还没有已安装的模块");
});
test("author guidance only links when exact author user tools exist", () => {
  const base = { overview: { description: "模块管理" } }, target = { id: "modules", tab: "overview", session: "" };
  const empty = JSON.stringify(detailSpec({ ...base, authorTools: [contract("other.read")] }, target, true));
  expect(empty).toContain("自动模型创作暂不可用"); expect(empty).not.toContain("打开 author 模块工具");
  const available = JSON.stringify(detailSpec({ ...base, authorTools: [{ ...contract("author.prepare"), moduleId: "author/id" }] }, target, true));
  expect(available).toContain("/apps/author%2Fid?tab=tools");
});
test("detail data uses tools queries and never fetches central configuration or catalogs", () => {
  const tools = detailData({ ...route, tab: "tools" }, false);
  expect(tools.tools?.args).toEqual({ query: { $state: "/overview/app/name" } });
  expect(tools.userTools?.args).toEqual({ query: { $state: "/overview/app/name" }, audience: "user" });
  for (const tab of ["overview", "tools", "activity", "versions", "settings", "permissions"]) {
    const names = Object.values(detailData({ ...route, tab }, false)).map(source => source.tool);
    expect(names).not.toContain("catalog"); expect(names).not.toContain("settings");
  }
});
test("nested author inputs remain JSON objects and historical builds cannot be edited", () => {
  expect(toolArguments('{"files":[{"path":"module.json","content":"{}"}]}')).toEqual({ files: [{ path: "module.json", content: "{}" }] });
  for (const value of ["[]", "null", '"text"', "1"]) expect(() => toolArguments(value)).toThrow("JSON 对象");
  expect(historicalConversation("build:old", true)).toBe(true);
  expect(historicalConversation("web-agent:new", false)).toBe(false);
});
test("contract and lifecycle adapters preserve arguments and real failures; removed operations reject", async () => {
  const mapped: unknown[] = [], call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}), login: async () => {} });
  await call("$web.tools", { query: "a/b 中", audience: "user" });
  await call("$web.module-rollback", { id: "a/b", hash: "a".repeat(64) });
  expect(mapped).toEqual([["/tools?query=a%2Fb%20%E4%B8%AD&audience=user"], ["/modules/a%2Fb/rollback", { method: "POST", body: { hash: "a".repeat(64) } }]]);
  for (const name of ["catalog", "install", "settings-save", "module-refresh-health", "revise-build", "stop-build"]) await expect(call(`$web.${name}`, {})).rejects.toThrow("未知系统操作");
  const failing = systemCall({ web: async () => { throw new Error("需先处置活动会话"); }, tool: async () => ({}), login: async () => {} });
  await expect(failing("$web.module-remove", { id: "web" })).rejects.toThrow("活动会话");
  await expect(failing("$web.detail-activity", { module: "web" })).rejects.toThrow("活动会话");
});


test("lifecycle controls bind application IDs even when the display name is reused", () => {
  const app = { id: "original-id", name: "reused-name", status: "active", activeHash: "old", builtin: false, origin: "external", capabilities: { disable: true, enable: true, remove: true, rollback: true }, health: { runtime: { state: "running" } } };
  const nodes = Object.values(appsSpec({ apps: [app], systemApps: [] }).elements);
  expect(nodes.find(node => node.type === "SystemAction")?.props.args).toEqual({ id: "original-id" });
  expect(nodes.find(node => node.type === "AppRemoval")?.props).toEqual({ moduleId: "original-id", name: "reused-name" });
});
