import { afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { retireReflection } from "./reflection-retirement";
import { notices } from "./test-notices";
import { liveRuns } from "./runs";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { recordModuleActivation } from "./module-evolution";
import { moduleContext } from "./module-context";
import mindManifest from "./builtin/mind/module.json";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.$disconnect(); });
const now = new Date("2026-11-04T12:00:00Z");
async function fixture(reflection: unknown = true, enabled: boolean | null = true) {
  const db = testDb(); databases.push(db);
  const workspaceId = (await db.workspace.create({ data: { name: "retirement", settings: { reflection: { enabled: reflection }, moduleSettings: { mind: { enabled } } } as never } })).id;
  const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/chrona-retirement-unused", publicUrl: null };
  if (enabled !== null) {
    const module = await db.module.create({ data: { workspaceId, name: "mind", status: "active", activeHash: "mind-hash" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "mind-hash", manifest: mindManifest, source: "builtin", status: "active", intent: {}, report: {} } });
  }
  const notes: Record<string, string>[] = [];
  const writeNote = async (_ports: StewardPorts, _workspaceId: string, args: Record<string, string>) => { notes.push(args); };
  const migrate = () => retireReflection(ports, workspaceId, writeNote);
  const marker = () => db.audit.findUniqueOrThrow({ where: { id: `reflection-retired:${workspaceId}` } });
  return { db, ports, workspaceId, notes, writeNote, migrate, marker };
}

const cases = [
  { reflection: true, enabled: true, mind: "enabled", healthFixes: true, body: null },
  { reflection: false, enabled: true, mind: "enabled", healthFixes: false, body: "你之前关闭了主动反思，所以心智的「自主修复」已设为关闭：发现应用故障时只提醒你，不会自己启动修复构建。需要时可在 mind 应用的设置里打开。" },
  { reflection: true, enabled: false, mind: "disabled", healthFixes: true, body: "主动反思已并入心智，但心智的主动唤醒当前关闭，Chrona 不会自主发现和修复应用故障。需要时在 mind 应用的设置里打开「主动唤醒」。" },
  { reflection: true, enabled: null, mind: "absent", healthFixes: null, body: "主动反思已移除；当前没有启用的心智应用，Chrona 不会自主发现和修复应用故障。" },
  { reflection: false, enabled: false, mind: "disabled", healthFixes: true, body: null },
  { reflection: false, enabled: null, mind: "absent", healthFixes: null, body: null },
];
for (const item of cases) test(`takeover reflection=${item.reflection}, mind=${item.mind}`, async () => {
  const f = await fixture(item.reflection, item.enabled);
  await f.migrate();
  expect(await f.marker()).toMatchObject({ kind: "reflection_retired", actorKey: "chrona", subjectId: f.workspaceId,
    details: { reflection: item.reflection, mind: item.mind, healthFixes: item.healthFixes, ledger: 0, cancelledRuns: 0 } });
  expect(await notices(f.db)).toEqual(item.body ? [expect.objectContaining({ title: "主动反思已并入心智", body: item.body, level: "digest", idempotencyKey: `reflection-retired:${f.workspaceId}` })] : []);
  const settings = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings as { moduleSettings: { mind: Record<string, unknown> } };
  expect(settings.moduleSettings.mind.enabled).toBe(item.enabled);
  expect(settings.moduleSettings.mind["health-fixes"]).toBe(!item.reflection && item.enabled === true ? false : undefined);
  await f.migrate();
  expect(await notices(f.db)).toHaveLength(item.body ? 1 : 0);
});

test("custom mind without health-fixes preserves settings and warns once when reflection was off", async () => {
  const f = await fixture(false);
  const module = await f.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "mind" } });
  const manifest = moduleManifestSchema.parse(mindManifest);
  delete manifest.settings["health-fixes"];
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } }, data: { manifest, source: "provider" } });
  const settings = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings;
  await f.migrate();
  expect((await f.marker()).details).toMatchObject({ reflection: false, mind: "enabled", healthFixes: null, ledger: 0, cancelledRuns: 0 });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toEqual(settings);
  expect(await f.db.audit.count({ where: { workspaceId: f.workspaceId, kind: "module_settings_updated" } })).toBe(0);
  expect(await notices(f.db)).toEqual([expect.objectContaining({ title: "主动反思已并入心智",
    body: "你之前关闭了主动反思；当前 mind 版本没有「自主修复」开关，心智唤醒的 Chrona 仍可能自己启动修复构建。如不希望这样，请关闭 mind 的「主动唤醒」，或让 Chrona 在 mind 里加入「自主修复」开关。",
    level: "digest", idempotencyKey: `reflection-retired:${f.workspaceId}` })]);
  await f.migrate();
  expect(await notices(f.db)).toHaveLength(1);
});

