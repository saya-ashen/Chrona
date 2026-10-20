import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService } from "./service";
import { createModules } from "./modules";
import { createTick } from "./tick";
import type { StewardPorts } from "./ports";
import type { ApprovedAction } from "./approvals";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const intent = { changes: ["Track the price"], preserves: ["Keep existing data"] };
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-modules-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "test" } });
  const calls: Parameters<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>[0][] = [];
  const forwarded: ApprovedAction[] = [];
  let fail = false;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-20T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    onApproved: async action => { forwarded.push(action); },
    sandbox: { available: true, async runModule(input) {
      calls.push(input);
      expect(input.network).toBe(false);
      expect(await readdir(input.dataDir)).toEqual([]);
      expect(await readFile(join(input.codeDir, "module.json"), "utf8")).toContain("price-watch");
      return { status: fail ? "failed" : "succeeded", output: "public stdout", error: fail ? "public stderr" : null, exitCode: fail ? 1 : 0 };
    } },
  };
  const service = createStewardService(ports).forWorkspace(workspace.id);
  const affair = await service.affairs.create({ title: "Prices" });
  const row = await db.affair.findUniqueOrThrow({ where: { id: affair.id } });
  const root = join(dataDir, "affairs", row.dirName), dir = join(root, "price-watch");
  await mkdir(dir);
  const manifest = { name: "price-watch", entry: "index.ts", triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], effects: ["notify_user"], tests: ["test.ts"] };
  async function write(value = 1) {
    await writeFile(join(dir, "module.json"), JSON.stringify({ ...manifest, params: { threshold: { type: "number", value } } }));
    await writeFile(join(dir, "index.ts"), `console.log(${value})`);
    await writeFile(join(dir, "test.ts"), "process.exit(0)");
  }
  await write();
  const submit = () => service.modules.propose({ affairId: affair.id, dir: "price-watch", intent }, "provider");
  const propose = async () => {
    const result = await submit();
    if (result.status !== "building") return result;
    await service.modules.buildPending();
    const version = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: result.moduleId!, hash: result.hash } } });
    const approval = await db.approval.findFirst({ where: { workspaceId: workspace.id, status: "open" } });
    return { ...result, status: version.status, report: version.report, approvalId: approval?.id };
  };
  const approve = (id: string) => service.approvals.resolve(id, { decision: "approve", scope: "once" });
  return { db, dataDir, workspace, ports, service, affair, root, dir, calls, forwarded, write, submit, propose, approve, fail: (value = true) => { fail = value; } };
}

test.each([true, false])("activation schedules only schedule triggers (inbound only: %s)", async only => {
  const f = await fixture(), path = join(f.dir, "module.json"), manifest = JSON.parse(await readFile(path, "utf8"));
  const inbound = { id: "mail", inbound: { connector: "mailbox", match: {} } };
  await writeFile(path, JSON.stringify({ ...manifest, triggers: only ? [inbound] : [inbound, ...manifest.triggers] }));
  const result = await f.propose();
  await f.approve(result.approvalId!);
  const schedules = await f.db.schedule.findMany({ where: { moduleId: result.moduleId! } });
  expect(schedules.map(row => ({ triggerId: row.triggerId, mode: row.mode, rule: row.rule }))).toEqual(only ? [] : [{ triggerId: "daily", mode: "module", rule: manifest.triggers[0].schedule }]);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: result.moduleId! } })).toMatchObject({ status: "active", activeHash: result.hash });
});

async function dataFixture() {
  const f = await fixture(), first = await f.propose();
  await f.approve(first.approvalId!);
  const live = join(f.dataDir, "platform/data", first.moduleId!), original = f.ports.sandbox!.runModule!;
  f.ports.sandbox!.runModule = async input => {
    await mkdir(join(input.dataDir, "nested"));
    await writeFile(join(input.dataDir, "nested/state"), Buffer.from([0, 255, 1, 2]));
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  await f.service.schedules.fireDue(new Date("2026-10-21T01:00:00Z"));
  expect((await f.db.module.findUniqueOrThrow({ where: { id: first.moduleId! } })).dataSchema).toBe(1);
  f.ports.sandbox!.runModule = original;
  await f.write(2);
  const schema = async (value: number, migrate?: string) => {
    const manifest = JSON.parse(await readFile(join(f.dir, "module.json"), "utf8"));
    await writeFile(join(f.dir, "module.json"), JSON.stringify({ ...manifest, data: { schema: value, ...(migrate ? { migrate } : {}) } }));
    if (migrate) await writeFile(join(f.dir, migrate), "migration");
  };
  return { ...f, first, live, original, schema };
}

async function rollbackFixture() {
  const f = await dataFixture();
  await f.schema(2, "migrate.ts");
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    if (input.entry === "migrate.ts") await writeFile(join(input.dataDir, "nested/state"), "schema 2");
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  const second = await f.propose(); await f.approve(second.approvalId!);
  const moduleId = f.first.moduleId!, snapshots = join(f.dataDir, "platform/snapshots", moduleId);
  return { ...f, second, moduleId, snapshots };
}

test("cross-schema rollback requests approval without changes, restores data, and can roll forward again", async () => {
  const f = await rollbackFixture();
  await writeFile(join(f.live, "nested/state"), "new writes");
  const before = await f.db.module.findFirstOrThrow(), schedules = await f.db.schedule.findMany(), generations = await f.db.generation.count();
  const request = () => f.service.modules.rollback(f.moduleId, f.first.hash);
  const older = await request(), pending = await request();
  expect(pending.status).toBe("pending_approval");
  if (pending.status !== "pending_approval" || older.status !== "pending_approval") throw new Error("Expected approval");
  expect(await f.db.approval.findUniqueOrThrow({ where: { id: older.approvalId } })).toMatchObject({ status: "expired" });
  expect(await f.db.module.findFirstOrThrow()).toEqual(before);
  expect(await f.db.schedule.findMany()).toEqual(schedules);
  expect(await f.db.generation.count()).toBe(generations);
  expect(await readFile(join(f.live, "nested/state"), "utf8")).toBe("new writes");
  expect(await readdir(f.snapshots)).toEqual(["schema-1"]);
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: pending.approvalId } });
  const at = (await stat(join(f.snapshots, "schema-1"))).mtime.toISOString();
  expect(approval.payload).toEqual({ kind: "activate_module", moduleId: f.moduleId, hash: f.first.hash, restore: { schema: 1, snapshotAt: at } });
  expect(approval.preview).toContain(`将恢复 ${at} 的数据，此后写入的数据会丢失；当前数据会另存为 before-rollback-<iso>`);
  await f.approve(pending.approvalId);
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ activeHash: f.first.hash, dataSchema: 1, status: "active" });
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
  const backup = (await readdir(f.snapshots)).find(name => name.startsWith("before-rollback-"))!;
  expect(await readFile(join(f.snapshots, backup, "nested/state"), "utf8")).toBe("new writes");
  expect(await f.db.generation.findFirstOrThrow({ orderBy: { seq: "desc" } })).toMatchObject({ reason: "rollback", modules: { [f.moduleId]: f.first.hash } });
  let migrated = false;
  f.ports.sandbox!.runModule = async input => {
    migrated = true;
    expect(input.entry).toBe("migrate.ts");
    expect(input.codeDir).toBe(join(f.dataDir, "platform/store", f.second.hash));
    expect(input.input).toMatchObject({ migrate: { from: 1, to: 2 } });
    expect((await f.db.module.findFirstOrThrow()).status).toBe("migrating");
    await writeFile(join(input.dataDir, "nested/state"), "forward again");
    return { status: "succeeded", exitCode: 0, output: "migrated", error: null };
  };
  expect(await f.service.modules.rollback(f.moduleId, f.second.hash)).toMatchObject({ status: "active" });
  expect(migrated).toBe(true);
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ activeHash: f.second.hash, dataSchema: 2, status: "active" });
  expect(await readFile(join(f.live, "nested/state"), "utf8")).toBe("forward again");
  expect(await f.db.generation.findFirstOrThrow({ orderBy: { seq: "desc" } })).toMatchObject({ reason: "rollback" });
});

