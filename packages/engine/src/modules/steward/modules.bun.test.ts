import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService } from "./service";
import { createModules } from "./modules";
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
  const propose = () => service.modules.propose({ affairId: affair.id, dir: "price-watch", intent }, "provider");
  const approve = (id: string) => service.approvals.resolve(id, { decision: "approve", scope: "once" });
  return { db, dataDir, workspace, ports, service, affair, root, dir, calls, forwarded, write, propose, approve, fail: () => { fail = true; } };
}

test("proposal tests a private snapshot and creates a hash-bound plain-text approval", async () => {
  const f = await fixture(), result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.moduleId).toBeString();
  expect(result.report).toEqual([{ stdout: "public stdout", stderr: "", exitCode: 0 }]);
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
  expect(result.report).toEqual([{ stdout: "public stdout", stderr: "public stderr", exitCode: 1 }]);
  expect(await f.db.approval.count()).toBe(0);
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
  expect(result.report).toHaveLength(2);
});

test("invalid manifests reject without inventing a module identity or leaking parser diagnostics", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "module.json"), "invalid JSON");
  expect(await f.propose()).toMatchObject({ status: "rejected", moduleId: null, report: [] });
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
