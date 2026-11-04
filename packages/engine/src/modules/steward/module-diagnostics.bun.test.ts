import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { moduleIncidents, recordModuleFailure, recordModuleRecovery, incidentNextAction, moduleDiagnosticsOutputSchema, moduleHealthOutputSchema, recordModuleOutputMismatch, type ModuleFailureEvidence } from "./module-diagnostics";
import { createModules, moduleHealthSummary } from "./modules";
import { registerSystemModules } from "./system-modules";
import { callSync } from "./module-calls";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleContext } from "./module-context";
import { recordModuleActivation } from "./module-evolution";
import { moduleFailurePolicy } from "./module-failure-policy";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const evidence: ModuleFailureEvidence = { phase: "event", reason: "Module disconnected", triggerId: "tool:fetch", runId: "run-1", delivery: "lost", pid: 123,
  exitCode: null, signal: "SIGABRT", stderr: "panic: Failed to start HTTP Client thread", virtualMemoryMb: 512 };
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "diagnostics" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  const ports = { db, dataDir: "/not-used-for-read-only-diagnostics", publicUrl: null, now: () => new Date("2026-10-25T14:00:00Z") };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [] }), source: "user", status: "approved", intent: {}, report: {} } });
  const { activationId } = await db.$transaction(tx => recordModuleActivation(moduleContext(ports, workspace.id), tx, { moduleId: module.id, previousHash: null, hash: "v1", generationId: "fixture" }));
  let execution = 0;
  const fail = (extra: Partial<Parameters<typeof recordModuleFailure>[1]> = {}) => db.$transaction(tx => recordModuleFailure(tx, { workspaceId: workspace.id, moduleId: module.id, activationId, hash: "v1", now: ports.now(), retry: true, ...extra, evidence: { ...(extra.evidence ?? evidence), runId: `run-${++execution}` } }));
  const recovery = (trigger?: string, hash = "v1") => recordModuleRecovery(ports, { workspaceId: workspace.id, moduleId: module.id, hash, activationId, triggerId: trigger, ...(trigger ? { runId: `success-${++execution}` } : {}) });
  const incidents = () => moduleIncidents(db, workspace.id, module.id);
  return { db, workspace, module, ports, activationId, fail, recovery, incidents };
}

test("repeated failures form one durable incident; connection alone and an unrelated event do not verify recovery", async () => {
  const f = await fixture();
  const first = (await f.fail())!;
  await f.fail(); await f.fail({ retry: false, evidence: { ...evidence, stderr: "", reason: "Module start timeout" } });
  expect(await f.incidents()).toMatchObject([{ id: first.id, failures: 3, status: "unresolved", firstEvidence: { stderr: "panic: Failed to start HTTP Client thread" }, evidence: { reason: "Module start timeout", signal: "SIGABRT", virtualMemoryMb: 512 } }]);
  await f.recovery();
  expect(await f.incidents()).toMatchObject([{ status: "verifying", failures: 3 }]);
  const count = await f.db.audit.count({ where: { kind: "module_runtime_incident" } });
  await f.recovery(); await f.recovery("tool:other");
  expect(await f.db.audit.count({ where: { kind: "module_runtime_incident" } })).toBe(count);
  await f.recovery("tool:fetch");
  const [recovered] = await f.incidents();
  expect(recovered).toMatchObject({ status: "recovered", deliveryUnknown: true, failures: 3, attempts: expect.arrayContaining([expect.objectContaining({ action: "verified" })]) });
  expect(incidentNextAction(recovered)).toContain("不要直接重放");
  const second = (await f.fail())!;
  expect(second.id).not.toBe(first.id);
  expect(await f.incidents()).toHaveLength(2);
});

test.each([
  { phase: "start", triggerId: "process", verification: "tool:any", recovered: true },
  { phase: "process", triggerId: "process", verification: "tool:any", recovered: true },
  { phase: "event", triggerId: "daily", verification: "tool:any", recovered: false },
  { phase: "event", triggerId: "daily", verification: "daily", recovered: true },
] as const)("verification follows the failed capability: %p", async ({ phase, triggerId, verification, recovered }) => {
  const f = await fixture();
  await f.fail({ evidence: { ...evidence, phase, triggerId } });
  await f.recovery(verification);
  expect((await f.incidents())[0]!.status === "recovered").toBe(recovered);
});

test("verifying one failed capability does not clear another failed capability", async () => {
  const f = await fixture();
  await f.fail();
  await f.fail({ evidence: { ...evidence, triggerId: "tool:other" } });
  await f.recovery("tool:other");
  expect((await f.incidents())[0]).toMatchObject({ status: "verifying", pendingTriggers: ["tool:fetch"] });
  await f.recovery("tool:fetch");
  expect((await f.incidents())[0]).toMatchObject({ status: "recovered", pendingTriggers: [] });
});

