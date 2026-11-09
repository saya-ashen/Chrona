import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, type ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { testModuleSandbox } from "./module-test-process";
import { testDb } from "./test-db";
import { createModules } from "./modules";
import { handleModuleCall } from "./module-effects";
import { sessionTranscript } from "./transcript";
import { liveRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";
import { approvalNoticeBody } from "./external/notify/approval";
import { buildControl, startOwnerBuild } from "./owner-build";
import { buildDiagnostics, buildHealthTargets, controlBuild, declaredModules, queueBuild, startBuild, readBuildFacts, readBuildTranscript } from "./module-build-session";
import { recordModuleFailure } from "./module-diagnostics";
import { createBuildGovernance } from "./build-governance";
import { buildRequestSchema } from "./module-build-inputs";
import { readModuleFiles } from "./module-preview";
import { requestGroup } from "./module-group";
import { parseInput } from "./errors";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function legacySourceHash(dir: string) {
  const digest = createHash("sha256");
  for (const file of (await readModuleFiles(dir, "Unsafe fixture source")).sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  return digest.digest("hex");
}
const intent = { changes: ["Sort shop mail without the model"], preserves: [] };
const request = { name: "mail-sort", goal: "Mark mail from *@shop.example handled", examples: ["from a@shop.example → handled"], intent };
const manifest = { name: "mail-sort", entry: "index.ts", keepAlive: true, effects: [], tests: ["test.ts"] };
const entry = 'import { on } from "chrona"; on("tool", () => ({ result: {} }));';

/** Retained private build machinery; no retired routed build tool is installed by this fixture. */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-build-session-"));
  const starts: ProviderRunInput[] = [];
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null,
    moduleSdk: fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk", import.meta.url)),
    moduleTypecheck: fileURLToPath(new URL("../../../../integrations/src/steward/module-typecheck", import.meta.url)),
    sandbox: testModuleSandbox(async () => ({ status: "succeeded", output: '{"effects":[]}', error: null, exitCode: 0 })),
    provider: { name: "fake", async health() { return { available: true, sandboxed: true, error: null }; }, start(input) {
      starts.push(input);
      return { async inject() {}, async abort() {}, done: Promise.resolve({ outcome: "finished" as const, sessionId: null, error: null }) };
    } },
  };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const service = createStewardService(ports);
  const workspaceId = (await db.workspace.create({ data: { name: "private build" } })).id, api = service.forWorkspace(workspaceId);
  const session = await db.session.create({ data: { workspaceId, key: "web:build", source: "web" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Sort mail" });
  const requester = (await api.runs.claimNext("foreground"))!;
  async function writeModule(cwd: string) {
    await mkdir(join(cwd, "mail-sort"), { recursive: true });
    await writeFile(join(cwd, "mail-sort", "module.json"), JSON.stringify(manifest));
    await writeFile(join(cwd, "mail-sort", "index.ts"), entry);
    await writeFile(join(cwd, "mail-sort", "test.ts"), "export {};");
  }
  const start = async (raw: unknown) => startBuild(ports, workspaceId, requester.id, parseInput(buildRequestSchema, raw));
  const revise = async (raw: unknown) => buildControl(ports, workspaceId, { kind: "provider", runId: requester.id }, "revise-build", raw as Record<string, unknown>);
  const stop = (sessionId: string) => controlBuild(ports, workspaceId, sessionId);
  return { db, dataDir, ports, service, api, governance: createBuildGovernance(ports, workspaceId), workspaceId, session, requester, starts, writeModule, start, revise, stop };
}

test("private stop/revise preserves files, cancels old capabilities and continues in the same session", async () => {
  const f = await fixture();
  const { sessionId } = await f.start(request) as { sessionId: string };
  const old = (await f.api.runs.claimNext("build"))!;
  await writeFile(join(old.cwd, "draft.txt"), "keep this work");
  await expect(f.revise({ session: sessionId, requirements: "  " })).rejects.toThrow();
  expect((await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("running");
  const revised = await buildControl(f.ports, f.workspaceId, { kind: "owner", via: null }, "revise-build", { session: sessionId, requirements: "只标记，不删除邮件" });
  expect(revised).toMatchObject({ status: "build_revised", sessionId });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("cancelled");
  await expect(f.service.tools.catalog(old.token)).rejects.toThrow();
  const next = await f.db.run.findFirstOrThrow({ where: { sessionId, status: "queued" } });
  expect(next.cwd).toBe(old.cwd);
  expect(next.prompt).toContain("只标记，不删除邮件");
  expect(await readFile(join(old.cwd, "draft.txt"), "utf8")).toBe("keep this work");
  expect(JSON.parse(await readFile(join(old.cwd, "request.json"), "utf8")).revisedRequirements).toBe("只标记，不删除邮件");
  expect(await f.db.message.findFirst({ where: { sessionId, direction: "in" } })).toMatchObject({ text: "只标记，不删除邮件" });
  await f.stop(sessionId);
  await f.stop(sessionId);
  expect(await f.db.run.count({ where: { sessionId, status: { in: ["queued", "running"] } } })).toBe(0);
  expect(await f.db.run.count({ where: { sessionId } })).toBe(2);
  await expect(f.stop(f.session.id)).rejects.toThrow();
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(controlBuild(f.ports, other.id, sessionId)).rejects.toThrow();
  // A stopped build can queue behind another without running alongside it.
  const second = await f.start(request) as { sessionId: string };
  expect(await f.revise({ session: sessionId, requirements: "继续" })).toMatchObject({ status: "build_revised", queuePosition: 2, aheadCount: 1 });
  await f.stop(second.sessionId);
  await Promise.all(["新要求一", "新要求二"].map(requirements => f.revise({ session: sessionId, requirements })));
  expect(await f.db.run.count({ where: { sessionId, status: { in: ["queued", "running"] } } })).toBe(1);
});

test("revision waits for abort before reusing the directory; abort failure never queues replacement work", async () => {
  const f = await fixture();
  const { sessionId } = await f.start(request) as { sessionId: string };
  const old = (await f.api.runs.claimNext("build"))!;
  cleanups.push(async () => { liveRuns.delete(old.id); });
  let aborted = false;
  liveRuns.set(old.id, { async inject() {}, async abort() {
    expect(await f.db.run.count({ where: { sessionId, status: "queued" } })).toBe(0);
    await Bun.sleep(20);
    aborted = true;
    throw new Error("abort failed");
  }, done: Promise.resolve({ outcome: "failed", sessionId: null, error: "aborted" }) });
  await expect(f.revise({ session: sessionId, requirements: "new goal" })).rejects.toThrow("abort failed");
  expect(aborted).toBe(true);
  expect(await f.db.run.count({ where: { sessionId } })).toBe(1);
  liveRuns.set(old.id, { async inject() {}, async abort() { await Bun.sleep(20); }, done: Promise.resolve({ outcome: "failed", sessionId: null, error: "aborted" }) });
  expect(await f.revise({ session: sessionId, requirements: "new goal" })).toMatchObject({ status: "build_revised" });
  expect(await f.db.run.count({ where: { sessionId, status: "queued" } })).toBe(1);
});

for (const limit of [0, 2, 20]) test(`daily new-build allowance ${limit} is owner configurable and matches settings usage`, async () => {
  const f = await fixture();
  await f.governance.update({ dailyLimit: limit });
  for (let i = 0; i < limit; i++) await f.db.session.create({ data: { workspaceId: f.workspaceId, key: `history:${i}`, source: "build", status: "ended", createdAt: f.ports.now() } });
  expect((await f.governance.get()).buildUsage).toMatchObject({ used: limit, remaining: 0 });
  await expect(f.start(request)).rejects.toThrow("Daily module build budget reached");
  await f.governance.update({ dailyLimit: limit + 1 });
  expect(await f.start(request)).toMatchObject({ status: "build_queued" });
  expect((await f.governance.get()).buildUsage).toMatchObject({ used: limit + 1, remaining: 0 });
});

test("persistent FIFO survives service recreation and tied clocks; waiting has no model calls or running deadline", async () => {
  const f = await fixture(), now = f.ports.now();
  f.ports.now = () => now;
  const builds = [];
  for (let i = 0; i < 3; i++) builds.push(await f.start({ ...request, name: `queued-${i}` }) as { sessionId: string });
  expect(await f.db.run.count({ where: { lane: "build", status: "queued", startedAt: null, deadlineAt: null, leaseUntil: null } })).toBe(3);
  expect(f.starts).toHaveLength(0);
  const api = createStewardService(f.ports).forWorkspace(f.workspaceId);
  f.ports.now = () => new Date(now.getTime() + 2 * 3600_000);
  await createBuildGovernance(f.ports, f.workspaceId).update({ timeoutMinutes: 75, maxSubmissions: 3 });
  for (const build of builds) {
    const run = (await api.runs.claimNext("build"))!;
    expect(run.sessionId).toBe(build.sessionId);
    expect(run.deadlineAt.getTime() - run.startedAt.getTime()).toBe(75 * 60_000);
    expect(run.prompt).toContain("at most 3 candidate submissions");
    expect(await api.runs.claimNext("build")).toBeNull();
    await api.runs.finish(run.id, { outcome: "failed", sessionId: null, error: "fixture failure" });
  }
  expect(await api.runs.claimNext("build")).toBeNull();
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(3);
  expect(f.starts).toHaveLength(0);
});

test("identical outstanding requests are idempotent across service recreation, but completed/stopped work can be requested again", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.start(request), f.start(request)]) as { sessionId: string; runId: string }[];
  expect(a!.sessionId).toBe(b!.sessionId);
  const repeat = await startBuild({ ...f.ports }, f.workspaceId, f.requester.id, buildRequestSchema.parse(request));
  expect(repeat).toMatchObject({ sessionId: a!.sessionId, runId: a!.runId, duplicate: true });
  expect((await f.governance.get()).buildUsage.used).toBe(1);
  const claimed = (await f.api.runs.claimNext("build"))!;
  expect(await f.start(request)).toMatchObject({ status: "build_running", runId: claimed.id, duplicate: true });
  await f.stop(a!.sessionId);
  const next = await f.start(request) as { sessionId: string };
  expect(next.sessionId).not.toBe(a!.sessionId);
  expect((await f.governance.get()).buildUsage.used).toBe(2);
});

test("queue bound rejects without consuming admission; cancellation frees space and a full queue cannot destroy a running revision", async () => {
  const f = await fixture(), ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push((await f.start({ ...request, name: `bounded-${i}` }) as { sessionId: string }).sessionId);
  await expect(f.start({ ...request, name: "overflow" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("queue is full") });
  expect(await f.start({ ...request, name: "bounded-0" })).toMatchObject({ sessionId: ids[0], duplicate: true });
  expect((await f.governance.get()).buildUsage.used).toBe(10);
  // Replacing a queued task is allowed even at capacity, and moves it to the tail.
  expect(await f.revise({ session: ids[3], requirements: "revised while queued" })).toMatchObject({ queuePosition: 10, aheadCount: 9 });
  await f.stop(ids[5]);
  await f.start({ ...request, name: "replacement" });
  const active = (await f.api.runs.claimNext("build"))!;
  expect(active.sessionId).toBe(ids[0]!);
  expect(await f.start({ ...request, name: "one-more" })).toMatchObject({ queuePosition: 10, aheadCount: 10 });
  await expect(f.revise({ session: active.sessionId, requirements: "no room" })).rejects.toThrow("queue is full");
  expect((await f.db.run.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("running");
  expect(await f.db.run.count({ where: { lane: "build", status: "queued" } })).toBe(10);
});

for (const scope of ["session", "global"] as const) test(`${scope} budget-deferred head retains FIFO position without a paid retry`, async () => {
  const f = await fixture();
  const first = await f.start(request) as { sessionId: string };
  const second = await f.start({ ...request, name: "second" }) as { sessionId: string };
  await f.db.run.createMany({ data: Array.from({ length: scope === "global" ? 199 : 24 }, (_, i) => ({ workspaceId: f.workspaceId, sessionId: scope === "global" ? f.session.id : first.sessionId, lane: scope === "global" ? "background" : "build", trigger: "build", status: "finished", provider: "fake", tokenHash: `budget-history-${i}`, cwd: "unused", prompt: "", startedAt: f.ports.now() })) });
  expect(await f.api.runs.claimNext("build")).toBeNull();
  expect(await f.api.runs.claimNext("build")).toBeNull();
  await f.stop(first.sessionId);
  if (scope === "global") {
    expect(await f.api.runs.claimNext("build")).toBeNull();
    const tomorrow = new Date(f.ports.now().getTime() + 86400_000);
    f.ports.now = () => tomorrow;
  }
  expect((await f.api.runs.claimNext("build"))!.sessionId).toBe(second.sessionId);
  expect(f.starts).toHaveLength(0);
});

test("missing required references reject before admitting or charging a build", async () => {
  const f = await fixture();
  await mkdir(f.requester.cwd, { recursive: true });
  for (const file of ["missing.txt", "content/chat/missing.txt"]) {
    await expect(f.start({ ...request, files: [file] })).rejects.toMatchObject({ code: "not_found" });
  }
  expect(await f.db.session.count({ where: { workspaceId: f.workspaceId, source: "build" } })).toBe(0);
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId, lane: "build" } })).toBe(0);
  expect((await f.governance.get()).buildUsage.used).toBe(0);
  expect(f.starts).toHaveLength(0);
});

const ownerRequest = { name: "mail-sort", goal: "Only the authorized change", intent, requestKey: "one-user-authorization",
  execution: { provider: "pi" as const, model: "openai/gpt-6.1-sol", timeoutMinutes: 10, maxSubmissions: 1 } };
async function ownerFixture() {
  const f = await fixture();
  f.ports.provider = { ...f.ports.provider!, name: "pi", supportsRunModel: true };
  return f;
}
test("owner builds pin their own limits and model, deduplicate even after completion, and never resume", async () => {
  const f = await ownerFixture();
  const before = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings;
  const started = await startOwnerBuild(f.ports, f.workspaceId, ownerRequest);
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toEqual(before);
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ runId: started.runId, duplicate: true });
  await expect(startOwnerBuild(f.ports, f.workspaceId, { ...ownerRequest, goal: "different" })).rejects.toMatchObject({ code: "conflict" });
  // Global settings change after admission cannot inflate the single-run authorization.
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { builds: { timeoutMinutes: 120, dailyLimit: 20, maxSubmissions: 20 } } } });
  const claimed = (await f.api.runs.claimNext("build"))!;
  expect(claimed.model).toBe("openai/gpt-6.1-sol");
  expect(claimed.deadlineAt.getTime() - claimed.startedAt.getTime()).toBe(600_000);
  expect((await f.db.audit.findFirstOrThrow({ where: { kind: "run_claimed", subjectId: claimed.id } })).details).toMatchObject({ builds: { timeoutMinutes: 10, maxSubmissions: 1 } });
  await f.api.runs.finish(claimed.id, { outcome: "timed_out", sessionId: null, error: "deadline" });
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ runId: claimed.id, status: "timed_out", duplicate: true });
  await expect(controlBuild(f.ports, f.workspaceId, started.sessionId, "continue")).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count({ where: { sessionId: started.sessionId } })).toBe(1);
  expect(before).not.toHaveProperty("builds.timeoutMinutes", 10);
});
test("owner bounds cannot authorize builtin targets, including replay after identity changes", async () => {
  const f = await ownerFixture();
  await expect(startOwnerBuild(f.ports, f.workspaceId, { ...ownerRequest, name: "agent" })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(0);
  const started = await startOwnerBuild(f.ports, f.workspaceId, ownerRequest);
  await f.db.module.create({ data: { workspaceId: f.workspaceId, name: ownerRequest.name, builtin: true } });
  await expect(startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.count({ where: { sessionId: started.sessionId } })).toBe(1);
});
test("owner build validation rejects host paths, multiple modules, unsupported providers and excess caps without enqueueing", async () => {
  const f = await ownerFixture();
  for (const request of [{ ...ownerRequest, files: ["/home/user/private"] }, { ...ownerRequest, modules: ["web", "calendar"] },
    { ...ownerRequest, execution: { ...ownerRequest.execution, provider: "other" } },
    { ...ownerRequest, execution: { ...ownerRequest.execution, timeoutMinutes: 121 } }]) await expect(startOwnerBuild(f.ports, f.workspaceId, request)).rejects.toThrow();
  f.ports.provider = { ...f.ports.provider!, supportsRunModel: false };
  await expect(startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(0);
});
test("a changed Provider cannot claim a bounded owner build with a fallback", async () => {
  const f = await ownerFixture();
  const started = await startOwnerBuild(f.ports, f.workspaceId, ownerRequest);
  f.ports.provider = { ...f.ports.provider!, name: "different" };
  expect(await f.api.runs.claimNext("build")).toBeNull();
  expect(await f.db.run.findUniqueOrThrow({ where: { id: started.runId } })).toMatchObject({ status: "failed" });
  expect(f.starts).toHaveLength(0);
});
const cause = { moduleId: "health-module", activationId: "activation-1", incidentId: "incident-1" };
async function otherConversation(f: Awaited<ReturnType<typeof fixture>>) {
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:other", source: "web" } });
  return f.api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Recheck health" });
}

test("same cause across conversations reuses queued/running work before references, budget or queue checks", async () => {
  const f = await fixture(), other = await otherConversation(f);
  const first = await f.start({ ...request, cause }) as { sessionId: string; runId: string };
  await f.governance.update({ dailyLimit: 1 });
  const auditCount = await f.db.audit.count();
  const parsed = buildRequestSchema.parse({ ...request, goal: "Different description", files: ["missing.txt"],
    cause: { incidentId: cause.incidentId, activationId: cause.activationId, moduleId: cause.moduleId } });
  const expected = { sessionId: first.sessionId, runId: first.runId, duplicate: true, reason: "same_cause" };
  expect(await startBuild(f.ports, f.workspaceId, other.id, parsed)).toMatchObject({ ...expected, status: "build_queued" });
  expect(await f.db.audit.count()).toBe(auditCount);
  expect(await f.db.session.count({ where: { source: "build" } })).toBe(1);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
  expect((await f.governance.get()).buildUsage).toMatchObject({ used: 1, remaining: 0 });
  expect((await f.db.audit.findFirstOrThrow({ where: { kind: "build_request" } })).details).toMatchObject({ cause });
  expect(JSON.parse(await readFile(join(f.dataDir, "sessions", first.sessionId, "request.json"), "utf8"))).toMatchObject({ cause });
  await f.api.runs.claimNext("build");
  expect(await startBuild(f.ports, f.workspaceId, other.id, parsed)).toMatchObject({ ...expected, status: "build_running" });
  // A full queue must not hide the outstanding cause either.
  await f.db.run.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ workspaceId: f.workspaceId, sessionId: f.session.id,
    lane: "build", trigger: "build", status: "queued", provider: "fake", tokenHash: `cause-full-${i}`, cwd: "unused", prompt: "" })) });
  expect(await startBuild(f.ports, f.workspaceId, other.id, parsed)).toMatchObject(expected);
  expect(f.starts).toHaveLength(0);
});