test("snapshot restore retains only the newest three before-rollback backups", async () => {
  const f = await rollbackFixture();
  for (let i = 0; i < 5; i++) {
    await writeFile(join(f.live, "nested/state"), `writes ${i}`);
    const result = await f.service.modules.rollback(f.moduleId, f.first.hash);
    if (result.status !== "pending_approval") throw new Error("Expected approval");
    await f.approve(result.approvalId);
    const backups = (await readdir(f.snapshots)).filter(name => name.startsWith("before-rollback-")).sort();
    expect(backups).toHaveLength(Math.min(i + 1, 3));
    for (let j = 0; j < backups.length; j++) expect(await readFile(join(f.snapshots, backups[j]!, "nested/state"), "utf8")).toBe(`writes ${i - backups.length + 1 + j}`);
    await f.service.modules.rollback(f.moduleId, f.second.hash);
  }
});

test.each(["no snapshot", "migrating", "missing snapshot", "changed snapshot", "schema", "shape", "pending version", "copy failure", "forward failure"])('rollback fails safely: %s', async kind => {
  const f = await rollbackFixture();
  if (kind === "no snapshot") await rm(join(f.snapshots, "schema-1"), { recursive: true });
  if (kind === "migrating") await f.db.module.update({ where: { id: f.moduleId }, data: { status: "migrating" } });
  const before = await f.db.module.findFirstOrThrow(), schedules = await f.db.schedule.findMany(), generations = await f.db.generation.count();
  if (kind === "no snapshot" || kind === "migrating") {
    await expect(f.service.modules.rollback(f.moduleId, f.first.hash)).rejects.toThrow(kind === "no snapshot" ? "没有 schema 1 的数据快照，无法回滚到该版本" : "Module is migrating");
  } else {
    const result = await f.service.modules.rollback(f.moduleId, f.first.hash);
    if (result.status !== "pending_approval") throw new Error("Expected approval");
    if (kind === "missing snapshot") await rm(join(f.snapshots, "schema-1"), { recursive: true });
    if (["schema", "shape", "changed snapshot"].includes(kind)) {
      const row = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId } });
      const payload = row.payload as { kind: string; moduleId: string; hash: string; restore: { schema: number; snapshotAt: string } };
      if (kind === "schema") payload.restore.schema = 3;
      if (kind === "shape") (payload.restore as unknown as { schema: string }).schema = "1";
      if (kind === "changed snapshot") payload.restore.snapshotAt = "2000-01-01T00:00:00Z";
      await f.db.approval.update({ where: { id: row.id }, data: { payload } });
    }
    if (kind === "pending version") await f.db.moduleVersion.updateMany({ where: { moduleId: f.moduleId, hash: f.first.hash }, data: { status: "pending_review" } });
    if (kind === "copy failure") await symlink(join(f.snapshots, "schema-1/nested/state"), join(f.snapshots, "schema-1/nested/link"));
    if (["copy failure", "forward failure"].includes(kind)) {
      await f.approve(result.approvalId);
      if (kind === "forward failure") {
        const restored = await f.db.module.findFirstOrThrow(), restoredSchedules = await f.db.schedule.findMany(), restoredGenerations = await f.db.generation.count();
        f.ports.sandbox!.runModule = async input => { await writeFile(join(input.dataDir, "nested/state"), "partial"); return { status: "failed", exitCode: 1, output: "public failure", error: null }; };
        await expect(f.service.modules.rollback(f.moduleId, f.second.hash)).rejects.toThrow("数据迁移失败");
        expect(await f.db.module.findFirstOrThrow()).toEqual(restored);
        expect(await f.db.schedule.findMany()).toEqual(restoredSchedules);
        expect(await f.db.generation.count()).toBe(restoredGenerations);
        expect(await f.db.moduleVersion.findFirstOrThrow({ where: { hash: f.second.hash } })).toMatchObject({ status: "approved" });
        expect(await f.db.notification.count()).toBe(0);
        expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
        return;
      }
      expect(await f.db.notification.findFirstOrThrow()).toMatchObject({ level: "now", title: "模块 price-watch 回滚未完成：数据恢复失败" });
    } else await expect(f.approve(result.approvalId)).rejects.toThrow();
  }
  expect(await f.db.module.findFirstOrThrow()).toEqual(before);
  expect(await f.db.schedule.findMany()).toEqual(schedules);
  expect(await f.db.generation.count()).toBe(generations);
  expect(await readFile(join(f.live, "nested/state"), "utf8")).toBe("schema 2");
});

test.each(["empty", "missing", "same schema"])('rollback switches directly with %s data', async kind => {
  const f = await rollbackFixture();
  if (kind !== "same schema") { await rm(f.live, { recursive: true }); if (kind === "empty") await mkdir(f.live); }
  const hash = kind === "same schema" ? f.second.hash : f.first.hash;
  const count = await f.db.approval.count();
  expect(await f.service.modules.rollback(f.moduleId, hash)).toMatchObject({ status: "active", activeHash: hash });
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ dataSchema: kind === "same schema" ? 2 : 1, activeHash: hash });
  expect(await f.db.approval.count()).toBe(count);
  expect(await f.db.generation.findFirstOrThrow({ orderBy: { seq: "desc" } })).toMatchObject({ reason: "rollback" });
});

