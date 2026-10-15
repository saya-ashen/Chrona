import { beforeEach, afterEach, test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { liveRuns } from "./runs";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, time: Date;
let service: ReturnType<typeof createStewardService>, api: ReturnType<ReturnType<typeof createStewardService>["forWorkspace"]>;
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z");
  workspaceId = (await db.workspace.create({ data: { name: "runtime test" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-v3-")), now: () => time, publicUrl: null, chat: null, deliveries: [{ channel: "in_app", send: async () => ({ outcome: "accepted", receiptRef: null }) }] };
  service = createStewardService(ports); api = service.forWorkspace(workspaceId);
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
const affair = () => api.affairs.create({ title: "Study", request: "Learn" });
const at = () => ({ kind: "at", at: new Date(time.getTime() + 60000).toISOString() });
const advance = (ms: number) => { time = new Date(time.getTime() + ms); };

test("schedule CRUD validates ownership, timezone, until, and one-shot missed reminder", async () => {
  const a = await affair();
  const daily = await api.schedules.create(a.id, { mode: "wake", rule: { kind: "daily", time: "13:00" }, text: "Prepare" });
  expect(daily.nextAt).toBe("2026-10-15T05:00:00.000Z");
  const ended = await api.schedules.create(a.id, { mode: "wake", rule: { kind: "daily", time: "13:00" }, text: "Prepare", until: time.toISOString() });
  expect(ended.status).toBe("done");
  await expect(api.schedules.create(a.id, { mode: "job", rule: at(), text: "Check" })).rejects.toMatchObject({ code: "invalid" });
  const s = await api.schedules.create(a.id, { mode: "remind", rule: at(), text: "  exact reminder\n" });
  advance(180000);
  expect(await api.schedules.fireDue()).toBe(1); expect(await api.schedules.fireDue()).toBe(0);
  const stored = await db.schedule.findUniqueOrThrow({ where: { id: s.id } });
  expect(stored.status).toBe("done"); expect(stored.lastResult).toContain("120000ms");
  const n = await db.notification.findFirstOrThrow(); expect(n.body).toBe("  exact reminder\n"); expect(n.link).toBe(`/affairs/${a.id}`);
  const other = (await db.workspace.create({ data: { name: "other" } })).id;
  await expect(service.forWorkspace(other).schedules.cancel(s.id)).rejects.toMatchObject({ code: "not_found" });
  await api.schedules.cancel(daily.id); expect((await api.schedules.list(a.id)).find(r => r.id === daily.id)?.status).toBe("cancelled");
});

test("wake fires once after downtime, pauses with affair, expired until never fires", async () => {
  const a = await affair();
  const s = await api.schedules.create(a.id, { mode: "wake", rule: { kind: "every", minutes: 5 }, text: "Check progress" });
  await api.schedules.create(a.id, { mode: "wake", rule: at(), until: new Date(time.getTime() + 120000).toISOString(), text: "Expired" });
  advance(3600000); expect(await api.schedules.fireDue()).toBe(1);
  const run = await db.run.findFirstOrThrow(); expect(run.prompt).toContain("Check progress"); expect(run.prompt).toContain("3300000ms late");
  expect((await db.schedule.findUniqueOrThrow({ where: { id: s.id } })).nextAt).toEqual(new Date(time.getTime() + 300000));
  await api.affairs.update(a.id, { status: "paused" }); advance(3600000); expect(await api.schedules.fireDue()).toBe(0);
});

test("job output and exit changes wake; output capped; three failures pause and notify once", async () => {
  const a = await affair(); let output = "ok", exitCode = 0, calls = 0;
  ports.sandbox = { available: true, run: async input => { calls++; expect(input.cwd).toContain("affairs"); expect(input.timeoutMs).toBe(60000); return { output, exitCode }; } };
  const s = await api.schedules.create(a.id, { mode: "job", rule: { kind: "every", minutes: 5 }, text: "Check", command: "fake" });
  for (let i = 0; i < 2; i++) { advance(300000); await api.schedules.fireDue(); }
  expect(calls).toBe(2); expect(await db.run.count()).toBe(1);
  output = "x".repeat(100000); advance(300000); await api.schedules.fireDue();
  expect((await db.run.findMany()).some(r => r.prompt.length > 65536 && r.prompt.length < 66000)).toBe(true);
  exitCode = 1;
  for (let i = 0; i < 3; i++) { advance(300000); await api.schedules.fireDue(); }
  expect(await db.run.count()).toBe(3);
  expect((await db.schedule.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("paused");
  expect(await db.notification.count({ where: { title: "检查连续失败，已暂停" } })).toBe(1);
  advance(300000); expect(await api.schedules.fireDue()).toBe(0);
});

test("job policy denies execution and once grants are consumed", async () => {
  const a = await affair(); let calls = 0;
  ports.sandbox = { available: true, run: async () => { calls++; return { output: "ok", exitCode: 0 }; } };
  await api.grants.create({ action: "run_job", mode: "never", scope: { kind: "affair", affairId: a.id } });
  await api.schedules.create(a.id, { mode: "job", rule: at(), text: "Check", command: "fake" });
  advance(60000); await api.schedules.fireDue(); expect(calls).toBe(0);
  const b = await affair();
  const grant = await db.grant.create({ data: { workspaceId, action: "run_job", mode: "preapproved", once: true, scope: { kind: "affair", affairId: b.id } } });
  await api.schedules.create(b.id, { mode: "job", rule: at(), text: "Check", command: "fake" });
  advance(60000); await api.schedules.fireDue(); expect(calls).toBe(1);
  expect((await db.grant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt).toEqual(time);
});

test("foreground claims first; lanes independent; tokens and deadlines; commits produce activity", async () => {
  const a = await affair();
  await api.runs.enqueue({ affairId: a.id, lane: "background", trigger: "schedule", prompt: "background" });
  await api.runs.enqueue({ affairId: a.id, lane: "foreground", trigger: "message", prompt: "hello" });
  expect(await api.runs.claimNext("background")).toBeNull();
  const fg = (await api.runs.claimNext("foreground"))!;
  expect((await api.runs.authenticate(fg.token)).run.id).toBe(fg.id);
  expect((await db.run.findUniqueOrThrow({ where: { id: fg.id } })).tokenHash).not.toBe(fg.token);
  const bg = (await api.runs.claimNext("background"))!; expect(bg).not.toBeNull();
  expect(await api.runs.claimNext("background")).toBeNull();
  await writeFile(join(fg.cwd, "work.md"), "Done");
  await api.runs.finish(fg.id, { outcome: "finished", sessionId: "session", error: null });
  expect((await api.affairs.activity(a.id)).some(r => r.kind === "edit" && r.data?.paths && JSON.stringify(r.data.paths) === '["work.md"]')).toBe(true);
  expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).sessionId).toBe("session");
  await expect(api.runs.authenticate(fg.token)).rejects.toMatchObject({ code: "forbidden" });
  await api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "next" });
  expect(await api.runs.claimNext("foreground")).not.toBeNull();
});

test("root run commits new and dirty affairs with activity, leaves clean and foreign affairs alone", async () => {
  const existing = await affair(), clean = await affair();
  const other = (await db.workspace.create({ data: { name: "other" } })).id;
  const foreignApi = service.forWorkspace(other);
  const foreign = await foreignApi.affairs.create({ title: "Foreign", request: "Private" });
  const foreignFiles = await foreignApi.affairs.files(foreign.id);
  await writeFile(join(await foreignFiles.directory(), "pending.md"), "not this workspace");
  advance(1000);
  await api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "plan" });
  const run = (await api.runs.claimNext("foreground"))!;
  const created = await affair();
  const createdClean = await affair();
  for (const a of [existing, created]) {
    const files = await api.affairs.files(a.id);
    await writeFile(join(await files.directory(), "work.md"), "Done");
  }
  await api.runs.finish(run.id, { outcome: "finished", sessionId: "root-session", error: null });
  for (const a of [existing, created]) {
    const files = await api.affairs.files(a.id);
    const revision = (await files.revisions())[0]!;
    expect(revision.author).toBe("chrona");
    expect(revision.paths).toContain("work.md");
    expect(await files.commitAll("chrona", "should be clean")).toEqual([]);
    const activity = await api.affairs.activity(a.id);
    expect(activity.some(row => row.kind === "run" && row.data?.runId === run.id)).toBe(true);
    expect(activity.some(row => row.kind === "edit" && row.data?.commit === revision.sha && row.text === "work.md")).toBe(true);
    expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).sessionId).toBeNull();
  }
  expect((await api.affairs.activity(createdClean.id)).some(row => row.kind === "run")).toBe(true);
  expect(await api.affairs.activity(clean.id)).toEqual([]);
  expect(await foreignApi.affairs.activity(foreign.id)).toEqual([]);
  expect((await foreignFiles.revisions())[0]!.paths).not.toContain("pending.md");
  const count = await db.activity.count();
  await api.runs.finish(run.id, { outcome: "finished", sessionId: null, error: null });
  expect(await db.activity.count()).toBe(count);
});