test("concurrent admissions from different conversations serialize same-cause deduplication", async () => {
  const f = await fixture(), other = await otherConversation(f);
  const parsed = buildRequestSchema.parse({ ...request, cause });
  const results = await Promise.all([f.requester.id, other.id].map(id => startBuild(f.ports, f.workspaceId, id, parsed)));
  expect(new Set(results.map(result => result.sessionId)).size).toBe(1);
  expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
  expect(await f.db.session.count({ where: { source: "build" } })).toBe(1);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "build_request" } })).toBe(1);
  expect((await f.governance.get()).buildUsage.used).toBe(1);
});

for (const status of ["finished", "failed", "cancelled"] as const) test(`${status} causal work permits a fresh admission`, async () => {
  const f = await fixture();
  const first = await f.start({ ...request, cause }) as { sessionId: string; runId: string };
  await f.db.run.update({ where: { id: first.runId }, data: { status } });
  const next = await f.start({ ...request, cause }) as { sessionId: string; duplicate: boolean };
  expect(next.duplicate).toBe(false);
  expect(next.sessionId).not.toBe(first.sessionId);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.governance.get()).buildUsage.used).toBe(2);
});

test("distinct incidents, activations, topics and modules do not deduplicate", async () => {
  const f = await fixture(), ids = [];
  for (const ref of [cause, { ...cause, incidentId: "incident-2" }, { ...cause, activationId: "activation-2" },
    { ...cause, moduleId: "other-module" }, { moduleId: cause.moduleId, activationId: cause.activationId, topic: "output" }]) {
    const result = await f.start({ ...request, cause: ref }) as { sessionId: string; duplicate: boolean };
    expect(result.duplicate).toBe(false);
    ids.push(result.sessionId);
  }
  expect(new Set(ids).size).toBe(5);
  const topic = { moduleId: cause.moduleId, activationId: cause.activationId, topic: "output" };
  expect(await f.start({ ...request, goal: "Topic recheck", cause: topic })).toMatchObject({ duplicate: true, reason: "same_cause", sessionId: ids[4] });
});

