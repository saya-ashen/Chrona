import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { createPages, type ModuleState, type PageTool } from "./pages";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const spec = { root: "text", elements: { text: { type: "Text", props: { text: "Read" }, children: [] } } };
const input = { id: "main", title: "Original", data: { view: { tool: "read" } }, spec };
const caller = (module: string) => ({ kind: "module", module, moduleId: `${module}-id`, hash: "approved" });
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-page-reads-"); dirs.push(dataDir);
  const modules: ModuleState[] = ["alpha", "beta"].map(name => ({ id: `${name}-id`, name, status: "active", activeHash: "approved" }));
  const tools = (module: string) => new Map<string, PageTool>([["read", { inputSchema: {}, moduleId: `${module}-id` }]]);
  const deps = { dataDir, modules: async () => modules, tools: async (module: string) => tools(module) };
  const pages = createPages(deps);
  for (const module of ["alpha", "beta"]) await pages.tool("page-set", input, caller(module));
  return { dataDir, modules, tools, deps, pages };
}

test("independent page, component and navigation reads overlap fresh authoritative inventories", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const registered = await f.pages.tool("component-set", { name: "Example", javascript: "export default function mount() {}", props: { type: "object", properties: {}, additionalProperties: false } }, caller("alpha")) as { revision: string };
  let reads = 0;
  f.deps.modules = async () => { if (++reads === 3) entered.resolve(); await release.promise; return f.modules; };
  const list = f.pages.list(), page = f.pages.get("alpha", "main"), component = f.pages.component("alpha", "Example", registered.revision);
  try { await entered.promise; expect(reads).toBe(3); }
  finally { release.resolve(); }
  expect(await list).toHaveLength(2);
  expect(await page).toMatchObject({ title: "Original" });
  expect(await component).toMatchObject({ name: "Example", revision: registered.revision });
});

test("a queued writer waits for earlier validation and precedes later reads", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let reads = 0;
  f.deps.tools = async module => { if (++reads === 1) { entered.resolve(); await release.promise; } return f.tools(module); };
  const before = f.pages.get("alpha", "main");
  await entered.promise;
  let wrote = false;
  const writer = f.pages.tool("page-set", { ...input, title: "Updated" }, caller("alpha")).then(() => { wrote = true; });
  const after = f.pages.get("alpha", "main");
  try { await setImmediate(); expect(reads).toBe(1); expect(wrote).toBe(false); }
  finally { release.resolve(); }
  expect(await before).toMatchObject({ title: "Original" });
  await writer;
  expect(await after).toMatchObject({ title: "Updated" });
  expect(await createPages(f.deps).get("alpha", "main")).toMatchObject({ title: "Updated" });
});

test("a rejected inventory releases the writer barrier without pruning registrations", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let reads = 0;
  f.deps.modules = async () => { if (++reads === 1) { entered.resolve(); await release.promise; throw new Error("inventory unavailable"); } return f.modules; };
  const failure = f.pages.list().catch((error: Error) => error);
  await entered.promise;
  const writer = f.pages.tool("page-set", { ...input, title: "Recovered" }, caller("alpha"));
  release.resolve();
  expect(await failure).toMatchObject({ message: "inventory unavailable" });
  await writer;
  expect(await f.pages.list()).toHaveLength(2);
  expect(await createPages(f.deps).get("alpha", "main")).toMatchObject({ title: "Recovered" });
});

test("per-app discovery overlaps, drains failures before mutation, and preserves registration order", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const discovered: string[] = [];
  f.deps.tools = async module => {
    discovered.push(module); if (discovered.length === 2) entered.resolve();
    if (module === "alpha") throw new Error("discovery unavailable");
    await release.promise; return f.tools(module);
  };
  const failure = f.pages.list().catch((error: Error) => error);
  await entered.promise;
  let wrote = false;
  const writer = f.pages.tool("page-remove", { id: "main" }, caller("alpha")).then(() => { wrote = true; });
  try { await setImmediate(); expect(wrote).toBe(false); expect(discovered).toEqual(["alpha", "beta"]); }
  finally { release.resolve(); }
  expect(await failure).toMatchObject({ message: "discovery unavailable" });
  await writer;
  f.deps.tools = async module => f.tools(module);
  await f.pages.tool("page-set", input, caller("alpha"));
  expect((await f.pages.list()).map(page => page.module)).toEqual(["beta", "alpha"]);
});

test("overlapping reads serialize durable pruning without losing retained owners", async () => {
  const f = await fixture();
  f.modules.splice(0, 1);
  const pages = createPages(f.deps);
  const reads = await Promise.all(Array.from({ length: 12 }, (_, index) => index % 2 ? pages.list() : pages.get("beta", "main")));
  expect(reads).toHaveLength(12);
  expect(JSON.parse(await readFile(`${f.dataDir}/pages.json`, "utf8"))).toMatchObject({ pages: [{ module: "beta" }] });
  expect((await createPages(f.deps).list()).map(page => page.module)).toEqual(["beta"]);
});
