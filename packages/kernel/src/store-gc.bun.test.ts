import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectStore } from "./store-gc";
import { moduleSupervisor } from "./modules/module-supervisor";
import { moduleMaterialDigest, storeVersionMaterial } from "./modules/module-artifacts";
import { ensureVersionMaterial } from "./modules/module-source";
import { moduleContext } from "./modules/module-context";
import { testDb } from "./__testing__/test-db";
import type { StewardPorts } from "./ports";

const DAY_MS = 24 * 3600_000;
const now = new Date("2026-11-12T12:00:00Z");
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/store-gc-test-");
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
  });
  const workspace = await db.workspace.create({ data: { name: "store-gc" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example" } });
  const store = join(dataDir, "platform/store");
  await mkdir(store, { recursive: true });
  async function version(name: string, { age = 8, status = "approved", retained = true } = {}) {
    const files = [
      { path: "index.ts", bytes: Buffer.from(name) },
      { path: "module.json", bytes: Buffer.from(JSON.stringify({ name: "example", entry: "index.ts", keepAlive: true, effects: [] })) },
    ];
    files.push({ path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({
      schema: 1, source: ["index.ts", "module.json"], artifacts: [],
      build: { commands: [], toolchain: "offline fixture", target: "fixture" },
    })) });
    const hash = retained ? await storeVersionMaterial(join(dataDir, "platform"), files) : moduleMaterialDigest(files);
    await mkdir(join(store, hash));
    return db.moduleVersion.create({ data: {
      moduleId: module.id, hash, manifest: { name: "example", entry: "index.ts", keepAlive: true, effects: [] }, source: "user", intent: {},
      report: {},
      status, createdAt: new Date(now.getTime() - age * DAY_MS),
    } });
  }
  return { db, ports, module, store, version };
}

const cases = [
  { name: "old retained version", removed: true },
  { name: "active hash", active: true },
  { name: "recent retained version", age: 2 },
  { name: "seven-day boundary", age: 7 },
  { name: "pending review", status: "pending_review" },
  { name: "building", status: "building" },
  { name: "missing retained material", retained: false },
  { name: "orphan", orphan: true },
  { name: "restoration staging", staging: true },
];
test.each(cases)("collectStore protects or collects $name", async scenario => {
  const f = await fixture();
  let hash = scenario.staging ? ".restore-x" : "b".repeat(64);
  if (scenario.orphan || scenario.staging) await mkdir(join(f.store, hash));
  else hash = (await f.version(hash, scenario)).hash;
  if (scenario.active) await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: hash } });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await collectStore(f.ports, now)).toEqual({ removed: scenario.removed ? [hash] : [], kept: scenario.removed || scenario.staging ? 0 : 1 });
    expect(await readdir(f.store)).toEqual(scenario.removed ? [] : [hash]);
    if (scenario.orphan) expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      component: "store-gc", event: "store_gc.orphan", hash,
    });
    if (scenario.removed) expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      component: "store-gc", event: "store_gc.removed", moduleId: f.module.id, hash,
    });
  } finally { log.mockRestore(); }
});

test("second call within 24 hours does no work; next daily pass collects", async () => {
  const f = await fixture();
  await collectStore(f.ports, now);
  const { hash } = await f.version("c".repeat(64));
  expect(await collectStore(f.ports, new Date(now.getTime() + DAY_MS - 1))).toEqual({ removed: [], kept: 0 });
  expect(await readdir(f.store)).toEqual([hash]);
  expect((await collectStore(f.ports, new Date(now.getTime() + DAY_MS))).removed).toEqual([hash]);
});

test("live process hashes remain protected after activeHash changes", async () => {
  const f = await fixture(), { hash } = await f.version("d".repeat(64));
  const live = spyOn(moduleSupervisor(f.ports), "liveHashes").mockReturnValue(new Set([hash]));
  try {
    expect(await collectStore(f.ports, now)).toEqual({ removed: [], kept: 1 });
    expect(await readdir(f.store)).toEqual([hash]);
  } finally { live.mockRestore(); }
});

test("one pass removes at most 20 directories and ignores regular files", async () => {
  const f = await fixture();
  for (let i = 0; i < 22; i++) await f.version(i.toString(16).padStart(64, "0"));
  await writeFile(join(f.store, "ordinary-file"), "preserve");
  const result = await collectStore(f.ports, now);
  expect(result.removed).toHaveLength(20);
  expect(result.kept).toBe(2);
  expect(await readdir(f.store)).toHaveLength(3);
  expect(await Bun.file(join(f.store, "ordinary-file")).text()).toBe("preserve");
});

test("a fresh installation without a store has nothing to collect", async () => {
  const f = await fixture();
  await rm(f.store, { recursive: true });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await collectStore(f.ports, now)).toEqual({ removed: [], kept: 0 });
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("store filesystem errors propagate for tick logging", async () => {
  const f = await fixture();
  await rm(f.store, { recursive: true });
  await writeFile(f.store, "not a directory");
  await expect(collectStore(f.ports, now)).rejects.toMatchObject({ code: "ENOTDIR" });
});

test("a shared material hash is independently recoverable for every version reference", async () => {
  const f = await fixture(), version = await f.version("shared");
  const other = await f.db.module.create({ data: { workspaceId: f.module.workspaceId, name: "other" } });
  await f.db.moduleVersion.create({ data: {
    moduleId: other.id, hash: version.hash, manifest: { name: "other", entry: "index.ts" },
    source: "user", intent: {}, report: {}, status: "approved", createdAt: version.createdAt,
  } });
  expect(await collectStore(f.ports, now)).toEqual({ removed: [version.hash], kept: 0 });
  expect(await readdir(f.store)).toEqual([]);
});

test("material lookup failures preserve the directory and log the failed check", async () => {
  const f = await fixture(), { hash } = await f.version("unreadable");
  await rm(join(f.ports.dataDir, "platform/materials/sha256", hash), { recursive: true });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await collectStore(f.ports, now)).toEqual({ removed: [], kept: 1 });
    expect(await readdir(f.store)).toEqual([hash]);
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      component: "store-gc", event: "store_gc.check_failed", hash, error: expect.any(String),
    });
  } finally { log.mockRestore(); }
});

test("collected checkout restores full retained material with no source checkout or Git", async () => {
  const f = await fixture(), version = await f.version("after-gc");
  expect((await collectStore(f.ports, now)).removed).toEqual([version.hash]);
  await ensureVersionMaterial(moduleContext(f.ports, f.module.workspaceId), version);
  expect(await Bun.file(join(f.store, version.hash, "index.ts")).text()).toBe("after-gc");
});