test("without cause identical requests in different conversations still queue separately", async () => {
  const f = await fixture(), other = await otherConversation(f);
  const first = await f.start(request) as { sessionId: string };
  const second = await startBuild(f.ports, f.workspaceId, other.id, buildRequestSchema.parse(request));
  expect(second.duplicate).toBe(false);
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.governance.get()).buildUsage.used).toBe(2);
});

test("owner authorization is independent of a same-target causal build and key replay never retries", async () => {
  const f = await ownerFixture();
  const causal = await f.start({ ...request, cause }) as { sessionId: string };
  const owner = await startOwnerBuild(f.ports, f.workspaceId, ownerRequest);
  expect(owner.duplicate).toBe(false);
  expect(owner.sessionId).not.toBe(causal.sessionId);
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ sessionId: owner.sessionId, runId: owner.runId, duplicate: true });
  await f.db.run.update({ where: { id: owner.runId }, data: { status: "cancelled" } });
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ sessionId: owner.sessionId, runId: owner.runId, duplicate: true, status: "cancelled" });
  await expect(queueBuild(f.ports, f.workspaceId, { key: "invalid-owner-cause", actorKey: "user", originSessionId: null,
    request: buildRequestSchema.parse({ ...request, cause }), execution: ownerRequest.execution })).rejects.toMatchObject({ code: "invalid" });
  await expect(startOwnerBuild(f.ports, f.workspaceId, { ...ownerRequest, cause })).rejects.toThrow();
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.governance.get()).buildUsage.used).toBe(2);
});