test("activation snapshots and migrates current data, then the next firing reads schema 2", async () => {
  const f = await dataFixture();
  await f.schema(2, "migrate.ts");
  let migrations = 0, liveReads = 0;
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    if (input.entry === "migrate.ts") {
      migrations++;
      expect(input).toMatchObject({ network: false, timeoutMs: 60_000, maxOutputBytes: 64 * 1024, input: { migrate: { from: 1, to: 2 }, now: f.ports.now().toISOString() } });
      expect(input.dataDir).not.toBe(f.live);
      if (migrations === 3) expect((await f.db.module.findFirstOrThrow()).status).toBe("migrating");
      await writeFile(join(input.dataDir, "nested/state"), "schema 2");
      return { status: "succeeded", exitCode: 0, output: "public migration", error: null };
    }
    if (input.codeDir !== join(f.dataDir, "platform/store", f.first.hash)) expect(await readFile(join(input.dataDir, "nested/state"), "utf8")).toBe("schema 2");
    if (input.dataDir === f.live) liveReads++;
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  const result = await f.propose();
  expect(migrations).toBe(2);
  // Approval must snapshot current data, not the build-time copy, and replace the previous snapshot.
  await writeFile(join(f.live, "nested/state"), "changed after build");
  const snapshot = join(f.dataDir, "platform/snapshots", f.first.moduleId!, "schema-1");
  await mkdir(snapshot, { recursive: true }); await writeFile(join(snapshot, "stale"), "old snapshot");
  await f.approve(result.approvalId!);
  expect(migrations).toBe(3);
  expect(await readFile(join(snapshot, "nested/state"), "utf8")).toBe("changed after build");
  expect(await readdir(snapshot)).toEqual(["nested"]);
  expect(await readFile(join(f.live, "nested/state"), "utf8")).toBe("schema 2");
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ dataSchema: 2, activeHash: result.hash, status: "active" });
  expect(await f.db.audit.findFirst({ where: { kind: "module_migration_started" } })).toMatchObject({ details: { hash: result.hash, from: 1, to: 2 } });
  await f.service.schedules.fireDue(new Date("2026-10-22T01:00:00Z"));
  expect(liveReads).toBe(1);
  expect((await f.db.moduleRun.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).error).toBeNull();
  await expect(stat(join(f.dataDir, "platform/data-old", f.first.moduleId!))).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["empty", "missing"])("activation with %s data records schema without migrate", async kind => {
  const f = await dataFixture();
  await f.schema(2);
  await rm(f.live, { recursive: true });
  if (kind === "empty") await mkdir(f.live);
  const result = await f.propose();
  await f.approve(result.approvalId!);
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ activeHash: result.hash, dataSchema: 2, status: "active" });
  expect(f.calls.map(call => call.entry)).toEqual(["test.ts", "test.ts", ...Array<string>(20).fill("index.ts")]);
  expect(await f.db.audit.count({ where: { kind: "module_migration_started" } })).toBe(0);
});

test.each(["failed", "timeout", "unavailable", "throw", "output", "bytes", "symlink"])("activation migration failure preserves old data and schedules: %s", async kind => {
  const f = await dataFixture();
  await f.schema(2, "migrate.ts");
  let activation = false;
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    if (input.entry === "migrate.ts") {
      await writeFile(join(input.dataDir, "nested/state"), "migrated copy");
      if (activation && kind === "throw") throw new Error("private host diagnostic");
      return { status: activation && kind === "failed" ? "failed" : activation && kind === "timeout" ? "timed_out" : "succeeded", exitCode: activation && kind === "failed" ? 1 : 0, output: activation && kind === "output" ? "x".repeat(64 * 1024 + 1) : "public migration output", error: activation ? "public migration stderr" : null };
    }
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  const result = await f.propose();
  const schedules = await f.db.schedule.findMany(), generations = await f.db.generation.count();
  await writeFile(join(f.live, "nested/state"), "changed after build");
  if (kind === "bytes") { await writeFile(join(f.live, "large"), ""); await truncate(join(f.live, "large"), 50 * 1024 * 1024 + 1); }
  if (kind === "symlink") await symlink(join(f.live, "nested/state"), join(f.live, "link"));
  if (kind === "unavailable") f.ports.sandbox!.available = false;
  activation = true;
  await f.approve(result.approvalId!);
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ activeHash: f.first.hash, dataSchema: 1, status: "active" });
  expect(await f.db.schedule.findMany()).toEqual(schedules);
  expect(await f.db.generation.count()).toBe(generations);
  expect(await readFile(join(f.live, "nested/state"), "utf8")).toBe("changed after build");
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.first.moduleId!, hash: result.hash } } });
  expect(version.status).toBe("rejected");
  expect(JSON.stringify(version.report)).not.toContain("private host diagnostic");
  if (["failed", "timeout", "output"].includes(kind)) expect(version.report).toMatchObject({ migration: { stdout: expect.stringContaining(""), stderr: "public migration stderr" } });
  expect(await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } })).toMatchObject({ status: "approved" });
  expect(await f.db.notification.findFirstOrThrow()).toMatchObject({ level: "now", title: "模块 price-watch 新版本未启用：数据迁移失败", idempotencyKey: `module-migration-failed:${version.id}` });
  await expect(stat(join(f.dataDir, "platform/data-next", f.first.moduleId!))).rejects.toMatchObject({ code: "ENOENT" });
  f.ports.sandbox!.available = true;
  let oldRan = false;
  f.ports.sandbox!.runModule = async input => {
    oldRan = true;
    expect(input.codeDir).toBe(join(f.dataDir, "platform/store", f.first.hash));
    expect(await readFile(join(input.dataDir, "nested/state"), "utf8")).toBe("changed after build");
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  await f.service.schedules.fireDue(new Date("2026-10-22T01:00:00Z"));
  expect(oldRan).toBe(true);
});