test("version changes cannot silently resolve an older incident; evidence and attempts are bounded and scrubbed before persistence", async () => {
  const f = await fixture();
  const key = "CHRONA_DIAGNOSTIC_TEST_TOKEN", old = process.env[key];
  process.env[key] = "synthetic-diagnostic-credential";
  try {
    await f.fail({ evidence: { ...evidence, reason: "password=private-example", stderr: 'Bearer abcdefghijklmnopqrst token=private-example synthetic-diagnostic-credential ' + "x".repeat(20_000) } });
    await f.recovery("tool:fetch", "v2");
    expect((await f.incidents())[0]!.status).toBe("retrying");
    const raw = JSON.stringify(await f.db.audit.findMany());
    expect(raw).not.toContain("private-example"); expect(raw).not.toContain("synthetic-diagnostic-credential"); expect(raw).not.toContain("abcdefghijklmnopqrst");
    expect((await f.incidents())[0]!.evidence.stderr.length).toBeLessThan(4100);
    for (let i = 0; i < 12; i++) await f.fail();
    expect((await f.incidents())[0]!.attempts).toHaveLength(10);
  } finally { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
});

test.each([
  { outcomes: ["failure", "connected", "failure"], consecutiveFailures: 2, total: 2 },
  { outcomes: ["failure", "success", "failure", "failure"], consecutiveFailures: 2, total: 3 },
  { outcomes: ["failure", "failure", "success", "failure"], consecutiveFailures: 1, total: 3 },
  { outcomes: ["failure", "failure", "failure"], consecutiveFailures: 3, total: 3 },
])("one durable policy separates the execution streak from incident totals: %p", async ({ outcomes, consecutiveFailures, total }) => {
  const f = await fixture();
  for (const outcome of outcomes) {
    if (outcome === "failure") await f.fail();
    else await f.recovery(outcome === "success" ? "tool:other" : undefined);
  }
  expect(await moduleFailurePolicy(f.db, { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "v1", activationId: f.activationId })).toMatchObject({ consecutiveFailures, shouldPause: consecutiveFailures >= 3 });
  expect(await f.incidents()).toMatchObject([{ failures: total, pendingTriggers: ["tool:fetch"] }]);
  expect(await moduleHealthSummary(f.ports, f.workspace.id, f.module)).toMatchObject({ consecutiveFailures, incident: { failures: total } });
  const snapshots = await f.db.audit.findMany({ where: { kind: "module_runtime_incident" }, orderBy: { createdAt: "asc" } });
  expect(snapshots.map(row => (row.details as { revision: number }).revision)).toEqual(snapshots.map((_, i) => i + 1));
});

test("legacy hash-only incidents stay unattributed and immutable, never merged or recovered by a current activation", async () => {
  const f = await fixture();
  const current = (await f.fail())!;
  const { activationId: _activationId, revision: _revision, attribution: _attribution, ...old } = current;
  const legacy = { ...old, id: "legacy-incident" };
  const row = await f.db.audit.create({ data: { workspaceId: f.workspace.id, subjectId: f.module.id, actorKey: "chrona", kind: "module_runtime_incident", createdAt: new Date("2026-10-26T00:00:00Z"), details: legacy } });
  const output = await createModules(f.ports, f.workspace.id).diagnostics("example");
  expect(output[0]!.incidents[0]).toEqual({ ...legacy, attribution: "legacy-unattributed" });
  expect(output[0]!.incidents[0]).not.toHaveProperty("activationId");
  expect(output[0]!.incidents[0]).not.toHaveProperty("revision");
  await f.recovery("tool:fetch");
  await f.fail();
  expect((await f.incidents()).find(item => item.id === legacy.id)).toEqual({ ...legacy, attribution: "legacy-unattributed" });
  expect((await f.db.audit.findUniqueOrThrow({ where: { id: row.id } })).details).toEqual(legacy);
});

test("duplicate observation of a real failure run changes neither streak nor incident revision", async () => {
  const f = await fixture();
  const first = (await f.fail())!;
  await f.db.$transaction(tx => recordModuleFailure(tx, { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "v1", activationId: f.activationId, retry: true, now: f.ports.now(), evidence: first.evidence }));
  expect(await f.incidents()).toEqual([first]);
  expect(await moduleFailurePolicy(f.db, { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "v1", activationId: f.activationId })).toMatchObject({ consecutiveFailures: 1, shouldPause: false });
});

test("offline diagnostics survive new service objects, are read-only and workspace-scoped", async () => {
  const f = await fixture();
  await f.fail({ retry: false });
  const count = await f.db.audit.count();
  const api = createModules({ ...f.ports }, f.workspace.id);
  const output = await api.diagnostics("example");
  expect(output).toEqual(moduleDiagnosticsOutputSchema.parse(output));
  expect(output).toMatchObject([{ module: "example", runtime: { state: "unobserved", pid: null }, incidents: [{ status: "unresolved" }] }]);
  expect(await f.db.audit.count()).toBe(count);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(createModules(f.ports, other.id).diagnostics(f.module.id)).rejects.toMatchObject({ code: "not_found" });
  expect(await createModules(f.ports, other.id).diagnostics()).toEqual([]);
});

test("health separates same-hash activations and legacy history, counts only attributed mismatches and omits stderr", async () => {
  const f = await fixture(), api = createModules(f.ports, f.workspace.id);
  const old = (await f.fail({ retry: false }))!;
  const mismatch = { workspaceId: f.workspace.id, moduleId: f.module.id, hash: "v1", tool: "fetch", callId: "old", issues: ["$.value"], now: f.ports.now() };
  await recordModuleOutputMismatch(f.db, { ...mismatch, activationId: f.activationId });
  await recordModuleOutputMismatch(f.db, { ...mismatch, callId: "legacy" });
  const activation = await f.db.$transaction(tx => recordModuleActivation(moduleContext(f.ports, f.workspace.id), tx, { moduleId: f.module.id, previousHash: "v1", hash: "v1", generationId: "reactivation" }));
  const { activationId: _id, revision: _revision, attribution: _attribution, ...legacy } = old;
  await f.db.audit.create({ data: { workspaceId: f.workspace.id, subjectId: f.module.id, actorKey: "chrona", kind: "module_runtime_incident", details: { ...legacy, id: "legacy" } } });
  const [view] = await api.diagnostics("example");
  expect(view).toMatchObject({ activation: { activationId: activation.activationId }, incident: null, consecutiveFailures: 0, contractFailureCount: 0, open: false, truncated: false });
  expect(view!.incidents).toEqual(expect.arrayContaining([expect.objectContaining({ id: old.id, status: "unresolved" }), expect.objectContaining({ id: "legacy", attribution: "legacy-unattributed" })]));
  await recordModuleOutputMismatch(f.db, { ...mismatch, callId: "current", activationId: activation.activationId });
  const health = await moduleHealthSummary(f.ports, f.workspace.id, f.module);
  expect(health).toMatchObject({ contractFailureCount: 1, open: true, incident: null });
  expect(JSON.stringify(health)).not.toContain(evidence.stderr);
  expect((await api.list())[0]!.health).toEqual(health);
  expect((await api.list())[0]).not.toHaveProperty("runtime");
  expect((await api.list())[0]).not.toHaveProperty("incident");
});

test("health bounded incident scan marks incomplete current evidence", async () => {
  const f = await fixture(), old = (await f.fail())!;
  await f.db.audit.createMany({ data: Array.from({ length: 201 }, (_, i) => ({ workspaceId: f.workspace.id, subjectId: f.module.id, actorKey: "chrona", kind: "module_runtime_incident", createdAt: new Date(f.ports.now().getTime() + i + 1), details: { ...old, activationId: "another-activation", id: `other-${i}` } })) });
  expect(await moduleHealthSummary(f.ports, f.workspace.id, f.module)).toMatchObject({ incident: null, truncated: true });
});

test("health pages by name, filters open before pagination and isolates workspaces", async () => {
  const f = await fixture(), api = createModules(f.ports, f.workspace.id);
  await f.fail({ retry: false });
  await f.db.module.createMany({ data: Array.from({ length: 51 }, (_, i) => ({ workspaceId: f.workspace.id, name: `app-${String(i).padStart(2, "0")}` })) });
  const other = await f.db.workspace.create({ data: { name: "other-health" } });
  await f.db.module.create({ data: { workspaceId: other.id, name: "foreign" } });
  // Even a foreign workspace audit using this module's subject must not count.
  await f.db.audit.create({ data: { workspaceId: other.id, subjectId: f.module.id, kind: "module_output_mismatch", actorKey: "chrona", details: { hash: "v1", activationId: f.activationId, tool: "fetch", callId: "foreign", at: f.ports.now().toISOString(), issues: [] } } });
  const first = moduleHealthOutputSchema.parse(await api.health());
  expect(first.items).toHaveLength(50); expect(first.nextCursor).toBe("app-49");
  const second = await api.health({ cursor: first.nextCursor! });
  expect(second.items.map(item => item.module)).toEqual(["app-50", "example"]); expect(second.nextCursor).toBeNull();
  const open = await api.health({ open: true });
  expect(open.items.map(item => item.module)).toEqual(["example"]); expect(open.nextCursor).toBeNull();
  expect(open.items[0]).toMatchObject({ contractFailureCount: 0, open: true, incident: { status: "unresolved" } });
  expect(JSON.stringify(open)).not.toContain(evidence.stderr);
  expect((await createModules(f.ports, other.id).health()).items.map(item => item.module)).toEqual(["foreign"]);
});

test("detailed diagnostics admit Provider, owner and every module without a uses entry", async () => {
  const f = await fixture(); registerSystemModules();
  await f.fail();
  for (const name of ["web", "mcp", "other"]) {
    const module = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, activeHash: name } });
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], uses: [] });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: name, manifest, source: "user", status: "approved", report: {}, intent: {} } });
    const origin = { workspaceId: f.workspace.id, caller: { kind: "module" as const, moduleId: module.id, module: name, hash: name }, chain: [], path: [] };
    const request = callSync(f.ports, origin, "modules.diagnostics", { module: "example" });
    expect((await request).output).toMatchObject([{ module: "example", incidents: [{ failures: 1 }] }]);
  }
  for (const caller of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "test-run" }]) {
    expect((await callSync(f.ports, { workspaceId: f.workspace.id, caller, chain: [], path: [] }, "modules.diagnostics", {})).output).toBeArray();
  }
});