test("causes with both incidentId and topic or neither are invalid before admission", async () => {
  const f = await fixture();
  for (const invalid of [{ ...cause, topic: "output" }, { moduleId: cause.moduleId, activationId: cause.activationId }]) {
    expect(buildRequestSchema.safeParse({ ...request, cause: invalid }).success).toBe(false);
    await expect(f.start({ ...request, cause: invalid })).rejects.toMatchObject({ code: "invalid" });
  }
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(0);
  expect((await f.governance.get()).buildUsage.used).toBe(0);
});

test("private build material pins references, SDK files and durable diagnostic authority", async () => {
  const f = await fixture();
  await f.writeModule(join(f.dataDir, "prior"));
  const oldHash = await legacySourceHash(join(f.dataDir, "prior/mail-sort"));
  const oldModule = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: request.name, status: "paused", activeHash: oldHash } });
  await cp(join(f.dataDir, "prior/mail-sort"), join(f.dataDir, "platform/store", oldHash), { recursive: true });
  await f.db.moduleVersion.create({ data: { moduleId: oldModule.id, hash: oldHash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await recordModuleFailure(f.db, { workspaceId: f.workspaceId, moduleId: oldModule.id, hash: oldHash, now: f.ports.now(), retry: false, evidence: {
    phase: "event", reason: "Synthetic test startup failure", runId: "fixture-run", triggerId: "tool:lookup", delivery: "lost", pid: null, exitCode: 134, signal: "SIGABRT", stderr: "Synthetic failure output",
  } });
  await mkdir(f.requester.cwd, { recursive: true });
  await writeFile(join(f.requester.cwd, "mock.png"), "png bytes");
  await f.db.preference.create({ data: { workspaceId: f.workspaceId, text: "Keep cards compact", origin: "said", topic: "ui" } });
  const started = await f.start({ ...request, files: ["mock.png"] });
  expect(started).toMatchObject({ status: "build_queued", queuePosition: 1, aheadCount: 0 });
  expect(await f.start({ ...request, files: ["mock.png"] })).toMatchObject({ sessionId: started.sessionId, duplicate: true });
  expect(await f.db.session.findUniqueOrThrow({ where: { id: started.sessionId } })).toMatchObject({ source: "build", originSessionId: f.session.id, status: "active" });
  const queued = await f.db.run.findUniqueOrThrow({ where: { id: started.runId } });
  expect(queued).toMatchObject({ lane: "build", status: "queued", cwd: join(f.dataDir, "sessions", started.sessionId) });
  expect(queued.prompt).toContain(request.goal);
  expect(queued.prompt).not.toContain("Keep cards compact");
  expect(JSON.parse(await readFile(join(queued.cwd, "request.json"), "utf8"))).toMatchObject({ name: request.name, files: ["files/1-mock.png"] });
  expect(JSON.parse(await readFile(join(queued.cwd, "references/target-diagnostics.json"), "utf8"))).toMatchObject({ evidenceOnly: true, modules: [{ diagnostics: { status: "captured", records: [{ activeHash: oldHash, incidents: [{ evidence: { reason: "Synthetic test startup failure", delivery: "lost" } }] }] } }] });
  expect(queued.prompt).toContain("references/target-diagnostics.json");
  expect(queued.prompt).toContain("evidence only");
  expect(await readFile(join(queued.cwd, "files/1-mock.png"), "utf8")).toBe("png bytes");
  expect((await stat(join(queued.cwd, "node_modules/chrona/sdk.ts"))).mode & 0o222).toBe(0);
  const run = (await f.api.runs.claimNext("build"))!, caller = { kind: "provider", runId: run.id };
  await writeFile(join(run.cwd, "request.json"), JSON.stringify({ name: "other" }));
  expect(await buildDiagnostics(f.ports, f.workspaceId, caller)).toMatchObject([{ module: request.name, activeHash: oldHash, configuredStatus: "paused", incidents: [{ deliveryUnknown: true }] }]);
  await expect(buildDiagnostics(f.ports, f.workspaceId, caller, "other")).rejects.toMatchObject({ code: "forbidden" });
  await expect(buildDiagnostics(f.ports, f.workspaceId, { kind: "provider", runId: f.requester.id })).rejects.toMatchObject({ code: "forbidden" });
  await expect(buildDiagnostics(f.ports, f.workspaceId, { kind: "owner" })).rejects.toMatchObject({ code: "forbidden" });
  const authority = await f.db.audit.findUniqueOrThrow({ where: { id: `build-targets:${started.sessionId}` } });
  await f.db.audit.update({ where: { id: authority.id }, data: { details: { name: [] } } });
  await expect(buildDiagnostics(f.ports, f.workspaceId, caller)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.audit.update({ where: { id: authority.id }, data: { details: { originSessionId: f.session.id, name: request.name } } });
  expect(await declaredModules(f.db, f.workspaceId, started.sessionId)).toEqual([request.name]);
  await f.writeModule(run.cwd);
  const modules = createModules(f.ports, f.workspaceId);
  const proposal = await modules.propose({ root: run.cwd, dir: request.name, intent, allowed: [request.name] }, "build");
  expect(proposal).toMatchObject({ moduleId: oldModule.id, status: "building" });
  await modules.buildPending();
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: oldModule.id, hash: proposal.hash } } })).toMatchObject({ source: "build", status: "approved", report: { tests: expect.any(Array) } });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: oldModule.id } })).toMatchObject({ status: "paused" });
  expect(await modules.propose({ root: run.cwd, dir: request.name, intent, allowed: [request.name] }, "build")).toMatchObject({ hash: proposal.hash, status: "approved" });
  expect(await f.db.message.count({ where: { sessionId: f.session.id } })).toBe(0);
});