test.each(["live", "rename-back", "swapped", "recent"])("tick skips migrating modules and recovers stale migrations: %s", async kind => {
  const f = await dataFixture(), moduleId = f.first.moduleId!;
  const now = new Date("2026-10-22T01:00:00Z"), next = join(f.dataDir, "platform/data-next", moduleId), old = join(f.dataDir, "platform/data-old", moduleId);
  await f.db.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
  const record = (minutes: number) => f.db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash: "new", from: 1, to: 2 }, createdAt: new Date(now.getTime() - minutes * 60_000) } });
  await record(30); if (kind === "recent") await record(14);
  await mkdir(next, { recursive: true }); await writeFile(join(next, "partial"), "incomplete");
  if (kind === "rename-back" || kind === "swapped") { await mkdir(join(f.dataDir, "platform/data-old"), { recursive: true }); await rename(f.live, old); }
  // Crash after the swap but before the activation commit: live holds uncommitted migrated data.
  if (kind === "swapped") { await mkdir(f.live); await writeFile(join(f.live, "migrated"), "v2"); }
  let ran = false;
  f.ports.sandbox!.runModule = async input => {
    ran = true;
    expect(await readFile(join(input.dataDir, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  await f.service.schedules.fireDue(now);
  expect(ran).toBe(false);
  expect(await f.db.moduleRun.count()).toBe(1);
  const tick = createTick(f.ports);
  expect(await tick(now)).toEqual({ failures: [] }); await tick.settled();
  expect(await f.db.module.findFirstOrThrow()).toMatchObject({ status: kind === "recent" ? "migrating" : "active", activeHash: f.first.hash, dataSchema: 1 });
  if (kind === "recent") expect(await readdir(next)).toEqual(["partial"]);
  else {
    await expect(stat(next)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
    await expect(stat(join(f.live, "migrated"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(old)).rejects.toMatchObject({ code: "ENOENT" });
    await f.service.schedules.fireDue(new Date("2026-10-23T01:00:00Z"));
    expect(ran).toBe(true);
  }
});

test("same-schema continuity runs on a disposable copy, previews effects and never executes them", async () => {
  const f = await dataFixture(), effects = [
    { type: "notify_user", key: "copy", level: "now", title: "Would notify", body: "Only a preview" },
    { type: "wake_provider", key: "copy", prompt: "Must not run" },
  ];
  let copy = "";
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    copy = input.dataDir;
    expect(copy).not.toBe(f.live);
    expect(input).toMatchObject({ entry: "index.ts", network: false, timeoutMs: 60_000, maxOutputBytes: 64 * 1024, input: { trigger: { id: "daily", kind: "schedule", firedAt: f.ports.now().toISOString() }, now: f.ports.now().toISOString(), params: { threshold: 2 } } });
    expect(await readFile(join(copy, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
    await writeFile(join(copy, "nested/state"), "new state");
    return { status: "succeeded", exitCode: 0, output: JSON.stringify({ effects }), error: null };
  };
  const result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.report).toMatchObject({ continuity: { status: "passed", fromSchema: 1, toSchema: 1, migrated: false, effects } });
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
  await expect(stat(copy)).rejects.toMatchObject({ code: "ENOENT" });
  const { preview } = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } });
  expect(preview).toContain("数据 schema：1 → 1；无需迁移");
  expect(preview).toContain("连续性：passed");
  expect(preview).toContain("按当前数据新版本会产生的 effects");
  expect(preview).toContain("Would notify");
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.notification.count()).toBe(0);
  expect(await f.db.moduleRun.count()).toBe(1);
});

test.each(["crash", "json", "shape", "throw"])("continuity %s rejects and wakes provider with public output only", async kind => {
  const f = await dataFixture();
  let copy = "";
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    copy = input.dataDir;
    await writeFile(join(copy, "nested/state"), "changed");
    if (kind === "throw") throw new Error("private host diagnostic");
    return { status: kind === "crash" ? "failed" : "succeeded", exitCode: kind === "crash" ? 1 : 0, output: kind === "shape" ? '{"effects":[{"type":"invalid"}]}' : "public continuity output", error: kind === "crash" ? "public continuity stderr" : null };
  };
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(result.report).toMatchObject({ continuity: { status: "failed", migrated: false } });
  expect(JSON.stringify(result.report)).not.toContain("private host diagnostic");
  expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
  const run = await f.db.run.findFirstOrThrow();
  expect(run.prompt).toContain("build failed (untrusted test output)");
  expect(run.prompt).toContain('"status":"failed"');
  if (kind !== "throw") expect(run.prompt).toContain(kind === "shape" ? "invalid" : "public continuity output");
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
  await expect(stat(copy)).rejects.toMatchObject({ code: "ENOENT" });
});

test.each([false, true])("schema upgrade migrates only the copy; migration failure=%s", async failed => {
  const f = await dataFixture();
  await f.schema(2, "migrate.py");
  let copy = "", entryRan = false;
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return f.original(input);
    expect(input.network).toBe(false);
    expect(input.timeoutMs).toBe(60_000);
    expect(input.maxOutputBytes).toBe(64 * 1024);
    if (input.entry === "migrate.py") {
      copy = input.dataDir;
      expect(input.input).toEqual({ migrate: { from: 1, to: 2 }, now: f.ports.now().toISOString() });
      expect(copy).not.toBe(f.live);
      await writeFile(join(copy, "nested/state"), "schema 2");
      return { status: failed ? "failed" : "succeeded", exitCode: failed ? 1 : 0, output: "public migration output", error: failed ? "public migration stderr" : null };
    }
    entryRan = true;
    expect(input.dataDir).toBe(copy);
    expect(await readFile(join(copy, "nested/state"), "utf8")).toBe("schema 2");
    return { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  };
  const result = await f.propose();
  expect(result.status).toBe(failed ? "rejected" : "pending_review");
  expect(entryRan).toBe(!failed);
  expect(result.report).toMatchObject({ continuity: { status: failed ? "failed" : "passed", fromSchema: 1, toSchema: 2, migrated: !failed, migration: { stdout: "public migration output", exitCode: failed ? 1 : 0 } } });
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
  expect((await f.db.module.findFirstOrThrow()).dataSchema).toBe(1);
  await expect(stat(copy)).rejects.toMatchObject({ code: "ENOENT" });
  if (failed) expect((await f.db.run.findFirstOrThrow()).prompt).toContain("public migration stderr");
  else expect((await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } })).preview).toContain("1 → 2；需要迁移");
});