test("raw absent and invalid reflection flags preserve the old enabled default", async () => {
  for (const raw of [{}, { reflection: { enabled: "false" } }]) {
    const f = await fixture(true, null);
    await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: raw } });
    await f.migrate();
    expect((await f.marker()).details).toMatchObject({ reflection: true, mind: "absent" });
  }
});

async function suggestion(f: Awaited<ReturnType<typeof fixture>>, days: number, modules: string[] = []) {
  return f.db.audit.create({ data: { workspaceId: f.workspaceId, kind: "reflection_suggested", actorKey: "chrona", createdAt: new Date(now.getTime() - days * 86400_000),
    details: { key: "page /中文", title: "标题".repeat(100), why: "private error text must not be copied", sessionId: `build-${days}`, modules } } });
}
test("ledger migrates recent suggestions as closed records with current source and only once", async () => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "example", activeHash: "example-hash" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "example-hash", manifest: moduleManifestSchema.parse({ name: "example", entry: "index.ts", keepAlive: true, triggers: [], effects: [], tests: ["test.ts"] }), source: "provider", status: "active", intent: {}, report: {} } });
  const activation = await recordModuleActivation(moduleContext(f.ports, f.workspaceId), f.db, { moduleId: module.id, previousHash: null, hash: "example-hash", generationId: "g1" });
  await suggestion(f, 1, [module.name]); await suggestion(f, 30); await suggestion(f, 31);
  await f.migrate();
  expect(f.notes).toHaveLength(2);
  expect(f.notes[1]).toEqual({ title: `反思建议：${"标题".repeat(100)}`.slice(0, 120), status: "done",
    conclusion: "已移除的主动反思于 2026-11-03 发起构建（会话 build-1）；迁移记录，不代表已修复", "build-session-id": "build-1",
    "source-module-id": module.id, "source-activation-id": activation.activationId, topic: "reflection:page____" });
  expect(f.notes[0]).toEqual({ title: `反思建议：${"标题".repeat(100)}`.slice(0, 120), status: "done",
    conclusion: "已移除的主动反思于 2026-10-05 发起构建（会话 build-30）；迁移记录，不代表已修复", "build-session-id": "build-30" });
  expect(JSON.stringify(f.notes)).not.toContain("private error");
  expect((await f.marker()).details).toMatchObject({ ledger: 2 });
  await f.migrate(); expect(f.notes).toHaveLength(2);
});

test("failed notes are logged, skipped, and do not block the marker or subsequent notes", async () => {
  const f = await fixture(true, false);
  await suggestion(f, 1); await suggestion(f, 2);
  const log = spyOn(console, "error").mockImplementation(() => {});
  let calls = 0;
  try {
    await retireReflection(f.ports, f.workspaceId, async (ports, workspaceId, args) => {
      if (++calls === 1) throw new Error("private failure");
      await f.writeNote(ports, workspaceId, args);
    });
    expect(calls).toBe(2); expect(f.notes).toHaveLength(1);
    expect((await f.marker()).details).toMatchObject({ ledger: 1, mind: "disabled" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: "reflection_retirement_note_failed", workspaceId: f.workspaceId });
    await f.migrate(); expect(f.notes).toHaveLength(1);
  } finally { log.mockRestore(); }
});

test("absent mind does not migrate notes; paused mind is absent", async () => {
  const f = await fixture();
  await f.db.module.updateMany({ where: { workspaceId: f.workspaceId }, data: { status: "paused" } });
  await suggestion(f, 1); await f.migrate();
  expect(f.notes).toHaveLength(0);
  expect((await f.marker()).details).toMatchObject({ mind: "absent", ledger: 0, healthFixes: null });
});

async function run(f: Awaited<ReturnType<typeof fixture>>, source: string, status: string, originSessionId?: string) {
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: randomUUID(), source, originSessionId } });
  return f.db.run.create({ data: { workspaceId: f.workspaceId, sessionId: session.id, lane: source === "build" ? "build" : "background", trigger: source, provider: "fake", status, tokenHash: randomUUID(), prompt: "", cwd: "/tmp/chrona-retirement-unused" } });
}
test("cancels queued/running reflect attempts without touching builds they started", async () => {
  const f = await fixture();
  const queued = await run(f, "reflect", "queued"), running = await run(f, "reflect", "running");
  const build = await run(f, "build", "running", running.sessionId!);
  let aborted = 0;
  liveRuns.set(running.id, { abort: async () => { aborted++; }, inject: async () => {}, done: new Promise(() => {}) });
  try {
    await f.migrate();
    expect(aborted).toBe(1);
    expect((await f.db.run.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("cancelled");
    expect((await f.db.run.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("cancelled");
    expect((await f.db.run.findUniqueOrThrow({ where: { id: build.id } })).status).toBe("running");
    expect((await f.marker()).details).toMatchObject({ cancelledRuns: 2 });
  } finally { liveRuns.delete(running.id); }
});
