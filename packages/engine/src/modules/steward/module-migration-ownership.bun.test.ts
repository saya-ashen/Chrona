import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as filesystem from "node:fs/promises";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { startMigration } from "./module-generation";
import { migrateData, recoverMigrations, type PreparedMigration } from "./module-migration";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-migration-owner-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "migration" } })).id;
  const now = new Date("2026-11-05T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, sandbox: { available: true, isolated: false, runModule: async input => {
    await writeFile(join(input.dataDir, "state"), "migrated");
    return { status: "succeeded", exitCode: 0, output: "", error: null };
  } } };
  const context = moduleContext(ports, workspaceId);
  const module = await db.module.create({ data: { workspaceId, name: "sample", activeHash: "old", dataSchema: 1 } });
  const manifest = moduleManifestSchema.parse({ name: "sample", entry: "index.ts", keepAlive: true, tests: ["test.ts"], data: { schema: 2, migrate: "migrate.ts" }, effects: [], triggers: [] });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "next", manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const live = join(dataDir, "platform/data", module.id);
  await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "original");
  const prepared: PreparedMigration = { module, version, manifest, from: 1, to: 2 };
  const start = (hash = "next") => db.$transaction(tx => startMigration(context, tx, module.id, hash, { from: 1, to: 2 }));
  return { db, context, ports, module, version, prepared, start, live, now, workspaceId };
}
for (const reason of ["activate", "rollback"] as const) test(`paused cross-schema ${reason} retains the intended status`, async () => {
  const f = await fixture();
  await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
  f.prepared.module.status = "paused";
  await f.start(); await migrateData(f.context, f.prepared, reason);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "next", dataSchema: 2, status: reason === "activate" ? "paused" : "active" });
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("migrated");
});
for (const offset of [-60_000, 0, 60_000]) test(`migration admission orders same-clock transactions after prior offset ${offset}`, async () => {
  const f = await fixture();
  await f.db.audit.create({ data: { workspaceId: f.workspaceId, subjectId: f.module.id, actorKey: "chrona", kind: "module_migration_started", details: { hash: "history" }, createdAt: new Date(f.now.getTime() + offset) } });
  // Real database transactions serialize concurrent writers; each reads the preceding committed timestamp.
  await Promise.all([f.start("first"), f.start("next")]);
  const rows = await f.db.audit.findMany({ where: { subjectId: f.module.id, kind: "module_migration_started" }, orderBy: { createdAt: "asc" } });
  expect(rows).toHaveLength(3);
  expect(rows[1]!.createdAt.getTime()).toBeGreaterThan(rows[0]!.createdAt.getTime());
  expect(rows[2]!.createdAt.getTime()).toBeGreaterThan(rows[1]!.createdAt.getTime());
  const owner = (rows[2]!.details as { hash: string }).hash;
  if (owner !== "next") await f.start();
  await migrateData(f.context, f.prepared, "rollback");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: "next", status: "active" });
});
for (const changed of ["candidate", "hash", "status", "identity"] as const) test(`failed migration cannot compensate after losing ${changed} ownership`, async () => {
  const f = await fixture(); await f.start();
  f.ports.sandbox!.runModule = async input => {
    await writeFile(join(input.dataDir, "state"), "partial");
    if (changed === "candidate") await f.start("newer");
    else await f.db.module.update({ where: { id: f.module.id }, data: changed === "hash" ? { activeHash: "new-owner" } : changed === "status" ? { status: "paused" } : { builtin: true } });
    return { status: "failed", exitCode: 1, output: "", error: "synthetic" };
  };
  await expect(migrateData(f.context, f.prepared, "activate")).rejects.toThrow();
  const current = await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } });
  expect(current.status).toBe(changed === "status" ? "paused" : "migrating");
  expect(current.activeHash).toBe(changed === "hash" ? "new-owner" : "old");
  expect(current.builtin).toBe(changed === "identity");
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("original");
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { id: f.version.id } })).toMatchObject({ status: "approved" });
});