test.each(["nonempty", "empty", "missing", "unknown schema"])("schema upgrade without migrate: %s", async kind => {
  const f = await dataFixture();
  await f.schema(2);
  if (kind === "empty" || kind === "missing") await rm(f.live, { recursive: true });
  if (kind === "empty") await mkdir(f.live);
  if (kind === "unknown schema") {
    await f.db.module.update({ where: { id: f.first.moduleId! }, data: { dataSchema: null } });
    f.ports.sandbox!.runModule = async input => input.entry === "test.ts" ? f.original(input) : { status: "succeeded", exitCode: 0, output: '{"effects":[]}', error: null };
  }
  const result = await f.propose();
  expect(result.status).toBe(kind === "nonempty" ? "rejected" : "pending_review");
  expect(result.report).toMatchObject({ continuity: { status: kind === "nonempty" ? "failed" : kind === "unknown schema" ? "passed" : "skipped", migrated: false, toSchema: 2, ...(kind === "nonempty" ? { reason: "schema 升级需要 migrate" } : {}) } });
  if (kind === "nonempty") expect((await f.db.run.findFirstOrThrow()).prompt).toContain("schema 升级需要 migrate");
});

test.each([false, true])("schema downgrade rejects even with empty data=%s", async empty => {
  const f = await dataFixture();
  await f.db.module.update({ where: { id: f.first.moduleId! }, data: { dataSchema: 2 } });
  if (empty) await rm(f.live, { recursive: true });
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(result.report).toMatchObject({ continuity: { status: "failed", reason: "schema 不能降低；降级只能经回滚", fromSchema: 2, toSchema: 1 } });
  expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
});

test.each(["bytes", "files"])("oversized live data skips continuity visibly: %s", async kind => {
  const f = await dataFixture();
  if (kind === "bytes") {
    await writeFile(join(f.live, "large"), "");
    await truncate(join(f.live, "large"), 50 * 1024 * 1024 + 1);
  } else for (let i = 0; i < 5000; i++) await writeFile(join(f.live, `file-${i}`), "");
  const result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.report).toMatchObject({ continuity: { status: "skipped", reason: "data too large", migrated: false } });
  expect(f.calls).toHaveLength(2);
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } })).preview).toContain("skipped (data too large)");
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
});

test.each(["file", "directory", "root"])("continuity refuses live data symlink: %s", async kind => {
  const f = await dataFixture();
  if (kind === "root") { await rename(f.live, `${f.live}-actual`); await symlink(`${f.live}-actual`, f.live); }
  else await symlink(join(f.live, kind === "file" ? "nested/state" : "nested"), join(f.live, "linked"));
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(result.report).toMatchObject({ continuity: { status: "failed" } });
  expect(f.calls).toHaveLength(2);
  expect(await readFile(join(f.live, "nested/state"))).toEqual(Buffer.from([0, 255, 1, 2]));
});

test("test, continuity and schema failures share the same streak and budgeted digest", async () => {
  const f = await dataFixture();
  f.fail();
  expect((await f.propose()).status).toBe("rejected");
  f.fail(false);
  await f.write(3);
  f.ports.sandbox!.runModule = async input => {
    if (input.entry === "test.ts") return { status: "succeeded", exitCode: 0, output: "x".repeat(64 * 1024), error: null };
    return { status: "failed", exitCode: 1, output: "public failure after verbose tests", error: null };
  };
  expect((await f.propose()).status).toBe("rejected");
  const runs = await f.db.run.findMany({ orderBy: { createdAt: "desc" } });
  expect(runs).toHaveLength(2);
  expect(runs.some(run => run.prompt?.includes("public failure after verbose tests"))).toBe(true);
  for (let i = 4; i <= 5; i++) {
    await f.write(i); await f.schema(2);
    expect((await f.propose()).status).toBe("rejected");
  }
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(1);
});

test("large effects preview is explicitly truncated without hiding schema, intent or hash", async () => {
  const f = await dataFixture();
  const effects = Array.from({ length: 3 }, (_, i) => ({ type: "wake_provider", key: `key-${i}`, prompt: "x".repeat(4000) }));
  f.ports.sandbox!.runModule = async input => input.entry === "test.ts" ? f.original(input) : { status: "succeeded", exitCode: 0, output: JSON.stringify({ effects }), error: null };
  const result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.report).toMatchObject({ continuity: { effects } });
  const { preview } = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } });
  expect(preview.length).toBeLessThanOrEqual(20_000);
  expect(preview).toContain("…effects 过长，已截断");
  expect(preview).toContain("数据 schema：1 → 1");
  expect(preview).toContain(JSON.stringify(intent));
  expect(preview).toContain(result.hash);
  expect(await f.db.run.count()).toBe(0);
});

test.each(["migrate.ts", "migrate.py", "migrate.sh"])("declared %s must exist before a proposal is queued", async migrate => {
  const f = await fixture();
  const manifest = JSON.parse(await readFile(join(f.dir, "module.json"), "utf8"));
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ ...manifest, data: { schema: 2, migrate } }));
  expect((await f.submit()).status).toBe("rejected");
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
  expect(f.calls).toHaveLength(0);
  await writeFile(join(f.dir, migrate), "");
  expect((await f.propose()).status).toBe("pending_review");
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.entry).toBe("test.ts");
});

test("proposal returns building without sandbox work; identical in-flight hashes reuse the version and snapshot", async () => {
  const f = await fixture();
  const first = await f.submit();
  expect(first.status).toBe("building");
  expect(f.calls).toHaveLength(0);
  expect(await f.db.approval.count()).toBe(0);
  const version = await f.db.moduleVersion.findFirstOrThrow();
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([version.id]);
  expect(await f.submit()).toMatchObject({ moduleId: first.moduleId, hash: first.hash, status: "building" });
  expect(await f.db.moduleVersion.count()).toBe(1);
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([version.id]);
  await f.write(99);
  await f.service.modules.buildPending();
  expect(f.calls).toHaveLength(1);
  expect(await readFile(join(f.dataDir, "platform/store", first.hash, "index.ts"), "utf8")).toBe("console.log(1)");
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ status: "pending_review" });
  expect(await f.db.approval.count()).toBe(1);
  // Returning a pending hash must not run tests or create another approval.
  await f.write();
  expect((await f.submit()).status).toBe("pending_review");
  expect(f.calls).toHaveLength(1);
  expect(await f.db.approval.count()).toBe(1);
});

test("concurrent builders atomically claim once and testing re-proposals do not duplicate", async () => {
  const f = await fixture();
  await f.submit();
  const original = f.ports.sandbox!.runModule!;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  f.ports.sandbox!.runModule = async input => { started(); await gate; return original(input); };
  const first = f.service.modules.buildPending();
  await entered;
  try {
    await f.service.modules.buildPending();
    expect((await f.submit()).status).toBe("testing");
    expect(await f.db.moduleVersion.count()).toBe(1);
  } finally { release(); await first; }
  expect(f.calls).toHaveLength(1);
  expect(await f.db.approval.count()).toBe(1);
});

