import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { modules as systemModules } from "./system/modules";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { callSync, listSystemModules, moduleCallbackContractHash, type Caller } from "./module-calls";
import { registerSystemModules } from "./system-modules";
import { callsContracts } from "./module-contracts";
import { BUILD_MODULE_TOOLS, BUILD_REFERENCE_PROMPT, references, interfaceReference } from "./module-reference";
import { committedToolContract } from "./module-tool-contract";
import { moduleInterfaces } from "./system-apps";
import { catalogEntry } from "./module-tools";

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
  const call = async (target: string, raw: Record<string, unknown> = {}, caller: Caller = owner) => {
    const args = { ...raw };
    if (typeof args.target === "string" && !/^(modules|approvals|settings|secrets|activity|timers)\./.test(args.target)) {
      const [name, tool] = args.target.split(".");
      const module = await db.module.findFirst({ where: { workspaceId: workspace.id, name } });
      args.target = { moduleId: module?.id ?? "absent", tool };
    }
    return (await callSync(ports, { workspaceId: workspace.id, caller, chain: [], path: [] }, target, args)).output;
  };
  return { db, dataDir, ports, workspace, call };
}
const manifest = moduleManifestSchema.parse({ name: "target", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["modules.describe"],
  tools: [{ name: "read", description: "Read", visibility: ["modules", "owner", "provider"], idempotent: true, parameters: { type: "object", properties: {}, required: [] },
      output: {}
}] });
async function active(f: Awaited<ReturnType<typeof fixture>>, name = "target") {
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, activeHash: "v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: { ...manifest, name }, source: "user", status: "approved", intent: {}, report: {} } });
  return module;
}

test("references expose the current public contracts without runtime execution", async () => {
  const f = await fixture();
  const index = (await f.call("modules.describe") as { items: unknown[] }).items;
  expect(index).toEqual(expect.arrayContaining([expect.objectContaining({ target: "modules.health", description: expect.any(String) })]));
  expect(JSON.stringify(index)).toContain("inputSchema");
  for (const reference of index) expect(reference).not.toHaveProperty("contractHash");
  expect(listSystemModules().find(module => module.name === "modules")!.tools.map(tool => tool.name)).toEqual([
    "list", "describe", "health", "admit", "source", "submit", "receipt", "enable", "disable", "rollback", "remove", "operation",
  ]);
  const diagnostics = listSystemModules().find(module => module.name === "modules")!.tools.find(tool => tool.name === "health")!;
  expect(await f.call("modules.describe", { target: "modules.health" })).toMatchObject({ target: "modules.health",
    inputSchema: { type: "object", properties: { moduleId: { type: "string" } } }, outputSchema: { type: "object" },
    admission: { visibility: diagnostics.visibility, uses: "modules.health" } });
  for (const target of ["modules.checkout", "modules.propose", "modules.check", "modules.request-group", "modules.settings-get", "modules.settings-set", "modules.catalog", "modules.upstream"]) {
    await expect(f.call("modules.describe", { target })).rejects.toMatchObject({ code: "not_found" });
  }
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(0);
});

test("system reference, internal inspection, catalogs and calls use the same committed contracts", async () => {
  const f = await fixture();
  const calls = await callsContracts(f.ports, f.workspace.id);
  const interfaces = await moduleInterfaces(f.ports, f.workspace.id);
  if (!Array.isArray(interfaces)) throw new Error("Expected the internal interface directory");
  for (const system of listSystemModules()) for (const tool of system.tools) {
    const target = `${system.name}.${tool.name}`, contract = committedToolContract(target);
    const reference = await interfaceReference(f.ports, f.workspace.id, target);
    expect(reference).toMatchObject({ inputSchema: contract.input, outputSchema: contract.output });
    expect(reference).not.toHaveProperty("contractHash");
    const inspected = interfaces.find(item => item.name === system.name)!.tools.find(item => item.name === tool.name)!;
    expect(inspected.inputSchema).toEqual(contract.input);
    expect(inspected.outputSchema).toEqual(contract.output);
    const catalog = catalogEntry({ name: target, module: { id: `system:${system.name}`, name: system.name, activeHash: "system" }, manifest: { tools: system.tools }, tool, direct: true, system: true });
    expect(catalog.inputSchema).toEqual({ ...contract.input, description: `[Chrona ${system.name}] ${tool.description}` });
    expect(catalog.outputSchema).toEqual(contract.output);
    if (target === "modules.receipt") {
      const schema = z.fromJSONSchema(catalog.inputSchema);
      expect(schema.safeParse({ receiptId: "original-receipt" }).success).toBe(true);
      expect(schema.safeParse({ admissionId: "admission", key: "original-key" }).success).toBe(true);
      expect(schema.safeParse({ receiptId: "original-receipt", unexpected: true }).success).toBe(false);
    }
    if (tool.visibility.some(who => who === "modules" || who === "owner")) expect(calls[target]).toEqual({ input: contract.input, output: contract.output });
  }
});

