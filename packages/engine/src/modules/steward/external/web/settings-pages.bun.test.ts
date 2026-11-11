import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createPages, pageErrors, type ModuleState } from "./pages";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const spec = { root: "text", elements: { text: { type: "Text", props: { text: "设置内容" }, children: [] } } };
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-settings-pages-"); dirs.push(dataDir);
  const modules: ModuleState[] = [{ id: "owner-id", name: "fixture", status: "active", activeHash: "active" }];
  const tools = new Map([["read", { inputSchema: {}, moduleId: "owner-id", contractHash: "a".repeat(64) }]]);
  const deps = { dataDir, modules: async () => modules, tools: async () => tools };
  return { deps, modules, tools, caller: { kind: "module", module: "fixture", moduleId: "owner-id" }, input: { id: "preferences", title: "偏好设置", purpose: "settings", data: { view: { tool: "read" } }, spec } };
}
test("settings purpose survives restart and is exposed through both page lists", async () => {
  const { deps, caller, input } = await fixture();
  await createPages(deps).tool("page-set", input, caller);
  const pages = createPages(deps), page = await pages.get("fixture", "preferences");
  expect(page).toMatchObject({ moduleId: "owner-id", purpose: "settings", contracts: { read: "a".repeat(64) } });
  expect(await pages.list()).toEqual([{ module: "fixture", moduleId: "owner-id", id: "preferences", title: "偏好设置", purpose: "settings" }]);
  expect(await pages.tool("pages", {}, caller)).toMatchObject({ items: [{ id: "preferences", purpose: "settings" }] });
  const revision = page!.revision;
  await pages.tool("page-set", { ...input, title: "新设置" }, caller);
  expect((await pages.get("fixture", "preferences"))!.revision).not.toBe(revision);
});
test("concurrent conflicting registrations cannot create a second settings page; an ordinary replacement releases the purpose", async () => {
  const { deps, caller, input } = await fixture(), pages = createPages(deps);
  const results = await Promise.allSettled([pages.tool("page-set", input, caller), pages.tool("page-set", { ...input, id: "other" }, caller)]);
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect((results[1] as PromiseRejectedResult).reason.code).toBe("conflict");
  expect(await pages.list()).toHaveLength(1);
  await pages.tool("page-set", { ...input, purpose: undefined }, caller);
  await pages.tool("page-set", { ...input, id: "other" }, caller);
  expect((await pages.list()).filter(page => page.purpose === "settings").map(page => page.id)).toEqual(["other"]);
});
test.each([null, "general", "Settings", {}, false])("invalid purpose %j is rejected without changing the registry", async purpose => {
  const { deps, caller, input } = await fixture(), pages = createPages(deps);
  expect(pageErrors({ spec, purpose }, new Map(), "fixture").join()).toContain("purpose");
  await expect(pages.tool("page-set", { ...input, purpose }, caller)).rejects.toMatchObject({ code: "invalid" });
  expect(await pages.list()).toEqual([]);
});
test.each([
  { label: "unchanged", contractHash: "a".repeat(64), visible: true },
  { label: "replaced", contractHash: "b".repeat(64), visible: false },
])("settings navigation validates $label tool contracts while retaining valid pages", async ({ contractHash, visible }) => {
  const { deps, caller, input, tools } = await fixture();
  const registry = createPages(deps);
  tools.set("stable", { ...tools.get("read")! });
  await registry.tool("page-set", input, caller);
  await registry.tool("page-set", { ...input, id: "stable", title: "有效页面", purpose: undefined, data: { view: { tool: "stable" } } }, caller);
  tools.set("read", { ...tools.get("read")!, contractHash });
  const pages = createPages(deps);
  const settings = { module: "fixture", moduleId: "owner-id", id: input.id, title: input.title, purpose: "settings" };
  const stable = { module: "fixture", moduleId: "owner-id", id: "stable", title: "有效页面" };
  expect(await pages.list()).toEqual(visible ? [settings, stable] : [stable]);
  if (visible) expect(await pages.get("fixture", input.id)).toMatchObject({ contracts: { read: contractHash }, purpose: "settings" });
  else await expect(pages.get("fixture", input.id)).rejects.toMatchObject({ code: "conflict" });
  expect(await pages.get("fixture", "stable")).toMatchObject({ contracts: { stable: "a".repeat(64) } });
  // Listing must preserve the registration so the app can renew its pinned contract.
  await pages.tool("page-set", input, caller);
  expect(await pages.list()).toEqual([stable, settings]);
  expect(await pages.get("fixture", input.id)).toMatchObject({ contracts: { read: contractHash } });
});
test("settings preserve active-owner and pinned-tool checks across pause, contract replacement and owner recreation", async () => {
  const { deps, caller, input, modules, tools } = await fixture(), pages = createPages(deps);
  await pages.tool("page-set", input, caller);
  modules[0]!.status = "paused";
  expect(await pages.list()).toEqual([]);
  await expect(pages.get("fixture", input.id)).rejects.toMatchObject({ code: "conflict" });
  await expect(pages.tool("page-set", input, caller)).rejects.toMatchObject({ code: "conflict" });
  modules[0]!.status = "active";
  tools.set("read", { ...tools.get("read")!, contractHash: "b".repeat(64) });
  await expect(pages.get("fixture", input.id)).rejects.toMatchObject({ code: "conflict" });
  modules[0]!.id = "new-owner";
  expect(await pages.list()).toEqual([]);
  expect(await pages.get("fixture", input.id)).toBeNull();
  await expect(pages.tool("page-set", input, caller)).rejects.toMatchObject({ code: "conflict" });
});

test("one inventory reuses each app discovery, and subsequent reads revalidate changed pins", async () => {
  const { deps, caller, input, tools } = await fixture();
  let reads = 0;
  const pages = createPages({ ...deps, tools: async () => { reads++; return tools; } });
  await pages.tool("page-set", input, caller);
  await pages.tool("page-set", { ...input, id: "main", purpose: undefined }, caller);
  reads = 0;
  expect(await pages.list()).toHaveLength(2);
  expect(reads).toBe(1);
  tools.set("read", { ...tools.get("read")!, contractHash: "b".repeat(64) });
  expect(await pages.list()).toEqual([]);
  expect(reads).toBe(2);
  await expect(pages.get("fixture", "main")).rejects.toMatchObject({ code: "conflict" });
  expect(reads).toBe(3);
});
