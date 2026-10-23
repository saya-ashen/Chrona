import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModulePackages } from "../../../../integrations/src/steward/module-packages";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { createStewardService } from "./service";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const intent = { changes: ["Format with a library"], preserves: [] };

test("lockfile libraries install at build time, never come from the submission, and changed locks need approval", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-deps-");
  const sandbox = createScriptSandbox({ dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-23T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    sandbox: { ...sandbox.health, isolated: true, runModule: sandbox.runModule, startModule: sandbox.startModule }, packages: createModulePackages({ backend: "system" }) };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "deps" } });
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const root = join(dataDir, "sessions", "s"), dir = join(root, "fmt"), dep = join(dataDir, "dep");
  await mkdir(dir, { recursive: true }); await mkdir(dep);
  await writeFile(join(dep, "package.json"), JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }));
  await writeFile(join(dep, "index.js"), "module.exports = { shout: s => s.toUpperCase() };");
  await writeFile(join(dir, "module.json"), JSON.stringify({ name: "fmt", entry: "index.ts", triggers: [], effects: [], tests: ["test.ts"],
    tools: [{ name: "shout", description: "Shout", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] }));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fmt", dependencies: { dep: `file:${dep}` } }));
  await writeFile(join(dir, "index.ts"), `import { on } from "chrona"; import dep from "dep"; on("tool", ev => ({ result: dep.shout(String(ev.args.text)) }));`);
  await writeFile(join(dir, "test.ts"), `import dep from "dep"; if (dep.shout("a") !== "A") process.exit(1);`);
  const propose = async () => {
    const result = await service.modules.propose({ root, dir: "fmt", intent }, "provider");
    await service.modules.buildPending();
    return db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: result.moduleId!, hash: result.hash } } });
  };
  // Without a lockfile nothing is installed or run.
  const unlocked = await propose();
  expect(unlocked.status).toBe("rejected");
  expect(JSON.stringify(unlocked.report)).toContain("bun.lock");
  expect(Bun.spawnSync(["bun", "install", "--ignore-scripts"], { cwd: dir }).exitCode).toBe(0);
  expect(existsSync(join(dir, "node_modules"))).toBe(true);
  const first = await propose();
  expect(first.status).toBe("pending_review");
  expect(first.report).toMatchObject({ dependencies: { npm: true, python: false, packages: {} } });
  // The submission's own node_modules was not taken: Chrona installed the store copy from the lockfile.
  expect(existsSync(join(dataDir, "platform", "store", first.hash, "node_modules", "dep"))).toBe(true);
  const approval = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(approval.preview).toContain("语言库：npm（bun.lock）");
  await service.approvals.resolve(approval.id, { decision: "approve", scope: "always" });
  expect(await service.modules.callTool("m_fmt_shout", { text: "hi" })).toEqual({ result: "HI" });
  // Same code, another library in the lockfile: never automatic, even with an always-grant for this module.
  const extra = join(dataDir, "extra"); await mkdir(extra);
  await writeFile(join(extra, "package.json"), JSON.stringify({ name: "extra", version: "1.0.0", main: "index.js" }));
  await writeFile(join(extra, "index.js"), "module.exports = {};");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "fmt", dependencies: { dep: `file:${dep}`, extra: `file:${extra}` } }));
  expect(Bun.spawnSync(["bun", "install", "--ignore-scripts"], { cwd: dir }).exitCode).toBe(0);
  const second = await propose();
  expect(second.status).toBe("pending_review");
  expect(await db.approval.count({ where: { status: "open" } })).toBe(1);
}, 120_000);