test("app output references preserve original JSON Schema and generated call types", async () => {
  const f = await fixture(), module = await active(f, "typed");
  const schema = { type: "object", properties: { zeta: { type: "string" }, alpha: { type: "integer" } }, required: ["zeta", "alpha"], additionalProperties: false };
  const tool = { ...manifest.tools[0]!, parameters: { type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { state: { type: "string", enum: ["ready", "done"] }, limit: { type: "number" } }, required: ["state"] } } }, required: ["filters"] }, output: schema };
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash: "v1" } }, data: { manifest: moduleManifestSchema.parse({ ...manifest, name: "typed", tools: [tool] }) } });
  const reference = await f.call("modules.describe", { target: "typed.read" }) as { outputSchema: unknown; inputSchema: { properties: { filters: { items: { additionalProperties: boolean } } } } };
  expect(JSON.stringify(reference.outputSchema)).toBe(JSON.stringify(schema));
  expect(reference.inputSchema.properties.filters.items.additionalProperties).toBe(false);
  expect((await callsContracts(f.ports, f.workspace.id))["typed.read"]).toMatchObject({ input: { type: "object", properties: { filters: { type: "array" } } }, output: { type: "object", required: ["zeta", "alpha"] } });
});

test("reference hash describes the live tool and ignores documentation and object-key order", async () => {
  const f = await fixture(), module = await active(f);
  const tool = moduleManifestSchema.parse({ ...manifest, tools: [{ ...manifest.tools[0]!, parameters: { type: "object", properties: { value: { type: "string" }, count: { type: "number" } }, required: ["value"] }, output: { type: "object", properties: { answer: { type: "string" } } } }] }).tools[0]!;
  const reordered = { ...tool, description: "Different documentation", visibility: [...tool.visibility].reverse(), parameters: { required: ["value"], properties: { count: { type: "number" as const }, value: { type: "string" as const } }, type: "object" as const } };
  expect(moduleCallbackContractHash(reordered)).toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, idempotent: !tool.idempotent })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, visibility: ["owner"] })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, output: { type: "string" } })).not.toBe(moduleCallbackContractHash(tool));
  expect(moduleCallbackContractHash({ ...tool, parameters: { ...tool.parameters, required: ["value", "count"] } })).not.toBe(moduleCallbackContractHash(tool));
  const reference = await f.call("modules.describe", { target: "target.read" });
  expect(reference).not.toHaveProperty("contractHash");
  const origin = { workspaceId: f.workspace.id, caller: { kind: "owner" as const, via: null }, chain: [], path: [] };
  await expect(callSync(f.ports, origin, "target.read", { unexpected: true }, { expectedTarget: { moduleId: module.id } })).rejects.toMatchObject({ code: "invalid" });
});

test.each(["building", "testing", "pending_review", "rejected", "active", "missing", "malformed", "paused", "migrating", "no-hash"])("references and declarations exclude a non-approved or inactive active pointer: %s", async state => {
  const f = await fixture(), module = await active(f);
  expect((await references(f.ports, f.workspace.id)).some(entry => entry.target === "target.read")).toBe(true);
  if (state === "missing") await f.db.moduleVersion.deleteMany({ where: { moduleId: module.id } });
  else if (state === "malformed") await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { manifest: { name: "invalid" } } });
  else if (["paused", "migrating", "no-hash"].includes(state)) await f.db.module.update({ where: { id: module.id }, data: state === "no-hash" ? { activeHash: null } : { status: state } });
  else await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { status: state } });
  expect((await references(f.ports, f.workspace.id)).some(entry => entry.target === "target.read")).toBe(false);
  await expect(f.call("modules.describe", { target: "target.read" })).rejects.toMatchObject({ code: "not_found" });
  expect(await callsContracts(f.ports, f.workspace.id)).not.toHaveProperty("target.read");
});

test("discovery stays workspace scoped and honors the current caller admission", async () => {
  const f = await fixture(), module = await active(f);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  const outside = await f.db.module.create({ data: { workspaceId: other.id, name: "outside", activeHash: "private" } });
  await f.db.moduleVersion.create({ data: { moduleId: outside.id, hash: "private", manifest: { ...manifest, name: "outside" }, status: "approved", source: "user", intent: {}, report: {} } });
  expect(await f.call("modules.describe", { target: "target.read" })).toMatchObject({ source: { kind: "module", hash: "v1" }, outputSchema: {} });
  expect(JSON.stringify(await f.call("modules.describe"))).not.toContain("outside.read");
  await expect(f.call("modules.describe", { target: "outside.read" })).rejects.toMatchObject({ code: "not_found" });
  const caller: Caller = { kind: "module", module: "target", moduleId: module.id, hash: "v1" };
  expect(await f.call("modules.describe", { target: "modules.describe" }, caller)).toMatchObject({ target: "modules.describe" });
  await expect(f.call("modules.describe", { target: "approvals.resolve" }, caller)).rejects.toMatchObject({ code: "not_found" });
});

