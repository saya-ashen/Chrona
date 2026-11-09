import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { callSync, listSystemModules, moduleCallbackContractHash, type Caller } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { callsDeclaration } from "./module-contracts";
import { BUILD_MODULE_TOOLS, BUILD_REFERENCE_PROMPT, references } from "./module-reference";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-reference-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(),
    provider: { name: "fake", async health() { throw new Error("Reference must not probe a Provider"); }, start() { throw new Error("Reference must not start a Provider"); } },
    sandbox: { available: true, isolated: false, startModule() { throw new Error("Reference must not start a module"); } } };
  const workspace = await db.workspace.create({ data: { name: "reference" } });
  const owner: Caller = { kind: "owner", via: null };
  const call = async (target: string, args: unknown = {}, caller: Caller = owner) => (await callSync(ports, { workspaceId: workspace.id, caller, chain: [], path: [] }, target, args)).output;
  return { db, dataDir, ports, workspace, call };
}
const manifest = moduleManifestSchema.parse({ name: "target", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["modules.reference", "modules.tools"],
  tools: [{ name: "read", description: "Read", visibility: ["modules", "owner", "provider"], idempotent: true, parameters: { type: "object", properties: {}, required: [] } }] });
async function active(f: Awaited<ReturnType<typeof fixture>>, name = "target") {
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, activeHash: "v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: { ...manifest, name }, source: "user", status: "approved", intent: {}, report: {} } });
  return module;
}

test("references expose the current public contracts without runtime execution", async () => {
  const f = await fixture();
  const index = await f.call("modules.reference");
  expect(index).toEqual(expect.arrayContaining([{ target: "modules.diagnostics", source: { kind: "system", hash: null }, description: expect.any(String) }]));
  expect(JSON.stringify(index)).not.toContain("inputSchema");
  expect(listSystemModules().find(module => module.name === "modules")!.tools.map(tool => tool.name)).toEqual([
    "list", "tools", "reference", "diagnostics", "health", "admit-candidates", "source", "submit", "candidate-check", "rollback", "disable", "enable", "remove",
  ]);
  const diagnostics = listSystemModules().find(module => module.name === "modules")!.tools.find(tool => tool.name === "diagnostics")!;
  expect(await f.call("modules.reference", { target: "modules.diagnostics" })).toMatchObject({ target: "modules.diagnostics",
    inputSchema: { type: "object", properties: { module: { type: "string" } } }, outputSchema: { type: "array" },
    admission: { visibility: diagnostics.visibility, uses: "modules.diagnostics" }, contractHash: moduleCallbackContractHash(diagnostics) });
  for (const target of ["modules.checkout", "modules.propose", "modules.check", "modules.request-group", "modules.settings-get", "modules.settings-set", "modules.catalog", "modules.upstream"]) {
    await expect(f.call("modules.reference", { target })).rejects.toMatchObject({ code: "not_found" });
  }
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(0);
});

test("app output references preserve original JSON Schema and generated call types", async () => {
  const f = await fixture(), module = await active(f, "typed");
  const schema = { type: "object", properties: { zeta: { type: "string" }, alpha: { type: "integer" } }, required: ["zeta", "alpha"], additionalProperties: false };
  const tool = { ...manifest.tools[0]!, parameters: { type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { state: { type: "string", enum: ["ready", "done"] }, limit: { type: "number" } }, required: ["state"] } } }, required: ["filters"] }, output: schema };
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash: "v1" } }, data: { manifest: moduleManifestSchema.parse({ ...manifest, name: "typed", tools: [tool] }) } });
  const reference = await f.call("modules.reference", { target: "typed.read" }) as { outputSchema: unknown; inputSchema: { properties: { filters: { items: { additionalProperties: boolean } } } } };
  expect(JSON.stringify(reference.outputSchema)).toBe(JSON.stringify(schema));
  expect(reference.inputSchema.properties.filters.items.additionalProperties).toBe(false);
  expect(await callsDeclaration(f.ports, f.workspace.id)).toContain('"typed.read": { args: { "filters": Array<{ "state": "ready" | "done"; "limit"?: number }> }; output: { "zeta": string; "alpha": number } }');
});

