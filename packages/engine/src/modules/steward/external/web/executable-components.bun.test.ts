import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createPages, type Caller, type ModuleState, type PageTool } from "./pages";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const caller: Caller = { kind: "module", module: "alpha", moduleId: "alpha-id", hash: "approved-v1" };
const definition = {
  name: "AudioPlayer", javascript: "export default function mount(element, context) { element.textContent = context.props.title; return () => element.replaceChildren(); }",
  css: ".audio { color: inherit; }",
  props: { type: "object", properties: { title: { type: "string", minLength: 1 } }, required: ["title"], additionalProperties: false },
  events: ["ended"], slots: ["default", "actions"], tools: ["play"],
};
const spec = { root: "player", elements: {
  player: { type: "alpha:AudioPlayer", props: { title: "Track" }, children: ["label"], slots: { actions: ["label"] }, on: { ended: { action: "setState", params: { statePath: "/done", value: true } } } },
  label: { type: "Text", props: { text: "Audio" }, children: [] },
} };
const registration = { id: "main", title: "Audio", spec };
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-executable-components-")); dirs.push(dataDir);
  const modules: ModuleState[] = [
    { id: "alpha-id", name: "alpha", status: "active", activeHash: "approved-v1" },
    { id: "beta-id", name: "beta", status: "active", activeHash: "beta-v1" },
  ];
  const tools = new Map<string, PageTool>([["play", { moduleId: "alpha-id", inputSchema: { properties: { title: { type: "string" } } } }]]);
  const deps = { dataDir, modules: async () => modules, tools: async (module: string) => module === "alpha" ? tools : new Map<string, PageTool>() };
  return { dataDir, modules, tools, deps, pages: createPages(deps) };
}

