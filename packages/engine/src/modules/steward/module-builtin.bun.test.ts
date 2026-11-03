import { expect, spyOn, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import { registerBuiltins } from "./module-builtin";
import { createModules } from "./modules";
import { testModuleSandbox } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "./ports";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { notices } from "./test-notices";
import { createApprovals } from "./approvals";
import { onApproved } from "./module-activation";
import { moduleContext } from "./module-context";
import { proposeBuiltin } from "./module-proposal";

async function fixture(real = false) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-builtin-");
  const workspace = await db.workspace.create({ data: { name: "builtins" } });
  const root = join(dataDir, "resources"), code = join(root, "sample");
  await mkdir(code, { recursive: true });
  let tests = 0;
  const sandbox = real ? createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined }) : testModuleSandbox(async input => {
    if (input.entry === "test.ts") tests++;
    return { status: "succeeded", exitCode: 0, output: '{"effects":[],"result":"ok"}', error: null };
  });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-22T00:00:00Z"), publicUrl: null, moduleBuiltinResources: root,
    sandbox: real ? { available: true, isolated: true, runModule: sandbox.runModule, startModule: sandbox.startModule } : sandbox as StewardPorts["sandbox"] };
  async function write(revision: number) {
    await writeFile(join(code, "module.json"), JSON.stringify({ name: "sample", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: [{ name: "lookup", description: "Lookup", output: { type: "integer" }, parameters: { type: "object", properties: {} } }] }));
    await writeFile(join(code, "index.ts"), `import { on } from 'chrona'; on('tool', () => ({ result: ${revision} }));`);
    await writeFile(join(code, "test.ts"), `import { startModule } from 'chrona/testing'; import { strict as assert } from 'node:assert'; const m = await startModule('index.ts'); try { const now = '2026-10-22T00:00:00Z'; const reply = await m.send({ trigger: { kind: 'tool', id: 'lookup', firedAt: now, args: {} }, now, params: {} }); assert.equal(reply.result.result, ${revision}); } finally { await m.stop(); }`);
  }
  await write(1);
  const current = () => db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: workspace.id, name: "sample" } } });
  return { db, ports, workspace, code, root, write, current, tests: () => tests,
    start: () => registerBuiltins(ports, workspace.id),
    async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("built-in fresh registration and second start: validated, tested, active, no approval", async () => {
  const f = await fixture();
  try {
    await f.start();
    expect(await f.current()).toMatchObject({ builtin: true, status: "active", dataSchema: 1 });
    expect(await f.db.moduleVersion.findFirst()).toMatchObject({ source: "builtin", status: "approved" });
    expect(f.tests()).toBe(1);
    expect(await f.db.approval.count()).toBe(0);
    const first = await f.current();
    await f.start();
    expect((await f.current()).activeHash).toBe(first.activeHash);
    expect(await f.db.moduleVersion.count()).toBe(1);
    expect(await f.db.generation.count()).toBe(1);
    expect(f.tests()).toBe(1);
  } finally { await f.close(); }
});

test.each(["smoke", "exception"])("rejected built-in logs its report and leaves testing immediately: %s", async failure => {
  const f = await fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    if (failure === "smoke") {
      f.ports.sandbox = testModuleSandbox(async input => input.entry === "test.ts"
        ? { status: "succeeded", exitCode: 0, output: "{}", error: null }
        : { status: "failed", exitCode: 1, output: "", error: "fixture smoke failed" });
    } else {
      await writeFile(join(f.code, "package.json"), "{}");
      await writeFile(join(f.code, "bun.lock"), "{}");
      f.ports.packages = { backend: "system", install: async () => { throw new Error("fixture installer failed"); } };
    }
    await f.start();
    const version = await f.db.moduleVersion.findFirstOrThrow();
    expect(version).toMatchObject({ source: "builtin", status: "rejected" });
    expect(await f.db.moduleVersion.count({ where: { status: "testing" } })).toBe(0);
    // Other tests' background work can log in the same process: count only this event.
    const rejected = log.mock.calls.map(call => { try { return JSON.parse(String(call[0])); } catch { return null; } }).filter(entry => entry?.event === "builtin.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ level: "error", component: "module-build", event: "builtin.rejected", module: "sample", hash: version.hash, errors: expect.arrayContaining([expect.stringContaining(failure === "smoke" ? "fixture smoke failed" : "fixture installer failed")]) });
    expect(await f.db.run.count()).toBe(0);
  } finally { log.mockRestore(); await f.close(); }
});

test("built-ins register from a release directory whose files are hard-linked (Nix store optimisation)", async () => {
  const f = await fixture();
  try {
    for (const name of ["module.json", "index.ts", "test.ts"]) { await link(join(f.code, name), join(f.root, `${name}.link`)); await chmod(join(f.code, name), 0o444); }
    // Read-only like the store: registration must still clean up its private copy, every start.
    await chmod(f.code, 0o555); await chmod(f.root, 0o555);
    const before = (await readdir(tmpdir())).filter(name => name.startsWith("chrona-builtin-")).length;
    await f.start(); await f.start();
    expect(await f.current()).toMatchObject({ builtin: true, status: "active" });
    expect((await readdir(tmpdir())).filter(name => name.startsWith("chrona-builtin-")).length).toBe(before);
  } finally { await chmod(f.root, 0o755); await chmod(f.code, 0o755); await f.close(); }
});
test.each([false, "user", "provider", "build"] as const)("built-in upgrade preserves custom version: %s", async source => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.current();
    if (source) {
      await f.write(2);
      const modules = createModules(f.ports, f.workspace.id);
      const result = await modules.propose({ root: f.root, dir: "sample", intent: { changes: ["User customization"] } }, source);
      await modules.buildPending();
      await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: first.id, hash: result.hash } }, data: { status: "approved" } });
      await modules.activate(first.id, result.hash, "activate");
    }
    const before = await f.current(), reviews = await f.db.approval.findMany({ where: { status: "open" } });
    await f.write(3); await f.start();
    const after = await f.current();
    if (source) {
      expect(after.activeHash).toBe(before.activeHash);
      // The release's built-in is tested and approved but not activated: only an explicit rollback switches to it.
      expect(await f.db.moduleVersion.findMany({ where: { source: "builtin" }, select: { status: true } })).toEqual([{ status: "approved" }, { status: "approved" }]);
      expect(await f.db.approval.findMany({ where: { status: "open" } })).toEqual(reviews);
      expect((await notices(f.db)).filter(n => n.title.includes("内置"))).toHaveLength(0);
      await f.start();
      expect((await f.current()).activeHash).toBe(before.activeHash);
      expect(await f.db.approval.findMany({ where: { status: "open" } })).toEqual(reviews);
      const release = await f.db.moduleVersion.findFirstOrThrow({ where: { source: "builtin", hash: { not: first.activeHash! } } });
      expect(await createModules(f.ports, f.workspace.id).rollback(first.id, release.hash)).toMatchObject({ status: "active", activeHash: release.hash });
    } else {
      expect(after.activeHash).not.toBe(before.activeHash);
      expect(await f.db.approval.count()).toBe(0);
    }
  } finally { await f.close(); }
});