function beforeActivation(tx: Prisma.TransactionClient, work: () => Promise<void>) {
  return new Proxy(tx, { get(target, key) {
    if (key !== "module") return Reflect.get(target, key);
    return new Proxy(target.module, { get(delegate, property) {
      if (property !== "update") return Reflect.get(delegate, property);
      return async (args: Prisma.ModuleUpdateArgs) => {
        if (args.data.activeHash === "next") await work();
        return delegate.update(args);
      };
    } });
  } });
}
for (const failure of ["activation", "commit"] as const) test(`post-swap ${failure} failure restores original data and database`, async () => {
  const f = await fixture(); await f.start();
  const transaction = f.db.$transaction.bind(f.db);
  let armed = true, observedSwap = false;
  const fail = async () => {
    observedSwap = true;
    expect(await readFile(join(f.live, "state"), "utf8")).toBe("migrated");
    armed = false; throw new Error(`synthetic ${failure} rejection`);
  };
  f.db.$transaction = ((work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => {
    const result = await work(beforeActivation(tx, async () => { if (armed && failure === "activation") await fail(); }));
    // Callback returned normally. Reject before durable commit; the real adapter rolls the DB transaction back.
    if (armed && failure === "commit" && (await tx.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash === "next") await fail();
    return result;
  })) as typeof f.db.$transaction;
  await migrateData(f.context, f.prepared, "activate");
  expect(observedSwap).toBe(true);
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("original");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: "old", dataSchema: 1 });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { id: f.version.id } })).toMatchObject({ status: "rejected" });
});
test("post-swap competing candidate waits for activation commit and keeps the committed data", async () => {
  const f = await fixture(); await f.start();
  let signal!: () => void, observedSwap = false, admitted = false;
  const swapping = new Promise<void>(resolve => { signal = resolve; });
  // Launch outside the transaction callback so it is an independent database writer.
  const contender = (async () => { await swapping; await f.start("newer"); admitted = true; })();
  const transaction = f.db.$transaction.bind(f.db);
  f.db.$transaction = ((work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(tx => work(beforeActivation(tx, async () => {
    observedSwap = true; signal();
    expect(await readFile(join(f.live, "state"), "utf8")).toBe("migrated");
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(admitted).toBe(false);
  })))) as typeof f.db.$transaction;
  await migrateData(f.context, f.prepared, "activate"); await contender;
  expect(observedSwap).toBe(true); expect(admitted).toBe(true);
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("migrated");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "migrating", activeHash: "next", dataSchema: 2 });
});
test("failed in-lock data restoration retains data-old for crash recovery and reports both failures", async () => {
  const f = await fixture(); await f.start();
  const transaction = f.db.$transaction.bind(f.db);
  f.db.$transaction = ((work: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(tx => work(beforeActivation(tx, async () => { throw new Error("synthetic activation failure"); })))) as typeof f.db.$transaction;
  const rename = filesystem.rename;
  const broken = spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (String(from).includes("/data-old/")) throw new Error("synthetic recovery failure");
    return rename(from, to);
  });
  try {
    await expect(migrateData(f.context, f.prepared, "activate")).rejects.toBeInstanceOf(AggregateError);
    expect(await readFile(join(f.context.platform, "data-old", f.module.id, "state"), "utf8")).toBe("original");
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "migrating", activeHash: "old" });
  } finally { broken.mockRestore(); }
  await recoverMigrations(f.context, new Date(f.now.getTime() + 16 * 60_000));
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("original");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: "old" });
});
test("post-commit cleanup failure retains old data without undoing committed activation", async () => {
  const f = await fixture(); await f.start();
  const remove = filesystem.rm; let removals = 0;
  const broken = spyOn(filesystem, "rm").mockImplementation(async (path, options) => {
    if (String(path).includes("/data-old/") && ++removals === 2) throw new Error("synthetic cleanup failure");
    return remove(path, options);
  });
  try {
    await expect(migrateData(f.context, f.prepared, "activate")).rejects.toThrow("synthetic cleanup failure");
    expect(await readFile(join(f.context.platform, "data-old", f.module.id, "state"), "utf8")).toBe("original");
    expect(await readFile(join(f.live, "state"), "utf8")).toBe("migrated");
    expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: "next", dataSchema: 2 });
  } finally { broken.mockRestore(); }
});