test("real caller identity and current approved hash are required; arguments never select another app", async () => {
  const { pages } = await fixture();
  const identities: (Caller | undefined)[] = [undefined, { kind: "owner" }, { ...caller, hash: undefined }, { ...caller, moduleId: "beta-id" }, { ...caller, hash: "unapproved" }];
  for (const identity of identities) {
    await expect(pages.tool("component-set", definition, identity)).rejects.toMatchObject({ code: identity?.hash ? "conflict" : "forbidden" });
  }
  await expect(pages.tool("component-set", { ...definition, module: "beta" }, caller)).rejects.toMatchObject({ code: "invalid" });
  const result = await pages.tool("component-set", definition, caller) as { name: string; type: string; revision: string };
  expect(result).toEqual({ name: "AudioPlayer", type: "alpha:AudioPlayer", revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(await pages.component("alpha", "AudioPlayer", result.revision)).toMatchObject({ ...definition, module: "alpha", moduleId: "alpha-id", hash: "approved-v1" });
  await expect(pages.tool("page-set", registration, { ...caller, hash: "wrong" })).rejects.toMatchObject({ code: "conflict" });
  await expect(pages.tool("page-set", { ...registration, spec: { root: "x", elements: { x: { type: "alpha:AudioPlayer", props: { title: "foreign" } } } } }, { kind: "module", module: "beta", moduleId: "beta-id", hash: "beta-v1" })).rejects.toMatchObject({ code: "invalid" });
  expect(await pages.tool("component-remove", { name: "AudioPlayer" }, { kind: "module", module: "beta", moduleId: "beta-id", hash: "beta-v1" })).toEqual({ removed: false });
  expect(await pages.component("alpha", "AudioPlayer", result.revision)).toBeTruthy();
});

test("atomic private persistence survives restart, retains source and pins declared tools without action bindings", async () => {
  const f = await fixture();
  const registered = await f.pages.tool("component-set", definition, caller) as { name: string; type: string; revision: string };
  expect(await f.pages.tool("component-set", definition, caller)).toEqual(registered);
  await f.pages.tool("page-set", { ...registration, spec: { ...spec, elements: { ...spec.elements, player: { ...spec.elements.player, type: registered.type } } } }, caller);
  const restarted = createPages(f.deps), page = await restarted.get("alpha", "main");
  expect(page).toMatchObject({ hash: "approved-v1", extensions: { "alpha:AudioPlayer": { revision: registered.revision, props: definition.props, events: ["ended"], slots: ["default", "actions"], tools: ["play"] } } });
  expect(page!.spec.elements.player!.type).toBe("alpha:AudioPlayer");
  expect(await restarted.component("alpha", "AudioPlayer", registered.revision)).toMatchObject({ javascript: definition.javascript, css: definition.css });
  expect(await readdir(f.dataDir)).toEqual(expect.arrayContaining(["pages.json", "executable-components.json"]));
  expect((await readdir(f.dataDir)).some(name => name.endsWith(".tmp"))).toBe(false);
  expect(JSON.parse(await readFile(join(f.dataDir, "executable-components.json"), "utf8")).components).toHaveLength(1);
  f.tools.get("play")!.inputSchema.description = "Updated play description";
  expect(await restarted.get("alpha", "main")).toMatchObject({ revision: page!.revision });
  expect(await restarted.list()).toHaveLength(1);
  f.tools.delete("play");
  await expect(restarted.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  expect(await restarted.list()).toEqual([]);
});

test.each(["hash", "paused", "removed", "replaced-id"])("%s invalidates source, page and navigation, including after restart", async mode => {
  const f = await fixture();
  const { revision } = await f.pages.tool("component-set", definition, caller) as { revision: string };
  await f.pages.tool("page-set", registration, caller);
  if (mode === "hash") f.modules[0]!.activeHash = "approved-v2";
  if (mode === "paused") f.modules[0]!.status = "paused";
  if (mode === "removed") f.modules.shift();
  if (mode === "replaced-id") f.modules[0]!.id = "new-alpha-id";
  for (const pages of [f.pages, createPages(f.deps)]) {
    expect(await pages.list()).toEqual([]);
    if (["removed", "replaced-id"].includes(mode)) expect(await pages.get("alpha", "main")).toBeNull();
    else await expect(pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
    await expect(pages.component("alpha", "AudioPlayer", revision)).rejects.toMatchObject({ code: "conflict" });
    await expect(pages.tool("component-set", definition, caller)).rejects.toMatchObject({ code: "conflict" });
    await expect(pages.tool("component-remove", { name: "AudioPlayer" }, caller)).rejects.toMatchObject({ code: "conflict" });
  }
});

test("replacement and removal require pages to re-register, and missing/mismatched revisions never serve source", async () => {
  const f = await fixture();
  const first = await f.pages.tool("component-set", definition, caller) as { revision: string };
  await f.pages.tool("page-set", registration, caller);
  const second = await f.pages.tool("component-set", { ...definition, css: ".audio { color: red; }" }, caller) as { revision: string };
  expect(second.revision).not.toBe(first.revision);
  for (const revision of [first.revision, null, "wrong"]) await expect(f.pages.component("alpha", "AudioPlayer", revision)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.pages.list()).toEqual([]);
  await expect(f.pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  await f.pages.tool("page-set", registration, caller);
  expect(await f.pages.list()).toHaveLength(1);
  expect(await f.pages.tool("component-remove", { name: "AudioPlayer" }, caller)).toEqual({ removed: true });
  expect(await f.pages.list()).toEqual([]);
  await expect(f.pages.component("alpha", "AudioPlayer", second.revision)).rejects.toMatchObject({ code: "not_found" });
  expect(await createPages(f.deps).list()).toEqual([]);
});

test.each([
  ["missing required prop", { props: {} }], ["wrong prop type", { props: { title: 4 } }], ["unknown prop", { props: { title: "yes", hidden: true } }],
  ["unknown event", { on: { press: { action: "setState", params: {} } } }], ["unknown slot", { slots: { hidden: ["label"] } }],
  ["foreign action", { on: { ended: { action: "call", params: { tool: "beta.play", args: {} } } } }],
] as const)("page rejects %s", async (_, changes) => {
  const { pages } = await fixture(); await pages.tool("component-set", definition, caller);
  await expect(pages.tool("page-set", { ...registration, spec: { ...spec, elements: { ...spec.elements, player: { ...spec.elements.player, ...changes } } } }, caller)).rejects.toMatchObject({ code: "invalid" });
});

test("dynamic props, callbacks and default slots validate, while undeclared tools and default children fail", async () => {
  const { pages } = await fixture();
  await pages.tool("component-set", { ...definition, tools: ["missing"] }, caller);
  await expect(pages.tool("page-set", registration, caller)).rejects.toThrow("missing");
  await pages.tool("component-set", { ...definition, slots: ["actions"] }, caller);
  await expect(pages.tool("page-set", registration, caller)).rejects.toThrow("default");
  await pages.tool("component-set", definition, caller);
  await pages.tool("page-set", { ...registration, spec: { ...spec, elements: { ...spec.elements, player: { ...spec.elements.player, props: { title: { $state: "/title" } } } } } }, caller);
  expect(await pages.list()).toHaveLength(1);
});

test.each([
  ["builtin collision", { name: "Text" }], ["qualified name", { name: "beta:AudioPlayer" }], ["foreign declared tool", { tools: ["beta.play"] }],
  ["missing default export", { javascript: "export const mount = () => {};" }], ["import", { javascript: "import './other.js'; export default () => {};" }],
  ["dynamic import", { javascript: "export default () => import('./other.js');" }], ["invalid JS", { javascript: "export default function( {" }],
  ["required undeclared prop", { props: { ...definition.props, required: ["absent"] } }], ["non-object props", { props: { type: "string" } }],
  ["oversized source", { javascript: definition.javascript + "/*" + "界".repeat(90_000) + "*/" }],
] as const)("component rejects %s", async (_, changes) => {
  const { pages } = await fixture();
  await expect(pages.tool("component-set", { ...definition, ...changes }, caller)).rejects.toMatchObject({ code: "invalid" });
});

test.each([
  { $ref: "#" }, { $ref: "#/$defs/Track" }, { type: "array", items: { type: "integer" }, contains: { const: 7 } },
  { type: "array", uniqueItems: true }, { type: "string", format: "unknown-format" }, { type: "string", minLength: "ignored" },
  { type: "string", enum: ["a"], minLength: 3 }, { type: "string", enum: [4] }, { type: ["string"] },
  { type: "object", properties: { nested: { $ref: "#" } } }, { anyOf: [{ type: "string" }] },
])("unsupported or malformed property schemas fail at registration: %j", async property => {
  const { pages } = await fixture();
  await expect(pages.tool("component-set", { ...definition, props: { ...definition.props, properties: { title: property } } }, caller)).rejects.toMatchObject({ code: "invalid" });
});

test("nested props, enums and array bounds enforce literals, including after restart", async () => {
  const { pages, deps } = await fixture();
  const props = { type: "object", properties: { title: { type: "array", minItems: 1, maxItems: 2, items: { type: "object", properties: { state: { type: "string", enum: ["ready", "done"] }, count: { type: "integer", minimum: 1 } }, required: ["state", "count"], additionalProperties: false } } }, required: ["title"], additionalProperties: false };
  await pages.tool("component-set", { ...definition, props }, caller);
  const page = (title: unknown) => ({ ...registration, spec: { ...spec, elements: { ...spec.elements, player: { ...spec.elements.player, props: { title } } } } });
  const restarted = createPages(deps);
  for (const title of [[], [{ state: "unknown", count: 1 }], [{ state: "ready", count: 0 }], [{ state: "ready" }], [{ state: "ready", count: 1, extra: true }]]) await expect(restarted.tool("page-set", page(title), caller)).rejects.toMatchObject({ code: "invalid" });
  await restarted.tool("page-set", page([{ state: "ready", count: 1 }]), caller);
  expect(await restarted.list()).toHaveLength(1);
});

test("sixteen registrations per app are bounded and serialized; replacement still works at the limit", async () => {
  const { pages, deps } = await fixture();
  await Promise.all(Array.from({ length: 16 }, (_, i) => pages.tool("component-set", { ...definition, name: `Player${i}` }, caller)));
  await expect(pages.tool("component-set", { ...definition, name: "Seventeenth" }, caller)).rejects.toThrow("16");
  await pages.tool("component-set", { ...definition, name: "Player0", css: "changed" }, caller);
  expect(await createPages(deps).tool("component-remove", { name: "Player15" }, caller)).toEqual({ removed: true });
});

test("declarative composition remains usable beside executable components; either registration order rejects collisions", async () => {
  const { pages, modules } = await fixture();
  const template = { props: definition.props, spec: { root: "x", elements: { x: { type: "Text", props: { text: { $prop: "title" } }, children: [] } } } };
  const plain = { id: "old", title: "Template", components: { "alpha:Card": template }, spec: { root: "card", elements: { card: { type: "alpha:Card", props: { title: "Old composition" }, children: [] } } } };
  await pages.tool("page-set", plain, { ...caller, hash: undefined });
  expect((await pages.get("alpha", "old"))?.extensions).toBeUndefined();
  await expect(pages.tool("component-set", { ...definition, name: "Card" }, caller)).rejects.toThrow("重名");
  await pages.tool("component-set", definition, caller);
  await expect(pages.tool("page-set", { ...plain, components: { "alpha:AudioPlayer": template } }, caller)).rejects.toThrow("重名");
  expect((await pages.get("alpha", "old"))?.spec.elements.card?.type).toBe("Text");
  modules[0]!.activeHash = "approved-v2";
  await expect(pages.tool("page-set", { ...plain, components: { "alpha:AudioPlayer": template } }, { ...caller, hash: "approved-v2" })).rejects.toThrow("重名");
});

test("concurrent cold page reads validate stored component source once and retry failed loads", async () => {
  const f = await fixture(); await f.pages.tool("component-set", definition, caller);
  for (let i = 0; i < 20; i++) await f.pages.tool("page-set", { ...registration, id: `page-${i}` }, caller);
  const scan = spyOn(Bun.Transpiler.prototype, "scan");
  try {
    const restarted = createPages(f.deps);
    expect(await restarted.list()).toHaveLength(20);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(await restarted.list()).toHaveLength(20);
    expect(scan).toHaveBeenCalledTimes(1);
    const file = join(f.dataDir, "executable-components.json"), original = await readFile(file, "utf8");
    await writeFile(file, "invalid json");
    const recovered = createPages(f.deps);
    await expect(recovered.list()).rejects.toThrow();
    await writeFile(file, original);
    expect(await recovered.list()).toHaveLength(20);
    expect(scan).toHaveBeenCalledTimes(2);
  } finally { scan.mockRestore(); }
});

test("corrupt persisted source fails closed after restart", async () => {
  const f = await fixture(); await f.pages.tool("component-set", definition, caller);
  const file = join(f.dataDir, "executable-components.json"), stored = JSON.parse(await readFile(file, "utf8"));
  stored.components[0].javascript = "export default () => alert('changed');";
  await writeFile(file, JSON.stringify(stored));
  await expect(createPages(f.deps).component("alpha", "AudioPlayer", stored.components[0].revision)).rejects.toThrow("版本无效");
});

// Exercise Web's real SDK tool event and private HTTP listener in a child, without loading kernel or a database.
test("SDK events preserve caller hash; source HTTP authenticates transport and page callbacks retain existing pins", async () => {
  const f = await fixture(), root = resolve(import.meta.dirname, "../../../../../../.."), driver = join(f.dataDir, "http-check.ts");
  await writeFile(driver, `
    import { strict as assert } from 'node:assert';
    import { startModule } from 'chrona/testing';
    const identity = ${JSON.stringify(caller)}, definition = ${JSON.stringify(definition)}, registration = ${JSON.stringify(registration)};
    const inventory = [{id:'alpha-id',name:'alpha',status:'active',activeHash:'approved-v1'}];
    const tools = [{target:'alpha.play',moduleId:'alpha-id',inputSchema:{type:'object',description:'Play',properties:{title:{type:'string'}}}},
      {target:'alpha.unreferenced',moduleId:'alpha-id',inputSchema:{type:'object',properties:{}}}];
    const module = await startModule(${JSON.stringify(join(import.meta.dirname, "index.ts"))}, {stubs:{'modules.list':()=>({items:inventory,nextCursor:null}), 'modules.describe':()=>({items:tools,nextCursor:null}), 'alpha.play':args=>args}});
    async function event(id,args,caller=identity) { return module.send({trigger:{kind:'tool',id,args,caller,firedAt:new Date().toISOString()},now:new Date().toISOString(),params:{}}); }
    try {
      const registered = await event('component-set',definition);
      assert.ok(!registered.error, JSON.stringify(registered));
      const {name,type,revision} = registered.result.result;
      assert.equal(name,definition.name); assert.equal(type,'alpha:AudioPlayer');
      registration.spec.elements.player.type = type;
      const missingHash = await event('component-set', definition, {...identity,hash:undefined}); assert.ok(missingHash.error);
      const {endpoint} = await module.httpReady;
      const source = '/api/web/components/alpha/AudioPlayer?revision='+revision;
      const unauthenticated = await fetch(new URL(source,endpoint)); assert.equal(unauthenticated.status,401); assert.ok(!(await unauthenticated.text()).includes(definition.javascript));
      const response = await module.fetch(source); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
      assert.deepEqual(await response.json(), {...definition,module:'alpha',moduleId:'alpha-id',hash:'approved-v1',revision});
      assert.equal((await module.fetch('/api/web/components/alpha/AudioPlayer')).status,409);
      assert.equal((await module.fetch('/api/web/components/alpha/AudioPlayer?revision=old')).status,409);
      const saved = await event('page-set',registration); assert.ok(!saved.error,JSON.stringify(saved));
      const page = await (await module.fetch('/api/web/pages/alpha/main')).json(); assert.equal(page.extensions['alpha:AudioPlayer'].revision,revision);
      const body = {target:'alpha.play',args:{title:'Play'},page:{module:'alpha',id:'main',revision:page.revision}};
      const call = body => module.fetch('/api/web/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      assert.equal((await call(body)).status,200);
      const routed = module.calls.findLast(call=>call.params.target?.moduleId==='alpha-id' && call.params.target?.tool==='play'); assert.deepEqual(routed.params.expectedTarget,{moduleId:'alpha-id'});
      tools[0].inputSchema.description='Updated play description';
      assert.equal((await call(body)).status,200);
      assert.equal((await call({...body,target:'alpha.unreferenced'})).status,409);
      assert.equal((await call({...body,target:'beta.play'})).status,409);
      assert.equal((await call({...body,page:{...body.page,revision:'old'}})).status,409);
      inventory[0].activeHash='approved-v2';
      assert.equal((await module.fetch(source)).status,409); assert.equal((await call(body)).status,409);
      assert.deepEqual(await (await module.fetch('/api/web/pages')).json(),[]);
    } finally { await module.stop(); }
  `);
  const loader = join(root, "packages/integrations/src/steward/module-typecheck/chrona-sdk-loader.ts");
  const helper = process.env.CHRONA_PROCESS_HELPER ?? join(f.dataDir, `guardian${process.platform === "win32" ? ".exe" : ""}`);
  if (!process.env.CHRONA_PROCESS_HELPER) {
    const build = Bun.spawn([process.execPath, join(root, "packages/process/scripts/build-helper.ts"), helper], { stdout: "ignore", stderr: "pipe" });
    const [status, error] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    expect({ status, error }).toEqual({ status: 0, error: "" });
  }
  const child = Bun.spawn([process.execPath, "--preload", loader, driver], { cwd: root, env: { ...process.env, CHRONA_PROCESS_HELPER: helper, CHRONA_SDK: join(root, "packages/integrations/src/steward/module-sdk"), CHRONA_SDK_LOADER: loader, CHRONA_MODULE: import.meta.dirname, CHRONA_DATA: f.dataDir, CHRONA_CONTENT: join(f.dataDir, "content") }, stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: "", stderr: "" });
}, 20_000);
