import { afterEach, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { callSync } from "./module-calls";
import { moduleDiagnosticsOutputSchema } from "./module-diagnostics";
import { callsDeclaration } from "./module-contracts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-reference-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleBuiltinResources: join(dataDir, "release"),
    provider: { name: "fake", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Reference must not start a Provider"); } },
    sandbox: { available: true, isolated: false, startModule() { throw new Error("Reference must not start a module"); } } };
  const service = createStewardService(ports);
  const workspace = await db.workspace.create({ data: { name: "reference" } });
  const api = service.forWorkspace(workspace.id);
  const session = await db.session.create({ data: { workspaceId: workspace.id, key: "web:test", source: "web" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Build with references" });
  const run = (await api.runs.claimNext("foreground"))!;
  await mkdir(run.cwd, { recursive: true });
  const call = async (name: string, args: unknown) => (await service.tools.call(run.token, name, args) as { result: unknown }).result;
  return { db, dataDir, ports, service, api, workspace, run, call };
}
const manifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [],
  tools: [{ name: "inspect", description: "Read-only example interface", parameters: { type: "object", properties: {}, required: [] } }] });
async function sources(f: Awaited<ReturnType<typeof fixture>>) {
  const hash = "b".repeat(64);
  const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "web", activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const stored = join(f.dataDir, "platform", "store", hash), builtin = join(f.ports.moduleBuiltinResources!, "web");
  for (const [dir, text] of [[stored, "custom appearance"], [builtin, "new release feature"]]) {
    await mkdir(dir!, { recursive: true });
    await writeFile(join(dir!, "module.json"), JSON.stringify(manifest));
    await writeFile(join(dir!, "index.ts"), text!);
    await writeFile(join(dir!, "test.ts"), "// offline test");
  }
  return { module, hash, stored, builtin };
}

test("development reference exposes exact contracts, synthetic non-empty examples and permissions without production calls", async () => {
  const f = await fixture();
  const index = await f.call("m_modules_reference", {});
  expect(index).toEqual(expect.arrayContaining([{ target: "modules.diagnostics", source: { kind: "system", hash: null }, description: expect.any(String) }]));
  // The index stays small enough for the Provider's tool result: names and one line each, contracts on request.
  expect(JSON.stringify(index)).not.toContain("inputSchema");
  // The Provider's app list keeps the five newest versions and says how many there are.
  const app = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "prices", activeHash: "v6" } });
  for (let i = 0; i < 7; i++) await f.db.moduleVersion.create({ data: { moduleId: app.id, hash: `v${i}`, manifest: {}, source: "build", status: "rejected", intent: {}, report: {}, createdAt: new Date(Date.UTC(2026, 9, 1, i)) } });
  const [prices] = (await f.call("m_modules_list", {}) as { name: string; versions: { hash: string }[]; versionCount: number }[]).filter(item => item.name === "prices");
  expect([prices!.versions.map(version => version.hash), prices!.versionCount]).toEqual([["v6", "v5", "v4", "v3", "v2"], 7]);
  const result = await f.call("m_modules_reference", { target: "modules.diagnostics" });
  expect(result).toMatchObject({ target: "modules.diagnostics", inputSchema: { type: "object", properties: { module: { type: "string" } } },
    outputSchema: { type: "array" }, admission: { visibility: ["modules", "provider", "owner"], uses: "modules.diagnostics" }, contractHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  const reference = result as { examples: unknown[]; documentation: string; contractHash: string };
  expect(reference.examples.map(example => moduleDiagnosticsOutputSchema.parse(example)[0]!.incidents[0]!.status)).toEqual(["retrying", "unresolved", "verifying", "recovered"]);
  expect(reference.documentation).toContain("never replay");
  expect(reference.documentation).toContain("build_request audit");
  expect(await f.call("m_modules_reference", { target: "modules.diagnostics" })).toMatchObject({ contractHash: reference.contractHash });
  // v2-25: every module-callable system tool declares its output.
  expect(await f.call("m_modules_reference", { target: "settings.get" })).toMatchObject({ outputSchema: { type: "object" }, examples: null, sideEffects: null, errors: null, retry: expect.any(String) });
  for (const target of ["modules.overview", "modules.settings-set"]) expect(await f.call("m_modules_reference", { target })).toMatchObject({ outputSchema: expect.any(Object), documentation: expect.stringContaining("not_found"), examples: expect.arrayContaining([expect.anything()]) });
  expect(await f.db.moduleRun.count()).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(0);
});

