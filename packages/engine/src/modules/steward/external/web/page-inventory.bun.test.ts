import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createPages, type Deps, type ModuleState, type PageTool } from "./pages";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const spec = { root: "text", elements: { text: { type: "Text", props: { text: "Read" }, children: [] } } };
const input = { id: "main", title: "Page", data: { view: { tool: "read" } }, spec };
async function fixture(register = true) {
  const dataDir = await mkdtemp("/tmp/chrona-page-inventory-"); dirs.push(dataDir);
  const modules: ModuleState[] = ["alpha", "beta"].map(name => ({ id: `${name}-id`, name, status: "active", activeHash: "approved" }));
  const tools = (module: string) => new Map<string, PageTool>([["read", { inputSchema: {}, moduleId: `${module}-id` }]]);
  const state = { discoveries: 0, moduleReads: 0, filteredReads: 0, fail: false, filteredFailure: false, moduleFailure: false,
    inventory: modules.map(module => ({ ...tools(module.name).get("read")!, target: `${module.name}.read` })) };
  const deps: Deps = { dataDir,
    modules: async () => { state.moduleReads++; if (state.moduleFailure) throw new Error("directory unavailable"); return modules; },
    tools: async module => { state.filteredReads++; if (state.filteredFailure) throw new Error("discovery unavailable"); return tools(module); },
    toolInventory: async () => { state.discoveries++; if (state.fail) throw new Error("discovery unavailable"); return state.inventory; },
  };
  const pages = createPages(deps);
  if (register) for (const module of ["alpha", "beta"]) {
    const caller = { kind: "module", module, moduleId: `${module}-id` };
    await pages.tool("page-set", input, caller);
    await pages.tool("page-set", { ...input, id: "second" }, caller);
  }
  state.filteredReads = 0; state.moduleReads = 0;
  return { dataDir, modules, state, deps, pages };
}

test("navigation discovers all apps once per operation while individual page reads keep filtered discovery", async () => {
  const f = await fixture();
  expect((await f.pages.list()).map(page => `${page.module}/${page.id}`)).toEqual(["alpha/main", "alpha/second", "beta/main", "beta/second"]);
  expect(f.state).toMatchObject({ discoveries: 1, moduleReads: 1, filteredReads: 0 });
  await Promise.all([f.pages.list(), f.pages.list()]);
  expect(f.state).toMatchObject({ discoveries: 3, moduleReads: 3, filteredReads: 0 });
  expect(await f.pages.get("alpha", "main")).toMatchObject({ moduleId: "alpha-id", data: { view: { tool: "read" } } });
  expect(f.state).toMatchObject({ discoveries: 3, moduleReads: 4, filteredReads: 1 });
});

test("next navigation read rechecks visibility, exact prefixes and identities while permitting description upgrades", async () => {
  const f = await fixture();
  expect(await f.pages.list()).toHaveLength(4);
  const alpha = f.state.inventory[0]!;
  f.state.inventory = [f.state.inventory[1]!, { ...alpha, target: "alpha-extra.read" }, { ...alpha, target: "other.alpha" }];
  expect((await f.pages.list()).map(page => page.module)).toEqual(["beta", "beta"]);
  f.state.inventory.push({ ...alpha, moduleId: "replacement-id" });
  expect(await f.pages.list()).toHaveLength(2);
  f.state.inventory[f.state.inventory.length - 1] = { ...alpha, inputSchema: { description: "Updated read description" } };
  expect(await f.pages.list()).toHaveLength(4);
  f.state.inventory[f.state.inventory.length - 1] = alpha;
  expect(await f.pages.list()).toHaveLength(4);
  expect(f.state.discoveries).toBe(5);
  expect(JSON.parse(await readFile(`${f.dataDir}/pages.json`, "utf8")).pages).toHaveLength(4);
});

test("complete module inventory alone controls pruning even when tool discovery omits an owner", async () => {
  const f = await fixture();
  f.state.inventory = [];
  expect(await f.pages.list()).toEqual([]);
  expect(JSON.parse(await readFile(`${f.dataDir}/pages.json`, "utf8")).pages).toHaveLength(4);
  f.modules.splice(0, 1);
  expect(await f.pages.list()).toEqual([]);
  const saved = JSON.parse(await readFile(`${f.dataDir}/pages.json`, "utf8"));
  expect(saved.pages.map((page: { module: string }) => page.module)).toEqual(["beta", "beta"]);
  f.state.inventory = [{ target: "beta.read", inputSchema: {}, moduleId: "beta-id" }];
  expect(await createPages(f.deps).list()).toHaveLength(2);
});

test("discovery and authoritative inventory failures fail closed and never erase registrations", async () => {
  const f = await fixture(), before = await readFile(`${f.dataDir}/pages.json`, "utf8");
  f.state.fail = true; f.state.filteredFailure = true;
  await expect(f.pages.list()).rejects.toThrow("discovery unavailable");
  expect(f.state).toMatchObject({ discoveries: 1, filteredReads: 2 });
  expect(await readFile(`${f.dataDir}/pages.json`, "utf8")).toBe(before);
  f.state.moduleFailure = true;
  await expect(f.pages.list()).rejects.toThrow("directory unavailable");
  expect(f.state.discoveries).toBe(1);
  expect(await readFile(`${f.dataDir}/pages.json`, "utf8")).toBe(before);
  f.state.fail = false; f.state.filteredFailure = false; f.state.moduleFailure = false;
  expect(await f.pages.list()).toHaveLength(4);
  expect(f.state.discoveries).toBe(2);
});

