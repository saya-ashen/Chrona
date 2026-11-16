import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createPages, pageErrors, type ModuleState, type PageTool } from "./pages";
import { systemCall } from "./src/system/adapter";
import { historicalConversation } from "./src/system/chat-stream";
import { toolArguments } from "./src/system/forms";
import { toolsForModule, selectedTab } from "./src/system/detail";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const input = { id: "main", title: "页面", javascript: "export default function mount() { return () => {}; }", tools: ["read"] };
async function fixture() {
  const dataDir = await mkdtemp("/tmp/chrona-pages-"); dirs.push(dataDir);
  const modules: ModuleState[] = [{ id: "alpha-id", name: "alpha", status: "active", activeHash: "a" }];
  const tools = new Map<string, PageTool>([["read", { moduleId: "alpha-id", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }]]);
  const deps = { dataDir, modules: async () => modules, tools: async () => tools };
  return { modules, tools, deps, pages: createPages(deps), caller: { kind: "module", module: "alpha", moduleId: "alpha-id", hash: "a" } };
}
test("direct page registration validates active caller, source and declared own tools", async () => {
  const f = await fixture();
  await expect(f.pages.tool("page-set", input, undefined)).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.pages.tool("page-set", input, { ...f.caller, hash: "wrong" })).rejects.toMatchObject({ code: "conflict" });
  await expect(f.pages.tool("page-set", { ...input, tools: ["other.read"] }, f.caller)).rejects.toMatchObject({ code: "invalid" });
  await expect(f.pages.tool("page-set", { ...input, tools: ["missing"] }, f.caller)).rejects.toMatchObject({ code: "conflict" });
  expect(pageErrors({ ...input, javascript: "import React from 'react'; export default () => {};" }).join()).toContain("共享运行时");
  expect(pageErrors({ ...input, javascript: "export const page = {};" })).not.toEqual([]);
  expect(pageErrors({ ...input, spec: {} }).join()).toContain("Unrecognized");
  await f.pages.tool("page-set", input, f.caller);
  expect(await f.pages.get("alpha", "main")).toMatchObject({ moduleId: "alpha-id", hash: "a", tools: ["read"] });
});
test("pause, resume, restart, owner replacement and rollback retain exact version ownership", async () => {
  const f = await fixture(); await f.pages.tool("page-set", input, f.caller);
  const first = await f.pages.get("alpha", "main");
  f.modules[0]!.status = "paused"; expect(await f.pages.list()).toEqual([]);
  await expect(f.pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  f.modules[0]!.status = "active"; expect((await f.pages.get("alpha", "main"))?.revision).toBe(first!.revision);
  f.modules[0]!.activeHash = "b";
  await f.pages.tool("page-set", { ...input, title: "B" }, { ...f.caller, hash: "b" });
  expect((await createPages(f.deps).get("alpha", "main"))?.title).toBe("B");
  f.modules[0]!.activeHash = "a";
  expect((await createPages(f.deps).get("alpha", "main"))?.revision).toBe(first!.revision);
  f.modules[0]!.id = "replacement"; expect(await f.pages.list()).toEqual([]); expect(await f.pages.get("alpha", "main")).toBeNull();
});
test("tool contract changes invalidate callbacks; editorial descriptions preserve them", async () => {
  const f = await fixture(); await f.pages.tool("page-set", input, f.caller);
  f.tools.get("read")!.inputSchema.description = "updated";
  expect(await f.pages.list()).toHaveLength(1);
  f.tools.get("read")!.inputSchema.required = [];
  expect(await f.pages.list()).toEqual([]);
  await expect(f.pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  f.tools.get("read")!.inputSchema.properties!["request-key"] = { type: "string" };
  await f.pages.tool("page-set", input, f.caller);
  expect((await f.pages.get("alpha", "main"))?.keyed).toEqual(["read"]);
});
test("contract fingerprints preserve property names and literal values that resemble schema annotations", async () => {
  const f = await fixture();
  for (const properties of [{ title: { type: "string" } }, { payload: { const: { description: "old" } } }]) {
    f.tools.get("read")!.inputSchema = { type: "object", properties };
    await f.pages.tool("page-set", input, f.caller);
    f.tools.get("read")!.inputSchema = { type: "object", properties: "title" in properties ? { title: { type: "number" } } : { payload: { const: { description: "new" } } } };
    await expect(f.pages.get("alpha", "main")).rejects.toMatchObject({ code: "conflict" });
  }
});
test("content registration requires a ref input and rejects other required parameters", async () => {
  const f = await fixture(), page = { ...input, content: { tool: "read" } };
  await expect(f.pages.tool("page-set", page, f.caller)).rejects.toMatchObject({ code: "conflict" });
  f.tools.get("read")!.inputSchema = { type: "object", properties: { ref: { type: "string", pattern: "^alpha/" } }, required: ["ref"] };
  await f.pages.tool("page-set", page, f.caller);
  expect((await f.pages.get("alpha", "main"))?.content).toEqual({ tool: "read" });
  f.tools.get("read")!.inputSchema.required = ["ref", "path"];
  await expect(f.pages.tool("page-set", page, f.caller)).rejects.toMatchObject({ code: "conflict" });
});
test("nested tool inputs remain JSON objects, and exact prefixes determine ownership", () => {
  expect(toolArguments('{"files":[{"path":"module.json","content":"{}"}]}')).toEqual({ files: [{ path: "module.json", content: "{}" }] });
  for (const value of ["[]", "null", '"text"', "1"]) expect(() => toolArguments(value)).toThrow("JSON 对象");
  expect(historicalConversation("build:old", true)).toBe(true);
  expect(selectedTab("settings")).toBe("settings"); expect(selectedTab("settings", true)).toBe("overview");
  expect(toolsForModule([{ target: "pi.configure" }, { target: "pi-extra.read" }, { target: "other.pi" }] as Parameters<typeof toolsForModule>[0], "pi").map(tool => tool.target)).toEqual(["pi.configure"]);
});
test("lifecycle adapter preserves application ID, arguments and failures", async () => {
  const mapped: unknown[] = [], call = systemCall({ web: async (...args) => { mapped.push(args); return {}; }, tool: async () => ({}) });
  await call("$web.tools", { query: "a/b 中", audience: "user" });
  await call("$web.module-rollback", { id: "original/id", hash: "a".repeat(64) });
  expect(mapped).toEqual([["/tools?query=a%2Fb%20%E4%B8%AD&audience=user"], ["/modules/original%2Fid/rollback", { method: "POST", body: { hash: "a".repeat(64) } }]]);
  const failing = systemCall({ web: async () => { throw new Error("需先处置活动会话"); }, tool: async () => ({}) });
  await expect(failing("$web.module-remove", { id: "web" })).rejects.toThrow("活动会话");
  await expect(call("$web.install", {})).rejects.toThrow("未知系统操作");
});