test("reference hash binds the live tool and ignores documentation and object-key order", async () => {
  const f = await fixture(), module = await active(f);
  const tool = moduleManifestSchema.parse({ ...manifest, tools: [{ ...manifest.tools[0]!, parameters: { type: "object", properties: { value: { type: "string" }, count: { type: "number" } }, required: ["value"] }, output: { type: "object", properties: { answer: { type: "string" } } } }] }).tools[0]!;
  const reordered = { ...tool, description: "Different documentation", visibility: [...tool.visibility].reverse(), parameters: { required: ["value"], properties: { count: { type: "number" as const }, value: { type: "string" as const } }, type: "object" as const } };
  expect(moduleCallbackContractHash(reordered)).toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, idempotent: !tool.idempotent })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, visibility: ["owner"] })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, output: { type: "string" } })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, parameters: { ...tool.parameters, required: ["value", "count"] } })).not.toBe(moduleCallbackContractHash(tool));
  const reference = await f.call("modules.reference", { target: "target.read" }) as { contractHash: string };
  const origin = { workspaceId: f.workspace.id, caller: { kind: "owner" as const, via: null }, chain: [], path: [] };
  await expect(callSync(f.ports, origin, "target.read", { unexpected: true }, { expectedTarget: { moduleId: module.id, contractHash: reference.contractHash } })).rejects.toMatchObject({ code: "invalid" });
  await expect(callSync(f.ports, origin, "target.read", {}, { expectedTarget: { moduleId: module.id, contractHash: "0".repeat(64) } })).rejects.toMatchObject({ code: "conflict" });
});

test.each(["building", "testing", "pending_review", "rejected", "active", "missing", "malformed", "paused", "migrating", "no-hash"])("references and declarations exclude a non-approved or inactive active pointer: %s", async state => {
  const f = await fixture(), module = await active(f);
  expect((await references(f.ports, f.workspace.id)).some(entry => entry.target === "target.read")).toBe(true);
  if (state === "missing") await f.db.moduleVersion.deleteMany({ where: { moduleId: module.id } });
  else if (state === "malformed") await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { manifest: { name: "invalid" } } });
  else if (["paused", "migrating", "no-hash"].includes(state)) await f.db.module.update({ where: { id: module.id }, data: state === "no-hash" ? { activeHash: null } : { status: state } });
  else await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { status: state } });
  expect((await references(f.ports, f.workspace.id)).some(entry => entry.target === "target.read")).toBe(false);
  await expect(f.call("modules.reference", { target: "target.read" })).rejects.toMatchObject({ code: "not_found" });
  expect(await callsDeclaration(f.ports, f.workspace.id)).not.toContain('"target.read"');
});

test("discovery stays workspace scoped and honors the current caller admission", async () => {
  const f = await fixture(), module = await active(f);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  const outside = await f.db.module.create({ data: { workspaceId: other.id, name: "outside", activeHash: "private" } });
  await f.db.moduleVersion.create({ data: { moduleId: outside.id, hash: "private", manifest: { ...manifest, name: "outside" }, status: "approved", source: "user", intent: {}, report: {} } });
  expect(await f.call("modules.reference", { target: "target.read" })).toMatchObject({ source: { kind: "module", hash: "v1" }, outputSchema: null });
  expect(JSON.stringify(await f.call("modules.reference"))).not.toContain("outside.read");
  await expect(f.call("modules.reference", { target: "outside.read" })).rejects.toMatchObject({ code: "not_found" });
  const caller: Caller = { kind: "module", module: "target", moduleId: module.id, hash: "v1" };
  expect(await f.call("modules.reference", { target: "modules.tools" }, caller)).toMatchObject({ target: "modules.tools" });
  await expect(f.call("modules.reference", { target: "approvals.resolve" }, caller)).rejects.toMatchObject({ code: "not_found" });
});

test("private build guidance advertises live discovery and fixed material authoring", () => {
  registerSystemModules();
  const names = new Set(listSystemModules().flatMap(module => module.tools.map(tool => `m_${module.name}_${tool.name.replaceAll("-", "_")}`)));
  expect(BUILD_MODULE_TOOLS.every(name => names.has(name))).toBe(true);
  for (const removed of ["m_modules_checkout", "m_modules_propose", "m_modules_check", "m_modules_request_group", "build_request"]) expect(BUILD_REFERENCE_PROMPT).not.toContain(removed);
  for (const current of ["modules.reference", "modules.tools", "modules.diagnostics", "modules.submit", "modules.candidate-check", "ordinary", "fixed candidate"]) expect(BUILD_REFERENCE_PROMPT).toContain(current);
});
