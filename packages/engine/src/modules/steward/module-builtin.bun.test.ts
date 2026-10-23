import { expect, test } from "bun:test";
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
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-22T00:00:00Z"), deliveries: [], chat: null, publicUrl: null, moduleBuiltinResources: root,
    sandbox: real ? { available: true, isolated: true, runModule: sandbox.runModule, startModule: sandbox.startModule } : sandbox as StewardPorts["sandbox"] };
  async function write(revision: number) {
    await writeFile(join(code, "module.json"), JSON.stringify({ name: "sample", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object", properties: {} } }] }));
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
test.each([false, true])("built-in upgrade preserves user version: %s", async user => {
  const f = await fixture();
  try {
    await f.start(); const first = await f.current();
    if (user) {
      await f.write(2);
      const modules = createModules(f.ports, f.workspace.id);
      const result = await modules.propose({ root: f.root, dir: "sample", intent: { changes: ["User customization"] } }, "user");
      await modules.buildPending();
      await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: first.id, hash: result.hash } }, data: { status: "approved" } });
      await modules.activate(first.id, result.hash, "activate");
    }
    const before = await f.current(); await f.write(3); await f.start();
    const after = await f.current();
    if (user) {
      expect(after.activeHash).toBe(before.activeHash);
      expect(await f.db.moduleVersion.findFirst({ where: { source: "builtin", hash: { not: first.activeHash! } } })).toMatchObject({ status: "pending_review" });
      expect(await f.db.notification.findFirst()).toMatchObject({ level: "web" });
      await f.start(); expect(await f.db.notification.count()).toBe(1);
    } else {
      expect(after.activeHash).not.toBe(before.activeHash);
      expect(await f.db.approval.count()).toBe(0);
    }
  } finally { await f.close(); }
});

const realSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
if (!realSandbox.health.available) console.info("SKIP built-in real process: bwrap sandbox unavailable");
(realSandbox.health.available ? test : test.skip)("built-in registration runs author tests and smoke in real bwrap SDK processes", async () => {
  const f = await fixture(true);
  try { await f.start(); expect(await f.current()).toMatchObject({ status: "active" }); }
  finally { await f.close(); }
});