test("app output references preserve the original JSON Schema and generated call type", async () => {
  const f = await fixture();
  const schema = { type: "object", properties: { zeta: { type: "string" }, alpha: { type: "integer" } }, required: ["zeta", "alpha"], additionalProperties: false };
  const active = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "typed", status: "active", activeHash: "typed-v1" } });
  const appManifest = moduleManifestSchema.parse({ name: "typed", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: [{ name: "read", description: "Read", visibility: ["modules"], parameters: { type: "object", properties: { filters: { type: "array", items: { type: "object", properties: { state: { type: "string", enum: ["ready", "done"] }, limit: { type: "number" } }, required: ["state"] } } }, required: ["filters"] }, output: schema }] });
  await f.db.moduleVersion.create({ data: { moduleId: active.id, hash: "typed-v1", manifest: appManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const reference = await f.call("m_modules_reference", { target: "typed.read" }) as { outputSchema: unknown; inputSchema: { properties: { filters: { items: { additionalProperties: boolean } } } } };
  expect(JSON.stringify(reference.outputSchema)).toBe(JSON.stringify(schema));
  expect(reference.inputSchema.properties.filters.items.additionalProperties).toBe(false);
  expect(await callsDeclaration(f.ports, f.workspace.id)).toContain('"typed.read": { args: { "filters": Array<{ "state": "ready" | "done"; "limit"?: number }> }; output: { "zeta": string; "alpha": number } }');
});

test("reference discovery is workspace scoped, declares unknown outputs, and cannot be used by an app or owner", async () => {
  const f = await fixture();
  const custom = await sources(f);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  const privateModule = await f.db.module.create({ data: { workspaceId: other.id, name: "outside", activeHash: "private" } });
  await f.db.moduleVersion.create({ data: { moduleId: privateModule.id, hash: "private", manifest: { ...manifest, name: "outside" }, status: "approved", source: "user", intent: {}, report: {} } });
  expect(await f.call("m_modules_reference", { target: "web.inspect" })).toMatchObject({ source: { kind: "module", hash: custom.hash }, outputSchema: null });
  expect(JSON.stringify(await f.call("m_modules_reference", {}))).not.toContain("outside.inspect");
  await expect(f.call("m_modules_reference", { target: "outside.inspect" })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.api.modules.callTool("m_modules_reference", {})).rejects.toMatchObject({ code: "not_found" });
  for (const target of ["modules.reference", "modules.checkout"]) {
    await expect(callSync(f.ports, { workspaceId: f.workspace.id, caller: { kind: "module", module: "web", moduleId: custom.module.id, hash: custom.hash }, chain: [], path: [] }, target, {})).rejects.toMatchObject({ code: "forbidden" });
  }
});

test("checkout distinguishes active customization from the current release even when the new built-in was never registered", async () => {
  const f = await fixture(), seeded = await sources(f);
  // Nix may deduplicate release resources with hard links; exported copies must not retain them.
  await link(join(seeded.builtin, "index.ts"), join(f.dataDir, "deduplicated.ts"));
  expect(await f.call("m_modules_checkout", { module: "web", dir: "active" })).toMatchObject({ source: "stored", hash: seeded.hash });
  const result = await f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "reference" }) as { hash: string };
  expect(result).toMatchObject({ source: "builtin", hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(result.hash).not.toBe(seeded.hash);
  expect(await readFile(join(f.run.cwd, "active", "index.ts"), "utf8")).toBe("custom appearance");
  expect(await readFile(join(f.run.cwd, "reference", "index.ts"), "utf8")).toBe("new release feature");
  expect((await stat(join(f.run.cwd, "reference", "index.ts"))).nlink).toBe(1);
  expect(await f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "another" })).toMatchObject({ hash: result.hash });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: seeded.module.id } })).activeHash).toBe(seeded.hash);
  expect(await f.db.moduleVersion.count()).toBe(1);
  expect(await f.db.approval.count()).toBe(0);
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "reference" })).rejects.toMatchObject({ code: "conflict" });
});

test("built-in references reject ambiguous provenance, missing resources, path escapes and symlinks without falling back", async () => {
  const f = await fixture(), seeded = await sources(f);
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", hash: seeded.hash, dir: "ambiguous" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "../escape" })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("m_modules_checkout", { module: "missing", source: "builtin", dir: "missing" })).rejects.toMatchObject({ code: "not_found" });
  const outside = join(f.dataDir, "outside-destination");
  await mkdir(outside);
  await symlink(outside, join(f.run.cwd, "linked-output"));
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "linked-output/copy" })).rejects.toMatchObject({ code: "forbidden" });
  expect(await readdir(outside)).toEqual([]);
  await symlink(seeded.stored, join(f.ports.moduleBuiltinResources!, "linked"));
  await expect(f.call("m_modules_checkout", { module: "linked", source: "builtin", dir: "linked" })).rejects.toMatchObject({ code: "not_found" });
  await symlink(join(seeded.stored, "index.ts"), join(seeded.builtin, "leak.ts"));
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "unsafe" })).rejects.toMatchObject({ code: "forbidden" });
  f.ports.moduleBuiltinResources = undefined;
  await expect(f.call("m_modules_checkout", { module: "web", source: "builtin", dir: "no-fallback" })).rejects.toMatchObject({ code: "not_found" });
});
