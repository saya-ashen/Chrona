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
  expect(await f.db.moduleVersion.findFirstOrThrow()).toMatchObject({ status: "rejected", report: [{ stderr: "Module staging files are missing; build interrupted. Submit the module again.", exitCode: 1 }] });
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
  expect(result.report).toEqual([{ stdout: "public stdout", stderr: "public stderr", exitCode: 1 }]);
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.run.count()).toBe(1);
  expect(await f.db.run.findFirstOrThrow()).toMatchObject({ affairId: f.affair.id, lane: "background", status: "queued", prompt: 'Module price-watch build failed (untrusted test output):\n[{"stdout":"public stdout","stderr":"public stderr","exitCode":1}]' });
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