test("private multi-module diagnostics require a declared target and fail closed on malformed authority", async () => {
  const f = await fixture();
  const targets = await Promise.all(["first-target", "second-target"].map(name => f.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "paused" } })));
  const outsider = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "outsider" } });
  const started = await f.start({ modules: targets.map(module => module.name), goal: "Repair both modules", intent });
  const run = (await f.api.runs.claimNext("build"))!, caller = { kind: "provider", runId: run.id };
  await expect(buildDiagnostics(f.ports, f.workspaceId, caller)).rejects.toMatchObject({ code: "invalid" });
  await expect(buildDiagnostics(f.ports, f.workspaceId, caller, outsider.id)).rejects.toMatchObject({ code: "forbidden" });
  expect(await buildDiagnostics(f.ports, f.workspaceId, caller, targets[1]!.id)).toMatchObject([{ module: "second-target", moduleId: targets[1]!.id, configuredStatus: "paused" }]);
  expect(await createModules(f.ports, f.workspaceId).health({}, await buildHealthTargets(f.ports, f.workspaceId, caller))).toMatchObject({ items: [{ module: "first-target" }, { module: "second-target" }], nextCursor: null });
  await f.db.audit.update({ where: { id: `build-targets:${started.sessionId}` }, data: { details: { name: "first-target", modules: "malformed" } } });
  await expect(buildDiagnostics(f.ports, f.workspaceId, caller, "first-target")).rejects.toMatchObject({ code: "forbidden" });
  await expect(buildHealthTargets(f.ports, f.workspaceId, caller)).rejects.toMatchObject({ code: "forbidden" });
});

test("private proposals reject public tools without an output contract before executing tests", async () => {
  const f = await fixture();
  await f.writeModule(f.requester.cwd);
  await writeFile(join(f.requester.cwd, "mail-sort/module.json"), JSON.stringify({ ...manifest, tools: [{ name: "read", description: "Read", idempotent: true, visibility: ["modules"], parameters: { type: "object", properties: {} } }] }));
  const modules = createModules(f.ports, f.workspaceId);
  const proposal = await modules.propose({ root: f.requester.cwd, dir: request.name, intent }, "provider");
  expect(proposal.status).toBe("building");
  let executed = 0;
  const run = f.ports.sandbox!.runModule!;
  f.ports.sandbox!.runModule = async input => { executed++; return run(input); };
  await modules.buildPending();
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } })).toMatchObject({ status: "rejected", report: { errors: ["Public tool read must declare an output schema"] } });
  expect(executed).toBe(0);
});