test("private build guidance advertises live discovery and fixed material authoring", () => {
  registerSystemModules();
  const names = new Set(listSystemModules().flatMap(module => module.tools.map(tool => `m_${module.name}_${tool.name.replaceAll("-", "_")}`)));
  expect(BUILD_MODULE_TOOLS.every(name => names.has(name))).toBe(true);
  for (const removed of ["m_modules_checkout", "m_modules_propose", "m_modules_check", "m_modules_request_group", "build_request"]) expect(BUILD_REFERENCE_PROMPT).not.toContain(removed);
  for (const current of ["modules.describe", "modules.health", "modules.submit", "modules.receipt", "ordinary", "fixed candidate"]) expect(BUILD_REFERENCE_PROMPT).toContain(current);
});

test("exact references do not enumerate unrelated modules or manifests", async () => {
  const f = await fixture(); await active(f);
  const reads: string[] = [];
  const db = f.db.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { reads.push(`${model}.${operation}`); return query(args); } } } });
  const ports = { ...f.ports, db } as StewardPorts;
  {
    expect(await interfaceReference(ports, f.workspace.id, "modules.list")).toMatchObject({ target: "modules.list" });
    expect(await interfaceReference(ports, f.workspace.id, "target.read")).toMatchObject({ source: { hash: "v1" }, outputSchema: {} });
    expect(reads).toEqual(["Module.findFirst", "ModuleVersion.findUnique"]);
  }
});

test("discovery batches current versions and reads caller authority once per request, never across requests", async () => {
  const f = await fixture(), module = await active(f);
  const caller: Caller = { kind: "module", module: "target", moduleId: module.id, hash: "v1" };
  const reads: string[] = [];
  const db = f.db.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { reads.push(`${model}.${operation}`); return query(args); } } } });
  const context = { ports: { ...f.ports, db } as StewardPorts, workspaceId: f.workspace.id, caller, chain: [], path: [] };
  const discover = () => systemModules.handle(context, "describe", { limit: 100 });
  {
    expect(JSON.stringify(await discover())).toContain('"tool":"read"');
    expect(reads).toEqual(["Module.findFirst", "Module.findMany", "ModuleVersion.findMany"]);
    await f.db.module.update({ where: { id: module.id }, data: { status: "paused" } });
    expect(await discover()).toMatchObject({ items: [] });
    await expect(interfaceReference(f.ports, f.workspace.id, "modules.describe", caller)).rejects.toMatchObject({ code: "not_found" });
    await f.db.module.update({ where: { id: module.id }, data: { status: "active", activeHash: "v2" } });
    expect(await discover()).toMatchObject({ items: [] });
    await f.db.module.update({ where: { id: module.id }, data: { activeHash: "v1" } });
    await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { status: "rejected" } });
    expect(await discover()).toMatchObject({ items: [] });
    await f.db.moduleVersion.updateMany({ where: { moduleId: module.id }, data: { status: "approved" } });
    expect(await interfaceReference(f.ports, f.workspace.id, "modules.describe", caller)).toMatchObject({ target: "modules.describe" });
    await expect(interfaceReference(f.ports, f.workspace.id, "approvals.resolve", caller)).rejects.toMatchObject({ code: "not_found" });
    expect(await systemModules.handle({ ...context, workspaceId: (await f.db.workspace.create({ data: { name: "foreign" } })).id }, "describe", {})).toMatchObject({ items: [] });
  }
});


test("discovery batches more than SQLite expression depth without admitting rejected versions", async () => {
  const f = await fixture();
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: crypto.randomUUID(), workspaceId: f.workspace.id, name: `scale-${index}`, activeHash: "v1" }));
  await f.db.module.createMany({ data: rows });
  await f.db.moduleVersion.createMany({ data: rows.map((row, index) => ({ moduleId: row.id, hash: "v1", manifest: { ...manifest, name: row.name }, source: "user", status: index === 1000 ? "rejected" : "approved", intent: {}, report: {} })) });
  const result = await references(f.ports, f.workspace.id);
  expect(result.filter(entry => entry.target.startsWith("scale-")).length).toBe(1000);
  expect(result.some(entry => entry.target === "scale-1000.read")).toBe(false);
});