test("stale testing is retried, while a recent claim is left alone", async () => {
  const f = await fixture();
  await f.submit();
  const version = await f.db.moduleVersion.findFirstOrThrow();
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { status: "testing", createdAt: new Date(f.ports.now().getTime() - 20 * 60_000) } });
  await f.db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "chrona", kind: "module_build_started", subjectId: version.id, details: {}, createdAt: f.ports.now() } });
  await f.service.modules.buildPending();
  expect(f.calls).toHaveLength(0);
  await f.service.modules.buildPending(new Date(f.ports.now().getTime() + 16 * 60_000));
  expect(f.calls).toHaveLength(1);
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ status: "pending_review" });
});

test("missing staging is rejected clearly, cleaned, and reported to the provider", async () => {
  const f = await fixture();
  await f.submit();
  const version = await f.db.moduleVersion.findFirstOrThrow();
  await rm(join(f.dataDir, "platform/staging", version.id), { recursive: true });
  await f.service.modules.buildPending();
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ status: "rejected", report: { tests: [{ stderr: "Module staging files are missing; build interrupted. Submit the module again.", exitCode: 1 }] } });
  expect(await f.db.run.count()).toBe(1);
  expect(f.calls).toHaveLength(0);
});

test("three consecutive rejected versions stop waking and enqueue only one budgeted digest per streak", async () => {
  const f = await fixture(); f.fail();
  for (let i = 1; i <= 4; i++) {
    f.ports.now = () => new Date(Date.UTC(2026, 9, 20, 4, i));
    await f.write(i);
    await f.propose();
    expect(await f.db.run.count()).toBe(Math.min(i, 2));
    expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(i >= 3 ? 1 : 0);
  }
});

test("a successful build resets the failure streak even when the clock has not advanced", async () => {
  const f = await fixture();
  await f.propose();
  f.fail();
  for (let i = 2; i <= 4; i++) { await f.write(i); await f.propose(); }
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(1);
  f.fail(false);
  await f.write(5); await f.propose();
  f.fail();
  for (let i = 6; i <= 8; i++) { await f.write(i); await f.propose(); }
  expect(await f.db.run.count()).toBe(4);
  expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(2);
});

test("queued failures sharing a timestamp still stop at two wakes and one digest", async () => {
  const f = await fixture(); f.fail();
  for (let i = 1; i <= 4; i++) { await f.write(i); await f.submit(); }
  await f.service.modules.buildPending();
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(1);
  await f.service.modules.buildPending();
  expect(await f.db.run.count()).toBe(2);
  expect(await f.db.notification.count({ where: { level: "digest" } })).toBe(1);
});

test("user proposals do not wake a provider and rejected hashes can be resubmitted", async () => {
  const f = await fixture(); f.fail();
  const first = await f.service.modules.propose({ affairId: f.affair.id, dir: "price-watch", intent }, "user");
  await f.service.modules.buildPending();
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ status: "rejected" });
  expect(await f.submit()).toMatchObject({ hash: first.hash, status: "building" });
  const version = await f.db.moduleVersion.findFirstOrThrow();
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([version.id]);
  await f.service.modules.buildPending();
  expect(await f.db.run.count()).toBe(1);
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("each workspace build call processes at most three versions and never foreign versions", async () => {
  const f = await fixture();
  for (let i = 1; i <= 4; i++) { await f.write(i); await f.submit(); }
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await createModules(f.ports, other.id).buildPending();
  expect(f.calls).toHaveLength(0);
  await f.service.modules.buildPending();
  expect(f.calls).toHaveLength(3);
  expect(await f.db.moduleVersion.count({ where: { status: "building" } })).toBe(1);
  await f.service.modules.buildPending();
  expect(f.calls).toHaveLength(4);
});

test("proposal tests a private snapshot and creates a hash-bound plain-text approval", async () => {
  const f = await fixture(), result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.moduleId).toBeString();
  expect(result.report).toEqual({ tests: [{ stdout: "public stdout", stderr: "", exitCode: 0 }], replay: { status: "skipped", reason: "first version", steps: 0, diffs: [] }, continuity: { status: "skipped", reason: "no data", fromSchema: null, toSchema: 1, migrated: false } });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.timeoutMs).toBe(60_000);
  expect(f.calls[0]!.maxOutputBytes).toBe(64 * 1024);
  expect(f.calls[0]!.codeDir).toContain("/platform/staging/");
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([]);
  const approval = (await f.service.approvals.list())[0]!;
  expect(approval.preview.startsWith("联网：否\n")).toBe(true);
  expect(approval.preview).toContain(result.hash);
  expect(approval.preview).toContain("Track the price");
  expect(approval.preview).toContain("+++ proposed");
  const raw = await f.db.approval.findUniqueOrThrow({ where: { id: result.approvalId! } });
  expect(raw.payload).toEqual({ kind: "activate_module", moduleId: result.moduleId, hash: result.hash });
  expect(await f.db.schedule.count()).toBe(0);
  expect((await f.service.modules.list())[0]!.activeHash).toBeNull();
});

test("approval switches schedules atomically, proposals keep old schedules, rollback records full generations", async () => {
  const f = await fixture(), first = await f.propose();
  await f.approve(first.approvalId!);
  const old = await f.db.schedule.findFirstOrThrow({ where: { status: "active" } });
  expect(old).toMatchObject({ mode: "module", moduleId: first.moduleId, triggerId: "daily", text: "price-watch:daily", label: "price-watch", createdBy: "chrona" });
  expect(old.nextAt?.toISOString()).toBe("2026-10-21T01:00:00.000Z");
  await f.write(2);
  const second = await f.propose();
  expect(second.hash).not.toBe(first.hash);
  expect((await f.service.modules.list())[0]!.activeHash).toBe(first.hash);
  expect(await f.db.schedule.findMany({ where: { status: "active" } })).toEqual([old]);
  await expect(f.service.modules.rollback(first.moduleId!, second.hash)).rejects.toThrow("not approved");
  await f.approve(second.approvalId!);
  expect((await f.service.modules.list())[0]!.activeHash).toBe(second.hash);
  expect((await f.db.schedule.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("cancelled");
  await f.service.modules.rollback(first.moduleId!, first.hash);
  expect(await f.db.schedule.count({ where: { status: "active" } })).toBe(1);
  const generations = await f.db.generation.findMany({ orderBy: { seq: "asc" } });
  expect(generations.map(row => [row.seq, row.reason, row.modules])).toEqual([
    [1, "activate", { [first.moduleId!]: first.hash }], [2, "activate", { [first.moduleId!]: second.hash }], [3, "rollback", { [first.moduleId!]: first.hash }],
  ]);
  expect(f.forwarded).toEqual([]);
  expect(await f.db.grant.count({ where: { action: "activate_module", once: true, consumedAt: { not: null } } })).toBe(2);
  expect(await f.db.audit.count({ where: { kind: "module_rollback" } })).toBe(1);
});

test.each(["paused", "cancelled", "active"] as const)("module schedule rejects direct status update to %s", async status => {
  const f = await fixture(), first = await f.propose();
  await f.approve(first.approvalId!);
  const old = await f.db.schedule.findFirstOrThrow({ where: { status: "active" } });
  await expect(f.service.schedules.update(old.id, { status })).rejects.toMatchObject({ code: "conflict", message: "Module schedules change only through module activation or rollback; the active version keeps running until a new version is approved" });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: old.id } })).toEqual(old);
  expect((await f.service.modules.list())[0]!.activeHash).toBe(first.hash);
});