test("retired build routes are absent for owners and providers and grant ordinary modules no authority", async () => {
  const f = await fixture();
  const retired = ["build", "build-owner", "propose", "checkout", "check", "request-group", "build-sessions", "build-session", "build-transcript", "build-settings", "stop-build", "revise-build"];
  const names = retired.map(name => `m_modules_${name.replaceAll("-", "_")}`);
  await f.start(request);
  const run = (await f.api.runs.claimNext("build"))!;
  const ownerTools = (await f.api.modules.tools()).tools.map(tool => tool.name);
  const providerTools = (await f.service.tools.catalog(run.token)).map(tool => tool.name);
  for (const name of names) {
    expect(ownerTools).not.toContain(name);
    expect(providerTools).not.toContain(name);
    await expect(f.api.modules.callTool(name, {})).rejects.toMatchObject({ code: "not_found" });
    await expect(f.service.tools.call(run.token, name, {})).rejects.toMatchObject({ code: "not_found" });
  }
  for (const uses of [retired.map(name => `modules.${name}`), ["*"]]) {
    const other = moduleManifestSchema.parse({ ...manifest, name: uses[0] === "*" ? "star-caller" : "explicit-caller", uses });
    const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: other.name, activeHash: other.name } });
    await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: other.name, manifest: other, source: "user", status: "approved", intent: {}, report: {} } });
    for (const name of retired) {
      expect(await handleModuleCall(f.ports, { workspaceId: f.workspaceId, moduleId: row.id, hash: other.name, manifest: other }, { id: name, method: "call", params: { target: `modules.${name}`, args: {}, mode: "sync", reply: false } })).toMatchObject({ error: { code: "not_found" } });
    }
  }
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
});