test("legacy built-in replacement approvals are blocked atomically and retired; restore approvals survive", async () => {
  const f = await fixture();
  try {
    await f.start(); const builtin = await f.current();
    await f.write(2);
    const modules = createModules(f.ports, f.workspace.id);
    const fork = await modules.propose({ root: f.root, dir: "sample", intent: { changes: ["React fork"] } }, "build");
    await modules.buildPending();
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: builtin.id, hash: fork.hash } }, data: { status: "approved" } });
    await modules.activate(builtin.id, fork.hash, "activate");
    const approvals = createApprovals({ ...f.ports, workspaceId: f.workspace.id });
    const old = await approvals.create({ moduleId: builtin.id, action: "activate_module", title: "Legacy replacement", detail: "", preview: "", payload: { kind: "activate_module", moduleId: builtin.id, hash: builtin.activeHash! } });
    const restore = await approvals.create({ moduleId: builtin.id, action: "activate_module", title: "Explicit snapshot restore", detail: "", preview: "", payload: { kind: "activate_module", moduleId: builtin.id, hash: builtin.activeHash!, restore: { schema: 1, snapshotAt: "fixture" } } });
    const grants = await f.db.grant.count();
    for (const source of ["web", "mcp", "qq", "entry", "cli"] as const) await expect(approvals.resolve(old.id, { decision: "approve", scope: "once" }, source)).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("内置版本不能") });
    expect(await f.db.grant.count()).toBe(grants);
    expect((await approvals.list("open")).some(a => a.id === old.id)).toBe(true);
    await f.start();
    expect((await f.db.approval.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("expired");
    expect((await f.db.approval.findUniqueOrThrow({ where: { id: restore.id } })).status).toBe("open");
    expect(await f.db.approval.count({ where: { status: "open", id: { not: restore.id } } })).toBe(0);
    expect((await f.current()).activeHash).toBe(fork.hash);
    // Explicit owner rollback still works, without copying old data or creating a model run.
    expect(await modules.rollback(builtin.id, builtin.activeHash!)).toMatchObject({ status: "active" });
    expect((await f.current()).activeHash).toBe(builtin.activeHash);
    expect(await f.db.run.count()).toBe(0);
  } finally { await f.close(); }
});