test("per-affair daily cap defers without blocking root; unavailable backs off; lease expires", async () => {
  const a = await affair();
  for (let i = 0; i < 24; i++) await db.run.create({ data: { workspaceId, affairId: a.id, lane: "background", trigger: "schedule", provider: "fake", tokenHash: `cap-${i}`, prompt: "", cwd: "", status: "finished", startedAt: time, endedAt: time } });
  const capped = await api.runs.enqueue({ affairId: a.id, lane: "foreground", trigger: "message", prompt: "capped" });
  expect(await api.runs.claimNext("foreground")).toBeNull();
  expect((await db.run.findUniqueOrThrow({ where: { id: capped.id } })).leaseUntil?.toISOString()).toBe("2026-10-15T16:00:00.000Z");
  await api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "root" });
  const run = (await api.runs.claimNext("foreground"))!;
  await api.runs.finish(run.id, { outcome: "unavailable", sessionId: null, error: "offline" });
  expect(await api.runs.claimNext("foreground")).toBeNull();
  advance(60000); const retry = (await api.runs.claimNext("foreground"))!; expect(retry.trigger).toBe("message");
  advance(300000); expect(await api.runs.expireLeases()).toBe(1);
  expect((await db.run.findUniqueOrThrow({ where: { id: retry.id } })).status).toBe("timed_out");
});

