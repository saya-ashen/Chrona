import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOTIFICATION_SETTINGS, type ModuleManifest } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import type { BuildReport } from "./module-context";
import { canonicalJson } from "./module-replay";
import { replayPreview } from "./module-preview";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Input = Parameters<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>[0];
const succeeded = (effects: unknown[] = []) => ({ status: "succeeded" as const, exitCode: 0, output: JSON.stringify({ effects }), error: null });
const effect = (body: string) => ({ type: "notify_user", key: "price", level: "digest", title: "Price", body } as const);
async function fixture(scope: "once" | "affair" = "once") {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-replay-test-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "test", settings: { notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, timezone: "Asia/Shanghai" } } } });
  const calls: Input[] = [];
  let run = async (_input: Input) => succeeded();
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-20T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    sandbox: { available: true, async runModule(input) { calls.push(input); return run(input); } } };
  const service = createStewardService(ports).forWorkspace(workspace.id), affair = await service.affairs.create({ title: "Prices" });
  const row = await db.affair.findUniqueOrThrow({ where: { id: affair.id } }), dir = join(dataDir, "affairs", row.dirName, "price-watch");
  await mkdir(dir);
  const manifest: ModuleManifest = { name: "price-watch", entry: "index.ts", triggers: [{ id: "daily", schedule: { kind: "every", minutes: 60 } }], tools: [], effects: ["notify_user"], tests: ["test.ts"], params: { threshold: { type: "number", value: 1 } }, data: { schema: 1 } };
  const write = async () => {
    await writeFile(join(dir, "module.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "index.ts"), "entry"); await writeFile(join(dir, "test.ts"), "test");
    if (manifest.data.migrate) await writeFile(join(dir, manifest.data.migrate), "migrate");
  };
  const propose = async () => {
    await write();
    const proposal = await service.modules.propose({ affairId: affair.id, dir: "price-watch", intent: { changes: ["Refactor prices"], preserves: ["Existing rules"] } }, "user");
    await service.modules.buildPending();
    const version = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } });
    const approval = await db.approval.findFirst({ where: { workspaceId: workspace.id, status: "open" } });
    return { ...proposal, status: version.status, report: version.report as unknown as BuildReport, approval };
  };
  const first = await propose();
  await service.approvals.resolve(first.approval!.id, { decision: "approve", scope });
  manifest.params.threshold!.value = 2;
  const live = join(dataDir, "platform/data", first.moduleId!);
  calls.length = 0;
  return { db, dataDir, service, manifest, first, live, calls, propose, setRun: (callback: typeof run) => { run = callback; } };
}

