import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { moduleIncidents, recordModuleFailure, recordModuleRecovery, incidentNextAction, moduleDiagnosticsOutputSchema, type ModuleFailureEvidence } from "./module-diagnostics";
import { createModules } from "./modules";
import { registerSystemModules } from "./system-modules";
import { callSync } from "./module-calls";
import { moduleManifestSchema } from "@chrona/contracts/steward";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const evidence: ModuleFailureEvidence = { phase: "event", reason: "Module disconnected", triggerId: "tool:fetch", runId: "run-1", delivery: "lost", pid: 123,
  exitCode: null, signal: "SIGABRT", stderr: "panic: Failed to start HTTP Client thread", virtualMemoryMb: 512 };
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "diagnostics" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "v1" } });
  const ports = { db, dataDir: "/not-used-for-read-only-diagnostics", publicUrl: null, now: () => new Date("2026-10-25T14:00:00Z") };
  const fail = (extra: Partial<Parameters<typeof recordModuleFailure>[1]> = {}) => db.$transaction(tx => recordModuleFailure(tx, { workspaceId: workspace.id, moduleId: module.id, hash: "v1", now: ports.now(), retry: true, evidence, ...extra }));
  const recovery = (trigger?: string, hash = "v1") => recordModuleRecovery(ports, { workspaceId: workspace.id, moduleId: module.id, hash, activationId: null, triggerId: trigger });
  const incidents = () => moduleIncidents(db, workspace.id, module.id);
  return { db, workspace, module, ports, fail, recovery, incidents };
}

test("repeated failures form one durable incident; connection alone and an unrelated event do not verify recovery", async () => {
  const f = await fixture();
  const first = (await f.fail())!;
  await f.fail(); await f.fail({ retry: false, evidence: { ...evidence, stderr: "", reason: "Module start timeout" } });
  expect(await f.incidents()).toMatchObject([{ id: first.id, failures: 3, status: "unresolved", firstEvidence: { stderr: "panic: Failed to start HTTP Client thread" }, evidence: { reason: "Module start timeout", signal: "SIGABRT", virtualMemoryMb: 512 } }]);
  await f.recovery();
  expect(await f.incidents()).toMatchObject([{ status: "verifying", failures: 3 }]);
  const count = await f.db.audit.count();
  await f.recovery(); await f.recovery("tool:other");
  expect(await f.db.audit.count()).toBe(count);
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
