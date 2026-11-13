import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createPages, pageErrors } from "./pages";
import { expandComponents } from "./composition";

const props = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
const card = { props, slots: ["default", "actions"], events: ["choose"], spec: { root: "card", elements: {
  card: { type: "Panel", props: {}, children: ["title", "$slot:default", "button", "$slot:actions"] },
  title: { type: "Text", props: { text: { $prop: "title" } }, children: [] },
  button: { type: "Button", props: { label: "选择" }, on: { press: { $event: "choose" } }, children: [] },
} } };
const components = { "alpha:Card": card };
const call = { action: "call", params: { tool: "save", args: { text: { $item: "title" } } } };
const spec = { root: "list", state: { draft: "" }, elements: {
  list: { type: "Stack", props: {}, children: ["one", "two"] },
  one: { type: "alpha:Card", props: { title: { $item: "title" } }, repeat: { statePath: "/rows", key: "id" }, on: { choose: call }, children: ["input"], slots: { actions: ["extra"] } },
  two: { type: "alpha:Card", props: { title: "另一个" }, children: [] },
  input: { type: "Input", props: { name: "draft", value: { $bindState: "/draft" } }, children: [] },
  extra: { type: "Text", props: { text: "补充" }, children: [] },
} };
test("private templates preserve repeat item scope, bindings, named slots, callbacks and independent node identities", () => {
  const expanded = expandComponents(spec, components, "alpha");
  expect(expanded.elements.one).toMatchObject({ type: "Stack", repeat: spec.elements.one.repeat });
  const one = expanded.elements[expanded.elements.one!.children![0]!]!;
  const title = expanded.elements[one.children![0]!]!;
  expect(title.props?.text).toEqual({ $item: "title" });
  expect(one.children).toContain("input"); expect(one.children).toContain("extra");
  expect(expanded.elements.input?.props?.value).toEqual({ $bindState: "/draft" });
  expect(Object.values(expanded.elements).filter(node => node.type === "Button").some(node => JSON.stringify(node.on?.press) === JSON.stringify(call))).toBe(true);
  expect(expanded.elements.two?.type).toBe("Panel");
  expect(new Set(Object.keys(expanded.elements)).size).toBe(Object.keys(expanded.elements).length);
  expect(expanded.state).toEqual(spec.state);
  expect(pageErrors({ spec, components }, new Map([["save", { properties: { text: {} } }]]), "alpha")).toEqual([]);
});
test.each([
  ["foreign names", { "beta:Card": card }, spec],
  ["unknown prop", components, { ...spec, elements: { ...spec.elements, two: { ...spec.elements.two, props: { title: "x", hidden: true } } } }],
  ["invalid prop", components, { ...spec, elements: { ...spec.elements, two: { ...spec.elements.two, props: { title: 123 } } } }],
  ["missing prop", components, { ...spec, elements: { ...spec.elements, two: { ...spec.elements.two, props: {} } } }],
  ["unknown event", components, { ...spec, elements: { ...spec.elements, two: { ...spec.elements.two, on: { hidden: call } } } }],
  ["unknown slot", components, { ...spec, elements: { ...spec.elements, two: { ...spec.elements.two, slots: { hidden: ["input"] } } } }],
] as const)("rejects %s", (_, definitions, input) => {
  expect(() => expandComponents(input, definitions, "alpha")).toThrow("组合组件无效");
});
test("expanded content still passes ordinary component and own-tool admission", () => {
  expect(pageErrors({ spec, components }, new Map(), "alpha").join()).toContain("应用没有工具 save");
  const forbidden = { ...card, spec: { root: "x", elements: { x: { type: "SystemAction", props: {} } } } };
  expect(pageErrors({ spec, components: { "alpha:Card": forbidden } }, new Map(), "alpha").length).toBeGreaterThan(0);
});
test("recursive templates, graph cycles, missing children and expansion fanout fail with bounded diagnostics", () => {
  const recursive = { ...card, spec: { root: "x", elements: { x: { type: "alpha:Card", props: { title: "loop" } } } } };
  expect(() => expandComponents(spec, { "alpha:Card": recursive }, "alpha")).toThrow("递归");
  expect(() => expandComponents({ root: "x", elements: { x: { type: "Stack", children: ["x"] } } }, undefined, "alpha")).toThrow("循环引用");
  expect(() => expandComponents({ root: "x", elements: { x: { type: "Stack", children: ["missing"] } } }, undefined, "alpha")).toThrow("不存在");
  const elements = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`n${i}`, { type: "alpha:Card", props: { title: "x" } }]));
  expect(() => expandComponents({ root: "n0", elements }, components, "alpha")).toThrow("300");
});
test("nested components forward slots and events without overriding a hidden template root", () => {
  const hidden = { ...card, spec: { ...card.spec, elements: { ...card.spec.elements, card: { ...card.spec.elements.card, visible: false } } } };
  const outer = { props, slots: ["default"], events: ["choose"], spec: { root: "nested", elements: { nested: { type: "alpha:Card", props: { title: { $prop: "title" } }, visible: true, children: ["$slot:default"], on: { choose: { $event: "choose" } } } } } };
  const nested = expandComponents({ root: "parent", elements: { parent: { type: "alpha:Outer", props: { title: "Nested" }, children: ["input"], on: { choose: call } }, input: spec.elements.input } }, { "alpha:Card": hidden, "alpha:Outer": outer }, "alpha");
  expect(nested.elements.parent?.visible).toEqual({ $and: [false, true] });
  expect(nested.elements.parent?.children).toContain("input");
  expect(Object.values(nested.elements).find(node => node.type === "Button")?.on?.press).toEqual(call);
});
test("expanded byte size is bounded even when compact templates duplicate large literals", () => {
  const large = { props: { type: "object", properties: {}, additionalProperties: false }, spec: { root: "body", elements: { body: { type: "Text", props: { text: "界".repeat(1000) }, children: [] } } } };
  const elements = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`n${i}`, { type: "alpha:Large", props: {} }]));
  expect(pageErrors({ spec: { root: "n0", elements }, components: { "alpha:Large": large } }, new Map(), "alpha").join()).toContain("64 KiB");
});
test("slot fanout is charged before copying references, independently of distinct node counts", () => {
  const forward = (type: string) => ({ props: { type: "object", properties: {}, additionalProperties: false }, slots: ["default"], spec: { root: "root", elements: { root: { type, props: {}, children: Array<string>(1000).fill("$slot:default") } } } });
  const input = { root: "root", elements: { root: { type: "alpha:A", props: {}, children: ["text"] }, text: { type: "Text", props: { text: "safe" }, children: [] } } };
  const definitions = { "alpha:A": forward("alpha:B"), "alpha:B": forward("alpha:C"), "alpha:C": forward("Stack") };
  expect(Buffer.byteLength(JSON.stringify({ spec: input, components: definitions }))).toBeLessThan(65_536);
  expect(() => expandComponents(input, definitions, "alpha")).toThrow("4096");
});
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
test("registration persists expanded snapshots and layout across restart and tool description upgrades", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-components-"); dirs.push(dataDir);
  const tools = new Map([["save", { moduleId: "alpha-id", inputSchema: { description: "Save text", properties: { text: {} } } }]]);
  const deps = { dataDir, modules: async () => [{ id: "alpha-id", name: "alpha", activeHash: "active", status: "active" }], tools: async () => tools };
  await createPages(deps).tool("page-set", { id: "main", title: "示例", layout: "workspace", spec, components }, { kind: "module", module: "alpha", moduleId: "alpha-id" });
  const pages = createPages(deps), page = await pages.get("alpha", "main");
  expect(page?.layout).toBe("workspace");
  expect(JSON.stringify(page?.spec)).not.toContain("alpha:Card");
  tools.get("save")!.inputSchema.description = "Updated save description";
  expect(await pages.get("alpha", "main")).toMatchObject({ revision: page!.revision, layout: "workspace" });
  tools.get("save")!.moduleId = "replacement-id";
  await expect(pages.get("alpha", "main")).rejects.toThrow("重新登记");
});