test("code-only proposals preview sorted added, removed and changed files and name unchanged files", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "removed.ts"), "old helper");
  const first = await f.propose(); await f.approve(first.approvalId!);
  await rm(join(f.dir, "removed.ts"));
  await writeFile(join(f.dir, "added.ts"), "new helper");
  await writeFile(join(f.dir, "index.ts"), "console.log(2)");
  const second = await f.propose();
  const { preview } = await f.db.approval.findUniqueOrThrow({ where: { id: second.approvalId! } });
  expect(preview).toContain("=== added.ts (added) ===\n+ new helper");
  expect(preview).toContain("=== index.ts (changed) ===\n- console.log(1)\n+ console.log(2)");
  expect(preview).toContain("=== removed.ts (removed) ===\n- old helper");
  expect(preview.indexOf("=== added.ts")).toBeLessThan(preview.indexOf("=== index.ts"));
  expect(preview.indexOf("=== index.ts")).toBeLessThan(preview.indexOf("=== removed.ts"));
  expect(preview).toContain("未变化:\nmodule.json\ntest.ts");
  expect(preview).not.toContain("=== module.json");
});

test("huge code diff truncates with checkout hash while manifest and intent stay complete", async () => {
  const f = await fixture(), first = await f.propose(); await f.approve(first.approvalId!);
  await writeFile(join(f.dir, "index.ts"), "new line\n".repeat(20_000));
  const second = await f.propose();
  expect(second.status).toBe("pending_review");
  const { preview } = await f.db.approval.findUniqueOrThrow({ where: { id: second.approvalId! } });
  expect(preview.length).toBeLessThanOrEqual(20_000);
  expect(preview).toContain("=== index.ts (changed) ===");
  expect(preview).toContain(`意图：${JSON.stringify(intent)}`);
  const manifest = (await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: first.moduleId!, hash: first.hash } } })).manifest;
  for (const line of JSON.stringify(manifest, null, 2).split("\n")) {
    expect(preview).toContain(`- ${line}`); expect(preview).toContain(`+ ${line}`);
  }
  expect(preview.endsWith(`…代码差异过长，已截断；完整代码可用 chrona_module_checkout 检出 hash ${second.hash}`)).toBe(true);
});

test("hash follows sorted path-NUL-content-NUL; identical content reuses approved version without approval", async () => {
  const f = await fixture(), first = await f.propose();
  const digest = createHash("sha256");
  for (const path of ["index.ts", "module.json", "test.ts"]) digest.update(path).update("\0").update(await readFile(join(f.dir, path))).update("\0");
  expect(first.hash).toBe(digest.digest("hex"));
  await f.approve(first.approvalId!);
  const second = await f.propose();
  expect(second).toMatchObject({ moduleId: first.moduleId, hash: first.hash, status: "approved" });
  expect(second.approvalId).toBeUndefined();
  expect(await f.db.approval.count()).toBe(1);
  expect(await f.db.moduleVersion.count()).toBe(1);
});

test("affair edits after propose never change store hash/content; checkout makes editable copies", async () => {
  const f = await fixture(), result = await f.propose();
  await f.write(99);
  const stored = join(f.dataDir, "platform/store", result.hash, "index.ts");
  expect(await readFile(stored, "utf8")).toBe("console.log(1)");
  expect((await stat(stored)).mode & 0o222).toBe(0);
  await f.approve(result.approvalId!);
  await f.service.modules.checkout(result.moduleId!, undefined, "checkout");
  const copy = join(f.root, "checkout/index.ts");
  expect(await readFile(copy, "utf8")).toBe("console.log(1)");
  await writeFile(copy, "edited");
  expect(await readFile(stored, "utf8")).toBe("console.log(1)");
  await expect(f.service.modules.checkout(result.moduleId!, result.hash, "checkout")).rejects.toThrow("empty");
  await expect(f.service.modules.checkout(result.moduleId!, result.hash, "../escape")).rejects.toThrow();
});

test("failing tests reject with public outputs only, no approval, staging cleaned", async () => {
  const f = await fixture(); f.fail();
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(result.report).toEqual({ tests: [{ stdout: "public stdout", stderr: "public stderr", exitCode: 1 }] });
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.run.count()).toBe(1);
  expect(await f.db.run.findFirstOrThrow()).toMatchObject({ affairId: f.affair.id, lane: "background", status: "queued", prompt: 'Module price-watch build failed (untrusted test output):\n{"tests":[{"stdout":"public stdout","stderr":"public stderr","exitCode":1}]}' });
  expect((await f.service.modules.list())[0]!.versions[0]!.status).toBe("rejected");
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([]);
});

test("new successful proposal expires older open approvals; expired approval cannot switch hash", async () => {
  const f = await fixture(), first = await f.propose();
  await f.write(2);
  const second = await f.propose();
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: first.approvalId! } })).status).toBe("expired");
  await expect(f.approve(first.approvalId!)).rejects.toThrow("already resolved");
  await f.approve(second.approvalId!);
  expect((await f.service.modules.list())[0]!.activeHash).toBe(second.hash);
});

test.each(["../escape", "/tmp", "price-watch/../price-watch", "price-watch/.git"])("reject unsafe proposal path %s", async dir => {
  const f = await fixture();
  await expect(f.service.modules.propose({ affairId: f.affair.id, dir, intent }, "provider")).rejects.toThrow();
  expect(await f.db.approval.count()).toBe(0);
});