test("private build claim snapshots stay fixed after governance changes; revisions take new limits", async () => {
  const f = await fixture();
  await f.governance.update({ maxSubmissions: 1 });
  const started = await f.start(request), run = (await f.api.runs.claimNext("build"))!;
  const snapshot = await f.db.audit.findFirstOrThrow({ where: { kind: "run_claimed", subjectId: run.id } });
  expect(snapshot.details).toMatchObject({ builds: { maxSubmissions: 1 } });
  await f.governance.update({ maxSubmissions: 2 });
  expect(await f.db.audit.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({ details: snapshot.details });
  await f.revise({ session: started.sessionId, requirements: "Continue with new owner budget" });
  const next = (await f.api.runs.claimNext("build"))!;
  expect((await f.db.audit.findFirstOrThrow({ where: { kind: "run_claimed", subjectId: next.id } })).details).toMatchObject({ builds: { maxSubmissions: 2 } });
});

test("private transcripts redact credentials and clip tool results; facts exclude capabilities and host paths", async () => {
  const f = await fixture(), secret = "test-token-" + "never-disclose";
  const previous = process.env.CHRONA_TEST_API_KEY;
  process.env.CHRONA_TEST_API_KEY = secret;
  cleanups.push(async () => { if (previous === undefined) delete process.env.CHRONA_TEST_API_KEY; else process.env.CHRONA_TEST_API_KEY = previous; });
  const started = await f.start(request);
  f.ports.provider!.transcript = async ({ sessionDir }) => {
    expect(sessionDir).toBe(join(f.dataDir, "sessions", started.sessionId, ".chrona/sessions"));
    return [
      { at: "2026-10-25T01:00:01Z", kind: "text", text: "Inspect the tests" },
      { at: "2026-10-25T01:00:01Z", kind: "tool", tool: "bash", args: JSON.stringify({ command: "bun test" }) },
      { at: "2026-10-25T01:00:02Z", kind: "result", tool: "bash", error: true, text: `key ${secret} ${"x".repeat(3000)}` },
    ];
  };
  const items = await readBuildTranscript(f.ports, f.workspaceId, started.sessionId);
  expect(items.map(item => item.kind)).toEqual(["text", "tool", "result"]);
  expect(items[0]).toMatchObject({ text: "Inspect the tests" });
  expect(items[1]).toMatchObject({ tool: "bash", args: '{"command":"bun test"}' });
  const result = items[2] as { text: string; error: boolean };
  expect(result.error).toBe(true);
  expect(result.text).not.toContain(secret);
  expect(result.text.length).toBeLessThan(2100);
  expect(await sessionTranscript(f.ports, started.sessionId)).toEqual(items);
  const facts = await readBuildFacts(f.ports, f.workspaceId, started.sessionId);
  expect(facts).toMatchObject({ targets: [request.name], queue: { status: "build_queued" } });
  for (const key of ["cwd", "prompt", "token", "tokenHash", "hostPaths"]) expect(facts.runs[0]).not.toHaveProperty(key);
  const other = await f.db.workspace.create({ data: { name: "other" } });
  for (const read of [readBuildFacts, readBuildTranscript]) {
    await expect(read(f.ports, other.id, started.sessionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(read(f.ports, f.workspaceId, f.session.id)).rejects.toMatchObject({ code: "not_found" });
  }
  await f.db.audit.create({ data: { id: `agent-context:${started.sessionId}`, workspaceId: f.workspaceId, kind: "agent_context", actorKey: "test", subjectId: started.sessionId, details: {} } });
  for (const read of [readBuildFacts, readBuildTranscript]) await expect(read(f.ports, f.workspaceId, started.sessionId)).rejects.toMatchObject({ code: "not_found" });
});

/** Exercise retained group review internals with validated, immutable module material. */
async function groupBuild(f: Awaited<ReturnType<typeof fixture>>, includeImpact = false) {
  const names = ["mail-sort", "mail-tag"];
  await expect(f.start({ ...request, modules: ["mail-sort"] })).rejects.toMatchObject({ code: "invalid" });
  const started = await f.start({ goal: request.goal, intent, modules: names });
  expect(await f.db.session.findUniqueOrThrow({ where: { id: started.sessionId } })).toMatchObject({ title: "构建模块 mail-sort、mail-tag" });
  const run = (await f.api.runs.claimNext("build"))!, modules = createModules(f.ports, f.workspaceId);
  const allowed = (await declaredModules(f.db, f.workspaceId, started.sessionId))!;
  const write = async (name: string) => {
    await mkdir(join(run.cwd, name), { recursive: true });
    const tools = includeImpact && name === "mail-sort" ? [{ name: "read", description: "Read", idempotent: true, visibility: ["modules"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false } }] : [];
    await writeFile(join(run.cwd, name, "module.json"), JSON.stringify({ ...manifest, name, tools, secrets: ["mail_account"] }));
    await writeFile(join(run.cwd, name, "index.ts"), 'import { on } from "chrona"; on("tool", () => ({ result: { value: 1 } }));');
    await writeFile(join(run.cwd, name, "test.ts"), "export {};");
  };
  await write("other-app");
  await expect(modules.propose({ root: run.cwd, dir: "other-app", intent, allowed }, "build")).rejects.toMatchObject({ code: "forbidden" });
  const hashes: Record<string, string> = {};
  for (const name of names) {
    await write(name);
    const proposal = await modules.propose({ root: run.cwd, dir: name, intent, allowed }, "build");
    expect(proposal.status).toBe("building");
    hashes[name] = proposal.hash;
    // The retained private proposal primitive accepts source material; its caller records the owning build.
    await f.db.audit.create({ data: { workspaceId: f.workspaceId, kind: "module_submission", actorKey: `provider:${run.id}`, subjectId: proposal.moduleId!, details: { hash: proposal.hash, sessionId: started.sessionId } } });
  }
  await modules.buildPending();
  for (const name of names) expect(await f.db.moduleVersion.findFirstOrThrow({ where: { hash: hashes[name], module: { workspaceId: f.workspaceId, name } } })).toMatchObject({ status: "pending_review" });
  expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
  await expect(requestGroup(f.ports, f.workspaceId, started.sessionId, [{ module: "mail-sort", hash: hashes["mail-sort"]! }, { module: "other-app", hash: hashes["mail-sort"]! }])).rejects.toMatchObject({ code: "invalid" });
  const group = await requestGroup(f.ports, f.workspaceId, started.sessionId, names.map(module => ({ module, hash: hashes[module]! })));
  expect(await f.db.module.count({ where: { name: "other-app" } })).toBe(0);
  const approval = await f.db.approval.findUniqueOrThrow({ where: { id: group.approvalId! } });
  return { approval, hashes };
}

test("group approval preview lists current consumers affected by member output changes", async () => {
  const f = await fixture();
  const schema = (type: string) => ({ type: "object", properties: { value: { type } }, required: ["value"], additionalProperties: false });
  const active = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort", status: "active", dataSchema: 1 } });
  const oldManifest = moduleManifestSchema.parse({ ...manifest, name: "mail-sort", tools: [{ name: "read", description: "Read", visibility: ["modules"], parameters: { type: "object", properties: {}, required: [] }, output: schema("string") }] });
  const oldStore = join(f.dataDir, "platform/store/old"); await mkdir(oldStore, { recursive: true });
  await writeFile(join(oldStore, "module.json"), JSON.stringify(oldManifest));
  await writeFile(join(oldStore, "index.ts"), 'import { on } from "chrona"; on("tool", () => ({ result: { value: "ok" } }));');
  await writeFile(join(oldStore, "test.ts"), "export {};");
  const oldHash = await legacySourceHash(oldStore);
  await rename(oldStore, join(f.dataDir, "platform/store", oldHash));
  await f.db.module.update({ where: { id: active.id }, data: { activeHash: oldHash } });
  await f.db.moduleVersion.create({ data: { moduleId: active.id, hash: oldHash, manifest: oldManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const caller = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-reader", status: "active", activeHash: "reader", dataSchema: 1 } });
  await f.db.moduleVersion.create({ data: { moduleId: caller.id, hash: "reader", manifest: moduleManifestSchema.parse({ ...manifest, name: "mail-reader", uses: ["mail-sort.read"] }), source: "user", status: "approved", intent: {}, report: {} } });
  const { approval } = await groupBuild(f, true);
  expect(approval.preview).toContain("mail-reader：mail-sort.read");
});

test("a build of several modules submits only those and asks for one approval that activates them together", async () => {
  const f = await fixture(), { approval, hashes } = await groupBuild(f);
  expect(approval).toMatchObject({ action: "activate_module", moduleId: null, status: "open", title: "一起启用模块 mail-sort、mail-tag" });
  expect(approval.preview).toContain("【mail-sort】"); expect(approval.preview).toContain("【mail-tag】");
  const body = approvalNoticeBody(approval);
  expect(body).toContain("这组改动一起启用"); expect(body).not.toContain("--- active");
  await expect(f.api.approvals.resolve(approval.id, { decision: "approve", scope: "always" }, "web")).rejects.toMatchObject({ code: "invalid" });
  const generations = await f.db.generation.count();
  await f.api.approvals.resolve(approval.id, { decision: "approve", scope: "once" }, "web");
  for (const name of ["mail-sort", "mail-tag"]) expect(await f.db.module.findFirstOrThrow({ where: { name } })).toMatchObject({ activeHash: hashes[name], status: "active" });
  expect(await f.db.generation.count()).toBe(generations + 1);
});

test("a rejected group member prevents activation of every member", async () => {
  const f = await fixture(), { approval, hashes } = await groupBuild(f);
  const tag = await f.db.module.findFirstOrThrow({ where: { name: "mail-tag" } });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: tag.id, hash: hashes["mail-tag"]! } }, data: { status: "rejected" } });
  await expect(f.api.approvals.resolve(approval.id, { decision: "approve", scope: "once" }, "web")).rejects.toMatchObject({ code: "conflict" });
  expect((await f.db.module.findMany({ where: { name: { in: ["mail-sort", "mail-tag"] } } })).map(row => row.activeHash)).toEqual([null, null]);
});

test("a new candidate of one member expires the group approval", async () => {
  const f = await fixture(), { approval } = await groupBuild(f);
  await mkdir(join(f.requester.cwd, "mail-tag"), { recursive: true });
  await writeFile(join(f.requester.cwd, "mail-tag", "module.json"), JSON.stringify({ ...manifest, name: "mail-tag" }));
  await writeFile(join(f.requester.cwd, "mail-tag", "index.ts"), 'import { on } from "chrona"; on("tool", () => ({ result: { changed: true } }));');
  await writeFile(join(f.requester.cwd, "mail-tag", "test.ts"), "process.exit(0)");
  await createModules(f.ports, f.workspaceId).propose({ root: f.requester.cwd, dir: "mail-tag", intent }, "provider");
  await createModules(f.ports, f.workspaceId).buildPending();
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("expired");
});

test("private revisions preserve work and require every reference before cancelling the running build", async () => {
  const f = await fixture(), started = await f.start(request), old = (await f.api.runs.claimNext("build"))!;
  await writeFile(join(old.cwd, "draft.txt"), "retained draft");
  await mkdir(f.requester.cwd, { recursive: true });
  await expect(f.revise({ session: started.sessionId, requirements: "Add references", files: ["missing.txt"] })).rejects.toMatchObject({ code: "not_found" });
  await expect(buildControl(f.ports, f.workspaceId, { kind: "owner", via: null }, "revise-build", { session: started.sessionId, requirements: "Add references", files: ["private.txt"] })).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "running" });
  await writeFile(join(f.requester.cwd, "interface.txt"), "supplemental fixture, not production data");
  await f.revise({ session: started.sessionId, requirements: "Use the supplied contract", files: ["interface.txt"] });
  await expect(f.service.tools.catalog(old.token)).rejects.toThrow();
  expect(await readFile(join(old.cwd, "draft.txt"), "utf8")).toBe("retained draft");
  const saved = JSON.parse(await readFile(join(old.cwd, "request.json"), "utf8"));
  expect(saved.files).toHaveLength(1);
  expect(saved.files[0]).toMatch(/^files\/revision-[a-f0-9-]+\/1-interface\.txt$/);
  expect(await readFile(join(old.cwd, saved.files[0]), "utf8")).toBe("supplemental fixture, not production data");
  const next = (await f.api.runs.claimNext("build"))!;
  expect(next.cwd).toBe(old.cwd);
  expect(next.prompt).toContain(saved.files[0]);
  expect((await f.governance.get()).buildUsage.used).toBe(1);
  expect(f.starts).toHaveLength(0);
});

