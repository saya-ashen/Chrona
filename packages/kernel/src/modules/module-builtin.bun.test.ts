import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES } from "@chrona/contracts/steward";
import { testDb } from "../test-db";
import { registerBuiltins } from "./module-builtin";
import type { StewardPorts } from "../ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-no-builtin-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "Release" } });
  const forbidden = () => { throw new Error("Builtin registration must not install dependencies or execute modules"); };
  const ports: StewardPorts = {
    db, dataDir, now: () => new Date("2026-11-05T00:00:00Z"), publicUrl: null,
    moduleBuiltinResources: join(dataDir, "builtin"),
    sandbox: { available: true, isolated: false, startModule: forbidden, runModule: forbidden },
    packages: { install: forbidden },
  };
  return { db, ports, workspaceId: workspace.id, start: () => registerBuiltins(ports, workspace.id) };
}

test("boot ignores former builtin resources and creates no module, approval or generation", async () => {
  const f = await fixture(), dir = join(f.ports.moduleBuiltinResources!, "agent");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), '{"name":"agent","entry":"index.ts"}');
  await writeFile(join(dir, "index.ts"), "throw new Error('Former builtin must never run');\n");
  expect([...BUILTIN_MODULE_NAMES]).toEqual([]);
  await Promise.all([f.start(), f.start(), registerBuiltins({ ...f.ports }, f.workspaceId)]);
  expect(await f.db.module.count()).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.generation.count()).toBe(0);
  expect(await f.db.kernelFactConsumer.count()).toBe(0);
});

test("boot preserves an ordinary Pi's paused version and data without selecting a new release", async () => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "pi", builtin: false, status: "paused", activeHash: "owner-selected" } });
  const dir = join(f.ports.dataDir, "platform/data", module.id);
  await mkdir(dir, { recursive: true }); await writeFile(join(dir, "owner.json"), '{"keep":true}');
  f.ports.moduleBuiltinResources = undefined;
  await f.start(); await f.start();
  expect(await f.db.module.findUniqueOrThrow({ where: { id: module.id } })).toEqual(module);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.generation.count()).toBe(0);
  expect(await readFile(join(dir, "owner.json"), "utf8")).toBe('{"keep":true}');
});