test.each(["symlink", "git", "bytes", "files"])("reject unsafe module contents: %s", async kind => {
  const f = await fixture();
  if (kind === "symlink") await symlink(join(f.dir, "index.ts"), join(f.dir, "linked.ts"));
  if (kind === "git") await mkdir(join(f.dir, ".git"));
  if (kind === "bytes") await writeFile(join(f.dir, "big"), Buffer.alloc(1024 * 1024));
  if (kind === "files") for (let i = 0; i < 198; i++) await writeFile(join(f.dir, `extra-${i}`), "");
  await expect(f.propose()).rejects.toThrow();
  expect(await f.db.module.count()).toBe(0);
});

test.each(["activate_module", "notify_user"] as const)("never policy for %s rejects before sandbox", async action => {
  const f = await fixture();
  await f.service.grants.create({ action, mode: "never", scope: { kind: "affair", affairId: f.affair.id } });
  expect((await f.propose()).status).toBe("rejected");
  expect(f.calls).toEqual([]);
  expect(await f.db.approval.count()).toBe(0);
});

test("all tests run independently even after a failure; declared network never enables build networking", async () => {
  const f = await fixture();
  const manifest = JSON.parse(await readFile(join(f.dir, "module.json"), "utf8"));
  manifest.effects.push("network");
  manifest.tests.push("other.py");
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  await writeFile(join(f.dir, "other.py"), "exit(0)");
  f.fail();
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(f.calls).toHaveLength(2);
  expect(f.calls[0]!.dataDir).not.toBe(f.calls[1]!.dataDir);
  expect(result.report).toMatchObject({ tests: [{ exitCode: 1 }, { exitCode: 1 }] });
});

test("invalid manifests reject without inventing a module identity or leaking parser diagnostics", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "module.json"), "invalid JSON");
  expect(await f.propose()).toMatchObject({ status: "rejected", moduleId: null, report: { tests: [], errors: ["module.json: missing or not valid JSON"] } });
  // Real Pi run: a human title as name must come back as a fixable field error.
  await writeFile(join(f.dir, "module.json"), JSON.stringify({ name: "喝水提醒", entry: "index.ts", triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], effects: [], tests: ["test.ts"] }));
  expect(await f.propose()).toMatchObject({ status: "rejected", moduleId: null, report: { errors: [expect.stringMatching(/^name: /)] } });
  expect(await f.db.module.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
  expect(await readdir(join(f.dataDir, "platform/staging"))).toEqual([]);
});

test("oversized review text fails closed instead of hiding manifest changes", async () => {
  const f = await fixture();
  const manifest = JSON.parse(await readFile(join(f.dir, "module.json"), "utf8"));
  manifest.params = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field-${i}`, { type: "string", value: "x".repeat(2000) }]));
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  expect((await f.propose()).status).toBe("rejected");
  expect(await f.db.approval.count()).toBe(0);
});

test("pending versions cannot activate directly, and failed approval activation rolls back all module writes", async () => {
  const f = await fixture(), result = await f.propose();
  await expect(f.service.modules.activate(result.moduleId!, result.hash, "activate")).rejects.toThrow("not approved");
  await f.db.affair.update({ where: { id: f.affair.id }, data: { status: "paused" } });
  await expect(f.approve(result.approvalId!)).rejects.toThrow("Affair is not active");
  expect((await f.db.moduleVersion.findFirstOrThrow()).status).toBe("pending_review");
  expect((await f.db.module.findFirstOrThrow()).activeHash).toBeNull();
  expect(await f.db.generation.count()).toBe(0);
  expect(await f.db.schedule.count()).toBe(0);
  expect(await f.db.grant.count({ where: { consumedAt: { not: null } } })).toBe(0);
});

test("workspace isolation, full snapshots, last five run summaries and nonmodule approval forwarding", async () => {
  const f = await fixture(), first = await f.propose();
  const other = await f.db.workspace.create({ data: { name: "other" } });
  const foreign = createModules(f.ports, other.id);
  expect(await foreign.list()).toEqual([]);
  await expect(foreign.rollback(first.moduleId!, first.hash)).rejects.toThrow("not found");
  await expect(foreign.checkout(first.moduleId!, first.hash, "copy")).rejects.toThrow("not found");
  await expect(foreign.list(f.affair.id)).rejects.toThrow("not found");
  const pending = await f.db.module.create({ data: { workspaceId: f.workspace.id, affairId: f.affair.id, name: "another" } });
  await f.approve(first.approvalId!);
  expect((await f.db.generation.findFirstOrThrow()).modules).toEqual({ [first.moduleId!]: first.hash, [pending.id]: null });
  for (let i = 0; i < 7; i++) await f.db.moduleRun.create({ data: { moduleId: first.moduleId!, hash: first.hash, triggerId: "daily", firedAt: f.ports.now(), exitCode: 0, executed: [], createdAt: new Date(i * 1000) } });
  const listed = (await f.service.modules.list(f.affair.id)).find(row => row.id === first.moduleId)!;
  expect(listed.runs).toHaveLength(5);
  expect(listed.runs.map(row => row.createdAt.getTime())).toEqual([6000, 5000, 4000, 3000, 2000]);
  const approval = await f.service.approvals.create({ action: "send_external_message", title: "Send", detail: "Test", preview: "Draft", payload: { kind: "email", value: 1 } });
  await f.approve(approval.id);
  expect(f.forwarded).toHaveLength(1);
  expect(f.forwarded[0]!.payload).toEqual({ kind: "email", value: 1 });
});

test("tick starts builds without waiting for them and reports build errors on the next tick", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const run = f.ports.sandbox!.runModule!;
  f.ports.sandbox = { available: true, runModule: async input => { await gate; return run(input); } };
  const tick = createStewardService(f.ports).tick;
  const proposal = await f.submit();
  expect((await tick()).failures).toEqual([]);
  expect((await f.db.moduleVersion.findFirstOrThrow({ where: { hash: proposal.hash } })).status).toBe("testing");
  await tick(); // a second tick while the build runs does not start another one
  release();
  await tick.settled();
  expect((await f.db.moduleVersion.findFirstOrThrow({ where: { hash: proposal.hash } })).status).toBe("pending_review");
  expect(f.calls).toHaveLength(1);
  f.ports.sandbox = { available: true, runModule: async () => { throw new Error("sandbox crashed"); } };
  const findMany = f.db.moduleVersion.findMany.bind(f.db.moduleVersion);
  f.db.moduleVersion.findMany = (async () => { throw new Error("db down"); }) as unknown as typeof findMany;
  await tick();
  await tick.settled();
  f.db.moduleVersion.findMany = findMany;
  expect((await tick()).failures).toContainEqual({ workspaceId: f.workspace.id, stage: "modules" });
});