test("first version skips replay; identical replay stays pending and uses old/new parameters", async () => {
  const f = await fixture();
  expect(f.first.report.replay).toEqual({ status: "skipped", reason: "first version", steps: 0, diffs: [] });
  const result = await f.propose();
  expect(result.report.replay).toEqual({ status: "identical", steps: 10, diffs: [] });
  expect(result.status).toBe("pending_review");
  expect(result.approval!.status).toBe("open");
  const entries = f.calls.filter(call => call.entry === "index.ts");
  expect(entries).toHaveLength(20);
  expect(entries[0]).toMatchObject({ codeDir: join(f.dataDir, "platform/store", f.first.hash), network: false, timeoutMs: 60_000, maxOutputBytes: 65536, input: { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-20T05:00:00.000Z" }, now: "2026-10-20T05:00:00.000Z", params: { threshold: 1 } } });
  expect(entries[1]!.input).toMatchObject({ params: { threshold: 2 } });
  for (const call of entries) await expect(stat(call.dataDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("undeclared rule produces differences capped at five, preview shows both effects next to intent", async () => {
  const f = await fixture("affair");
  f.setRun(async input => succeeded([effect(input.codeDir.endsWith(f.first.hash) ? "old price rule" : "new hidden rule")]));
  const result = await f.propose(), replay = result.report.replay!;
  expect(result.status).toBe("pending_review");
  expect(replay).toMatchObject({ status: "different", steps: 10 });
  expect(replay.diffs).toHaveLength(5);
  expect(replay.diffs[0]).toEqual({ step: 1, triggerId: "daily", firedAt: "2026-10-20T05:00:00.000Z", old: { ok: true, effects: [effect("old price rule")] }, new: { ok: true, effects: [effect("new hidden rule")] } });
  const preview = result.approval!.preview!;
  expect(preview).toContain("步骤 1；daily；2026-10-20T05:00:00.000Z");
  expect(preview).toContain(`旧 effects：${JSON.stringify(replay.diffs[0]!.old)}`);
  expect(preview).toContain(`新 effects：${JSON.stringify(replay.diffs[0]!.new)}`);
  expect(preview.indexOf("连续性：")).toBeLessThan(preview.indexOf("并行模拟："));
  expect(preview.indexOf("并行模拟：")).toBeLessThan(preview.indexOf("意图："));
  expect(await f.db.notification.count()).toBe(0);
  expect(await f.db.moduleRun.count()).toBe(0);
});

test("migration runs on new replay copy and each version accumulates isolated state without touching live bytes", async () => {
  const f = await fixture();
  await mkdir(f.live, { recursive: true }); await writeFile(join(f.live, "state"), "7");
  await f.db.module.update({ where: { id: f.first.moduleId! }, data: { dataSchema: 1 } });
  f.manifest.data = { schema: 2, migrate: "migrate.ts" };
  const seen = new Map<string, number[]>(), migrations: string[] = [];
  f.setRun(async input => {
    if (input.entry === "test.ts") return succeeded();
    const path = join(input.dataDir, "state"), count = Number(await readFile(path, "utf8"));
    if (input.entry === "migrate.ts") {
      migrations.push(input.dataDir); await writeFile(path, String(count + 100)); return succeeded();
    }
    const counts = seen.get(input.dataDir) ?? []; counts.push(count); seen.set(input.dataDir, counts);
    await writeFile(path, String(count + 1));
    return succeeded();
  });
  const result = await f.propose();
  expect(result.report.continuity).toMatchObject({ status: "passed", migrated: true });
  expect(result.report.replay).toEqual({ status: "identical", steps: 10, diffs: [] });
  expect(migrations).toHaveLength(2);
  const old = [...seen].find(([path]) => path.endsWith("/old"))!, proposed = [...seen].find(([path]) => path.endsWith("/new"))!;
  expect(old[1]).toEqual(Array.from({ length: 10 }, (_, i) => 7 + i));
  expect(proposed[1]).toEqual(Array.from({ length: 10 }, (_, i) => 107 + i));
  expect(migrations).toContain(proposed[0]); expect(migrations).not.toContain(old[0]);
  expect(await readFile(join(f.live, "state"))).toEqual(Buffer.from("7"));
  expect(await readdir(f.live)).toEqual(["state"]);
  for (const path of seen.keys()) await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["old network", "new network", "id", "schedule", "data too large"])('replay skips safely: %s', async kind => {
  const f = await fixture();
  if (kind === "old network") {
    const version = await f.db.moduleVersion.findFirstOrThrow();
    await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...f.manifest, effects: ["network"] } } });
  }
  if (kind === "new network") f.manifest.effects.push("network");
  if (kind === "id") f.manifest.triggers[0]!.id = "changed";
  if (kind === "schedule") f.manifest.triggers[0] = { id: "daily", schedule: { kind: "every", minutes: 30 } };
  if (kind === "data too large") {
    await mkdir(f.live, { recursive: true }); await writeFile(join(f.live, "large"), "");
    await truncate(join(f.live, "large"), 50 * 1024 * 1024 + 1);
  }
  const result = await f.propose();
  const reason = kind.includes("network") ? "network" : kind === "data too large" ? kind : "triggers changed";
  expect(result.report.replay).toEqual({ status: "skipped", reason, steps: 0, diffs: [] });
  expect(result.status).toBe("pending_review");
  expect(f.calls.map(call => call.entry)).toEqual(["test.ts"]);
});

test.each(["old inbound", "new inbound", "old tools", "new tools"])('replay skips P4 paths without auto-activation: %s', async kind => {
  const f = await fixture("affair"), inbound = kind.endsWith("inbound");
  const patch = inbound ? { triggers: [{ id: "mail", inbound: { connector: "mailbox", match: {} } }] } : { tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" as const, properties: {}, required: [] } }] };
  if (kind.startsWith("old")) {
    const version = await f.db.moduleVersion.findFirstOrThrow();
    await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...f.manifest, ...patch } } });
  } else Object.assign(f.manifest, patch);
  const result = await f.propose();
  expect(result.report.replay).toEqual({ status: "skipped", reason: inbound ? "inbound triggers" : "tools", steps: 0, diffs: [] });
  expect(result.status).toBe("pending_review");
  expect(result.approval!.status).toBe("open");
  expect(f.calls.map(call => call.entry)).toEqual(["test.ts"]);
});

test.each([true, false])("continuity selects schedule before inbound or supplies a synthetic item (inbound only: %s)", async only => {
  const f = await fixture();
  await mkdir(f.live, { recursive: true }); await writeFile(join(f.live, "state"), "original");
  const scheduled = f.manifest.triggers[0]!;
  f.manifest.triggers = [{ id: "mail", inbound: { connector: "mailbox", match: {} } }, ...(only ? [] : [scheduled])];
  const result = await f.propose(), now = "2026-10-20T04:00:00.000Z";
  expect(result.report.continuity!.status).toBe("passed");
  const trigger = only ? { id: "mail", kind: "inbound", firedAt: now, item: { externalId: "continuity", from: "continuity@chrona.invalid", subject: "", receivedAt: now, body: "" } } : { id: "daily", kind: "schedule", firedAt: now };
  expect(f.calls.filter(call => call.entry === "index.ts").map(call => call.input)).toEqual([{ trigger, now, params: { threshold: 2 } }]);
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("original");
});

test("trigger order may change; future instants merge using OLD order including ties and exhausted at rules", async () => {
  const f = await fixture();
  const triggers: ModuleManifest["triggers"] = [{ id: "once", schedule: { kind: "at", at: "2026-10-20T05:00:00Z" } }, { id: "hourly", schedule: { kind: "every", minutes: 60 } }];
  const old = await f.db.moduleVersion.findFirstOrThrow();
  await f.db.moduleVersion.update({ where: { id: old.id }, data: { manifest: { ...f.manifest, triggers } } });
  f.manifest.triggers = [...triggers].reverse();
  const result = await f.propose();
  expect(result.report.replay).toMatchObject({ status: "identical", steps: 10 });
  const inputs = f.calls.filter(call => call.entry === "index.ts").map(call => call.input);
  expect(inputs[0]).toMatchObject({ trigger: { id: "once", firedAt: "2026-10-20T05:00:00.000Z" } });
  expect(inputs[2]).toMatchObject({ trigger: { id: "hourly", firedAt: "2026-10-20T05:00:00.000Z" } });
  expect(inputs[4]).toMatchObject({ trigger: { id: "hourly", firedAt: "2026-10-20T06:00:00.000Z" } });
});

test.each(["exit", "invalid", "throw", "both fail"])('entry failure compares ok flags without rejecting build: %s', async kind => {
  const f = await fixture();
  f.setRun(async input => {
    if (input.entry === "test.ts") return succeeded();
    if (kind !== "both fail" && input.codeDir.endsWith(f.first.hash)) return succeeded();
    if (kind === "throw") throw new Error("sandbox failure");
    return { ...succeeded(), exitCode: kind === "exit" || kind === "both fail" ? 1 : 0, output: "invalid" };
  });
  const result = await f.propose();
  expect(result.status).toBe("pending_review");
  expect(result.report.replay).toMatchObject({ status: kind === "both fail" ? "identical" : "different", steps: 10 });
  if (kind !== "both fail") expect(result.report.replay!.diffs[0]).toMatchObject({ old: { ok: true, effects: [] }, new: { ok: false } });
});

test("elapsed monotonic budget skips and removes both copies even with fixed ports.now", async () => {
  const f = await fixture();
  let elapsed = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => elapsed);
  f.setRun(async input => { if (input.entry === "index.ts") elapsed += 301_000; return succeeded(); });
  try {
    const result = await f.propose();
    expect(result.report.replay).toEqual({ status: "skipped", reason: "time budget", steps: 0, diffs: [] });
    expect(result.status).toBe("pending_review");
    for (const call of f.calls) await expect(stat(call.dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { clock.mockRestore(); }
});

test.each(["daily", "exhausted"])('replay uses workspace timezone and stops when occurrences run out: %s', async kind => {
  const f = await fixture();
  const triggers: ModuleManifest["triggers"] = [{ id: "daily", schedule: kind === "daily" ? { kind: "daily", time: "09:00" } : { kind: "at", at: "2026-10-19T05:00:00Z" } }];
  const old = await f.db.moduleVersion.findFirstOrThrow();
  await f.db.moduleVersion.update({ where: { id: old.id }, data: { manifest: { ...f.manifest, triggers } } });
  f.manifest.triggers = triggers;
  const result = await f.propose();
  expect(result.report.replay).toEqual({ status: "identical", steps: kind === "daily" ? 10 : 0, diffs: [] });
  if (kind === "daily") expect(f.calls[1]!.input).toMatchObject({ trigger: { firedAt: "2026-10-21T01:00:00.000Z" } });
});

test("failed continuity rejects build without replay", async () => {
  const f = await fixture();
  await mkdir(f.live, { recursive: true }); await writeFile(join(f.live, "state"), "original");
  f.setRun(async input => ({ ...succeeded(), exitCode: input.entry === "test.ts" ? 0 : 1 }));
  const result = await f.propose();
  expect(result.status).toBe("rejected");
  expect(result.report.continuity!.status).toBe("failed");
  expect(result.report.replay).toBeUndefined();
  expect(f.calls.map(call => call.entry)).toEqual(["test.ts", "index.ts"]);
  expect(await readFile(join(f.live, "state"), "utf8")).toBe("original");
});

test("canonical JSON sorts nested object keys, preserves array order, and preview truncates explicitly", () => {
  expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: true })).toBe(canonicalJson({ a: true, b: [{ a: 2, z: 1 }] }));
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  const preview = replayPreview({ status: "different", steps: 10, diffs: [{ step: 1, triggerId: "daily", firedAt: "now", old: { ok: true, effects: Array(20).fill(effect("x".repeat(4000))) }, new: { ok: false } }] });
  expect(preview).toContain("模拟差异过长，已截断");
  expect(preview.length).toBeLessThan(6500);
});