test("a built-in already queued when the user activates a fork cannot create a replacement review", async () => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.current();
    await f.write(2);
    const modules = createModules(f.ports, f.workspace.id);
    const fork = await modules.propose({ root: f.root, dir: "sample", intent: { changes: ["Fork"] } }, "user");
    await modules.buildPending();
    await f.write(3);
    const builtin = await proposeBuiltin(moduleContext(f.ports, f.workspace.id), f.root, "sample");
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: first.id, hash: fork.hash } }, data: { status: "approved" } });
    await modules.activate(first.id, fork.hash, "activate");
    const reviews = await f.db.approval.findMany({ where: { status: "open" } });
    await modules.buildPending();
    expect((await f.current()).activeHash).toBe(fork.hash);
    expect(await f.db.approval.findMany({ where: { status: "open" } })).toEqual(reviews);
    expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: first.id, hash: builtin.hash } } })).toMatchObject({ status: "approved" });
    expect((await notices(f.db)).filter(n => n.title.includes("内置"))).toHaveLength(0);
  } finally { await f.close(); }
});

test("activation rechecks a previously approved builtin card after a fork becomes active", async () => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.current();
    await f.write(3);
    const context = moduleContext(f.ports, f.workspace.id), target = await proposeBuiltin(context, f.root, "sample");
    await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: first.id, hash: target.hash } }, data: { status: "pending_review" } });
    const approvals = createApprovals({ ...f.ports, workspaceId: f.workspace.id });
    const approval = await approvals.create({ moduleId: first.id, action: "activate_module", title: "Release", detail: "", preview: "", payload: { kind: "activate_module", moduleId: first.id, hash: target.hash } });
    const approved = await approvals.resolve(approval.id, { decision: "approve", scope: "once" }, "web");
    // The fork's checks pass and it activates by itself before the approved release is carried out.
    await f.write(2);
    const modules = createModules(f.ports, f.workspace.id);
    const fork = await modules.propose({ root: f.root, dir: "sample", intent: { changes: ["Fork"] } }, "build");
    await modules.buildPending();
    await expect(onApproved(context, { workspaceId: f.workspace.id, approvalId: approval.id, grantId: approved.grantId!, payload: approved.payload! })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("内置版本不能") });
    expect((await f.current()).activeHash).toBe(fork.hash);
    expect((await f.db.grant.findUniqueOrThrow({ where: { id: approved.grantId! } })).consumedAt).toBeNull();
  } finally { await f.close(); }
});

const realSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
if (!realSandbox.health.isolated) console.info("SKIP built-in real process: bwrap isolation unavailable");
(realSandbox.health.isolated ? test : test.skip)("built-in registration runs author tests and smoke in real bwrap SDK processes", async () => {
  const f = await fixture(true);
  try { await f.start(); expect(await f.current()).toMatchObject({ status: "active" }); }
  finally { await f.close(); }
});