test("private checkout preserves customization and proposals freeze valid source before checks", async () => {
  const f = await fixture(), modules = createModules(f.ports, f.workspaceId);
  await f.writeModule(f.requester.cwd);
  await writeFile(join(f.requester.cwd, "mail-sort/app.js"), "// custom layout");
  const original = await modules.propose({ root: f.requester.cwd, dir: request.name, intent }, "provider");
  await modules.buildPending();
  const started = await f.start(request), run = (await f.api.runs.claimNext("build"))!;
  await expect(modules.checkout(original.moduleId!, original.hash, "../escape", run.cwd)).rejects.toThrow();
  await modules.checkout(original.moduleId!, undefined, "active-latest", run.cwd);
  expect(await readFile(join(run.cwd, "active-latest/app.js"), "utf8")).toBe("// custom layout");
  await cp(join(run.cwd, "active-latest"), join(run.cwd, "candidate"), { recursive: true });
  await writeFile(join(run.cwd, "candidate/app.js"), "// custom layout\n// external feature");
  const proposal = await modules.propose({ root: run.cwd, dir: "candidate", intent, allowed: [request.name] }, "build");
  expect(proposal.status).toBe("building");
  await writeFile(join(run.cwd, "candidate/app.js"), "// unsubmitted mutation");
  await rm(join(run.cwd, "candidate"), { recursive: true });
  await modules.buildPending();
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId!, hash: proposal.hash } } })).toMatchObject({ status: "approved" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: original.moduleId! } })).toMatchObject({ activeHash: proposal.hash });
  await modules.checkout(proposal.moduleId!, proposal.hash, "checked-result", run.cwd);
  expect(await readFile(join(run.cwd, "checked-result/app.js"), "utf8")).toBe("// custom layout\n// external feature");
  expect(JSON.parse(await readFile(join(run.cwd, "request.json"), "utf8")).files).toEqual([]);
  expect(await readBuildFacts(f.ports, f.workspaceId, started.sessionId)).toMatchObject({ targets: [request.name] });
});

test("private queue and run facts report database outcomes without kernel-authored status prose", async () => {
  const f = await fixture(), first = await f.start(request), second = await f.start({ ...request, name: "second" });
  expect(await readBuildFacts(f.ports, f.workspaceId, second.sessionId)).toMatchObject({ queue: { status: "build_queued", queuePosition: 2 } });
  expect((await f.api.provider.list(second.sessionId))[0]).toMatchObject({ active: false, status: "queued", progress: null });
  await f.stop(first.sessionId);
  expect(await readBuildFacts(f.ports, f.workspaceId, first.sessionId)).toMatchObject({ queue: null, runs: [{ status: "cancelled" }] });
  expect(await readBuildFacts(f.ports, f.workspaceId, second.sessionId)).toMatchObject({ queue: { queuePosition: 1 } });
  const running = (await f.api.runs.claimNext("build"))!;
  expect(await readBuildFacts(f.ports, f.workspaceId, second.sessionId)).toMatchObject({ queue: { status: "build_running" } });
  for (const status of ["finished", "failed", "timed_out", "provider_unavailable"]) {
    await f.db.run.update({ where: { id: running.id }, data: { status } });
    expect(await readBuildFacts(f.ports, f.workspaceId, second.sessionId)).toMatchObject({ queue: null, runs: [{ status }] });
  }
  expect(await f.db.message.count({ where: { sessionId: f.session.id, direction: "out" } })).toBe(0);
  expect(await f.db.audit.count({ where: { kind: "kernel_fact_pending", subjectId: `session-result:${running.id}` } })).toBe(0);
  expect(f.starts).toHaveLength(0);
});