test("empty or paused navigation never starts discovery", async () => {
  const empty = await fixture(false);
  expect(await empty.pages.list()).toEqual([]);
  expect(empty.state.discoveries).toBe(0);
  const paused = await fixture();
  paused.modules.forEach(module => { module.status = "paused"; });
  expect(await paused.pages.list()).toEqual([]);
  expect(paused.state.discoveries).toBe(0);
  paused.modules[0]!.status = "active";
  expect(await paused.pages.list()).toHaveLength(2);
  expect(paused.state.discoveries).toBe(1);
});

test("Web wiring completes list and user discovery pages through its existing SDK caller", async () => {
  const f = await fixture(false), requests: { target: string; args: Record<string, unknown> }[] = [];
  const sdk = { paths: { data: f.dataDir }, dependencies: {} as Record<string, string>,
    async call(target: string, args: Record<string, unknown>) {
      expect(this).toBe(sdk);
      requests.push({ target, args: { ...args } });
      if (target === "modules.list") return args.cursor ? { items: [f.modules[1]], nextCursor: null } : { items: [f.modules[0]], nextCursor: "modules-next" };
      if (target !== "modules.describe") throw new Error(`Unexpected ${target}`);
      expect(args.audience).toBe("user");
      const item = (module: string) => ({ target: { moduleId: `${module}-id`, tool: "read" },
        moduleId: `${module}-id`, inputSchema: {} });
      if (args.query) return { items: [item(String(args.query))], nextCursor: null };
      return args.cursor ? { items: [item("beta")], nextCursor: null } : { items: [item("alpha")], nextCursor: "tools-next" };
    },
  };
  // Evaluate the real callbacks and private wire adapter without starting Web's server or timers.
  const entry = await Bun.file(new URL("./index.ts", import.meta.url)).text();
  const adapter = (await Bun.file(new URL("./kernel-client.ts", import.meta.url)).text()).replace(/^import .*;$/gm, "").replace("export async function", "async function");
  const call = entry.slice(entry.indexOf("const call ="), entry.indexOf("\nconst ownSettings"));
  const pages = entry.slice(entry.indexOf("const pages = createPages("), entry.indexOf('\non("tool"'));
  const script = new Bun.Transpiler({ loader: "ts" }).transformSync(`${adapter}\n${call}\n${pages}\nglobalThis.wiredPages = pages;`);
  const wired = runInNewContext(`${script}\nglobalThis.wiredPages;`, { chrona: sdk, createPages }) as ReturnType<typeof createPages>;
  for (const module of ["alpha", "beta"]) await wired.tool("page-set", input, { kind: "module", module, moduleId: `${module}-id` });
  requests.length = 0;
  expect((await wired.list()).map(page => page.module)).toEqual(["alpha", "beta"]);
  expect(requests.map(request => request.target)).toEqual(["modules.list", "modules.list", "modules.describe", "modules.describe"]);
  expect(requests[3]!.args).toEqual({ audience: "user", cursor: "tools-next" });
  expect(sdk.dependencies).toEqual({ alpha: "alpha-id", beta: "beta-id" });
  requests.length = 0;
  expect(await wired.get("beta", "main")).toMatchObject({ moduleId: "beta-id" });
  expect(requests.at(-1)).toEqual({ target: "modules.describe", args: { query: "beta", audience: "user" } });
});

test("shared discovery preserves executable page version and revision pins", async () => {
  const f = await fixture(false), caller = { kind: "module", module: "alpha", moduleId: "alpha-id", hash: "approved" };
  const component = { name: "Widget", javascript: "export default () => {};", tools: ["read"],
    props: { type: "object", properties: {}, additionalProperties: false } };
  const registration = { id: "widget", title: "Widget", spec: { root: "widget", elements: { widget: { type: "alpha:Widget", props: {}, children: [] } } } };
  await f.pages.tool("component-set", component, caller);
  await f.pages.tool("page-set", registration, caller);
  expect(await f.pages.list()).toHaveLength(1);
  f.modules[0]!.activeHash = "new-approved";
  expect(await f.pages.list()).toEqual([]);
  f.modules[0]!.activeHash = "approved";
  expect(await f.pages.list()).toHaveLength(1);
  await f.pages.tool("component-set", { ...component, css: ".widget { color: inherit; }" }, caller);
  expect(await f.pages.list()).toEqual([]);
  await f.pages.tool("page-set", registration, caller);
  expect(await f.pages.list()).toHaveLength(1);
  f.state.inventory[0]!.inputSchema.description = "Updated read description";
  expect(await f.pages.list()).toHaveLength(1);
  f.state.inventory[0]!.moduleId = "replacement-id";
  expect(await f.pages.list()).toEqual([]);
});


test("unrelated oversized inventory falls back to current filtered discovery once per page owner", async () => {
  const f = await fixture();
  f.deps.toolInventory = async () => { f.state.discoveries++; throw new Error("A list item exceeds the output bound"); };
  expect(await f.pages.list()).toHaveLength(4);
  expect(f.state).toMatchObject({ discoveries: 1, filteredReads: 2 });
  f.deps.tools = async module => new Map([["read", { inputSchema: { description: "Updated read description" }, moduleId: `${module}-id` }]]);
  expect(await f.pages.list()).toHaveLength(4);
  expect(f.state.discoveries).toBe(2);
  f.deps.tools = async () => new Map();
  expect(await f.pages.list()).toEqual([]);
  expect(f.state.discoveries).toBe(3);
});