test("concurrent scheduler scans do not duplicate reminder or wake", async () => {
  const a = await affair();
  await api.schedules.create(a.id, { mode: "remind", rule: at(), text: "once" });
  await api.schedules.create(a.id, { mode: "wake", rule: at(), text: "once" });
  advance(60000);
  const counts = await Promise.all([api.schedules.fireDue(), api.schedules.fireDue()]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  expect(await db.notification.count()).toBe(1); expect(await db.run.count()).toBe(1);
});

test("unconfigured provider marks unavailable, retries with backoff, and warns on third failure", async () => {
  await api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "retained" });
  for (let i = 0; i < 3; i++) {
    expect((await service.tick()).failures).toEqual([]);
    expect(await db.run.count({ where: { status: "provider_unavailable" } })).toBe(i + 1);
    const pending = await db.run.findFirstOrThrow({ where: { status: "queued" } });
    expect(pending.prompt).toBe("retained");
    expect(pending.leaseUntil!.getTime() - time.getTime()).toBe(60000 * 2 ** i);
    time = pending.leaseUntil!;
  }
  expect(await db.notification.count({ where: { title: "处理连续失败" } })).toBe(1);
});

test("tick launches both lanes without awaiting long background; session persisted", async () => {
  const a = await affair(); const starts: string[] = [];
  let resolve!: (value: Awaited<ReturnType<ProviderAdapter["start"]>["done"]>) => void;
  ports.provider = { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start: input => {
    starts.push(input.lane); expect(input.prompt).toContain("timezone"); expect(input.prompt).toContain("Study");
    return { inject: async () => {}, abort: async () => {}, done: input.lane === "background" ? new Promise(done => { resolve = done; }) : Promise.resolve({ outcome: "finished", sessionId: null, error: null }) };
  } };
  await api.runs.enqueue({ affairId: a.id, lane: "background", trigger: "schedule", prompt: "check" });
  expect((await service.tick()).failures).toEqual([]);
  await api.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "hi" });
  expect((await service.tick()).failures).toEqual([]); expect(starts).toEqual(["background", "foreground"]);
  resolve({ outcome: "finished", sessionId: "saved", error: null });
  for (let i = 0; i < 100 && await db.run.count({ where: { status: "running" } }); i++) await Bun.sleep(10);
  expect(await db.run.count({ where: { status: "running" } })).toBe(0);
  expect((await db.affair.findUniqueOrThrow({ where: { id: a.id } })).sessionId).toBe("saved");
});

test("a one-shot wake whose time already passed fires on the next tick instead of being dropped", async () => {
  const a = await affair();
  const s = await api.schedules.create(a.id, { mode: "wake", rule: { kind: "at", at: new Date(time.getTime() - 5000).toISOString() }, text: "Prepare materials now" }, "chrona");
  expect(s.status).toBe("active");
  expect(s.nextAt).toBe(time.toISOString());
  await api.schedules.fireDue(time);
  const runs = await db.run.findMany({ where: { workspaceId, lane: "background" } });
  expect(runs).toHaveLength(1);
  expect(runs[0]!.prompt).toContain("Prepare materials now");
});
