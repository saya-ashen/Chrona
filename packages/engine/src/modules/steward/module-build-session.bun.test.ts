import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readModuleFiles } from "./module-preview";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, modulesToolInputSchemas, type ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { createTick } from "./tick";
import type { StewardPorts } from "./ports";
import { testModuleSandbox } from "./module-test-process";
import { testDb } from "./test-db";
import { createModules } from "./modules";
import { handleModuleCall } from "./module-effects";
import { sessionTranscript } from "./transcript";
import { liveRuns } from "./runs";
import { moduleSupervisor } from "./module-supervisor";
import * as chatFiles from "./chat";
import { approvalNoticeBody } from "./builtin/notify/approval";
import { startOwnerBuild } from "./owner-build";
import { runOwnerBuild } from "./owner-build-run";
import { controlBuild, queueBuild, startBuild } from "./module-build-session";
import { recordModuleFailure } from "./module-diagnostics";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function legacySourceHash(dir: string) {
  const digest = createHash("sha256");
  for (const file of (await readModuleFiles(dir, "Unsafe fixture source")).sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  return digest.digest("hex");
}
const intent = { changes: ["Sort shop mail without the model"], preserves: [] };
const request = { name: "mail-sort", goal: "Mark mail from *@shop.example handled", examples: ["from a@shop.example → handled"], intent };
const manifest = { name: "mail-sort", entry: "index.ts", triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], effects: [], tests: ["test.ts"] };
type Run = (input: ProviderRunInput, call: (name: string, args: unknown, options?: { timeoutSeconds?: number }) => Promise<unknown>) => Promise<void>;

/** A real service and tick with a scripted Provider; one web conversation with a running foreground run. */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-build-session-"));
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const starts: ProviderRunInput[] = [], pending: Promise<unknown>[] = [];
  let script: Run = async () => {};
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null,
    moduleSdk: fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk", import.meta.url)),
    sandbox: { available: true, isolated: true, async runModule() { return { status: "succeeded", output: '{"effects":[]}', error: null, exitCode: 0 }; } },
    provider: { name: "fake", async health() { return { available: true, sandboxed: true, error: null }; }, start(input) {
      starts.push(input);
      const done = script(input, async (name, args, options) => {
        const answer = await service.tools.call(input.token, name, args, options) as { result?: unknown };
        return name.startsWith("m_") ? answer.result : answer;
      }).then(() => ({ outcome: "finished" as const, sessionId: `pi-${input.runId}`, error: null }));
      pending.push(done);
      return { async inject() {}, async abort() {}, done };
    } },
  };
  ports.sandbox!.startModule = testModuleSandbox(input => ports.sandbox!.runModule!(input)).startModule;
  const service = createStewardService(ports);
  const workspaceId = (await db.workspace.create({ data: { name: "build" } })).id, api = service.forWorkspace(workspaceId);
  const session = await db.session.create({ data: { workspaceId, key: "web:build", source: "web" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Sort mail" });
  const requester = (await api.runs.claimNext("foreground"))!;
  const tick = createTick(ports);
  async function step() {
    await tick();
    await Promise.all(pending.splice(0));
    // Await finalization and reply delivery, not only the Provider or the run status write.
    await tick.settled({ includeRuns: true });
  }
  async function writeModule(cwd: string) {
    await mkdir(join(cwd, "mail-sort"), { recursive: true });
    await writeFile(join(cwd, "mail-sort", "module.json"), JSON.stringify(manifest));
    await writeFile(join(cwd, "mail-sort", "index.ts"), 'import { on } from "chrona"; on("schedule", async () => ({}));');
    await writeFile(join(cwd, "mail-sort", "test.ts"), "process.exit(0)");
  }
  // Module tools (m_*) answer { result }, like any app's tools.
  const call = async (name: string, args: unknown, options?: { timeoutSeconds?: number }) => {
    const answer = await service.tools.call(requester.token, name, args, options) as { result?: unknown };
    return name.startsWith("m_") ? answer.result : answer;
  };
  return { db, dataDir, ports, service, api, workspaceId, session, requester, starts, step, writeModule, call, onRun: (next: Run) => { script = next; } };
}

test("a build is its own conversation: scoped diagnostics, restricted tools, submission and reply", async () => {
  const f = await fixture();
  await f.writeModule(join(f.dataDir, "prior"));
  const oldHash = await legacySourceHash(join(f.dataDir, "prior", "mail-sort")), oldModule = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail-sort", status: "paused", activeHash: oldHash } });
  await cp(join(f.dataDir, "prior", "mail-sort"), join(f.dataDir, "platform", "store", oldHash), { recursive: true });
  await f.db.moduleVersion.create({ data: { moduleId: oldModule.id, hash: oldHash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await recordModuleFailure(f.db, { workspaceId: f.workspaceId, moduleId: oldModule.id, hash: oldHash, now: new Date(), retry: false, evidence: {
    phase: "start", reason: "Synthetic test startup failure", runId: "fixture-run", triggerId: "process", delivery: "unavailable", pid: null, exitCode: 134, signal: "SIGABRT", stderr: "Synthetic failure output", virtualMemoryMb: 512,
  } });
  await mkdir(f.requester.cwd, { recursive: true });
  await writeFile(join(f.requester.cwd, "mock.png"), "png bytes");
  await f.db.preference.create({ data: { workspaceId: f.workspaceId, text: "卡片紧凑，少用边框", origin: "said", topic: "ui" } });
  const started = await f.call("m_modules_build", { ...request, files: ["mock.png"] }) as { status: string; sessionId: string };
  expect(started).toMatchObject({ status: "build_queued", queuePosition: 1, aheadCount: 0 });
  expect(await f.call("m_modules_build", { ...request, files: ["mock.png"] })).toMatchObject({ sessionId: started.sessionId, duplicate: true });

  const build = await f.db.session.findUniqueOrThrow({ where: { id: started.sessionId } });
  expect(build).toMatchObject({ source: "build", originSessionId: f.session.id, title: "构建模块 mail-sort", status: "active" });
  const queued = await f.db.run.findFirstOrThrow({ where: { sessionId: build.id } });
  expect(queued).toMatchObject({ lane: "build", status: "queued", cwd: join(f.dataDir, "sessions", build.id) });
  for (const text of [request.goal, "卡片紧凑，少用边框", "m_modules_propose", "m_modules_check", "chrona_reply"]) expect(queued.prompt).toContain(text);
  expect(JSON.parse(await readFile(join(queued.cwd, "request.json"), "utf8"))).toMatchObject({ name: "mail-sort", files: ["files/1-mock.png"] });
  expect(JSON.parse(await readFile(join(queued.cwd, "references/target-diagnostics.json"), "utf8"))).toMatchObject({ evidenceOnly: true, modules: [{ diagnostics: { status: "captured", records: [{ activeHash: oldHash, incidents: [{ evidence: { reason: "Synthetic test startup failure" } }] }] } }] });
  expect(queued.prompt).toContain("references/target-diagnostics.json");
  expect(queued.prompt).toContain("evidence only");
  expect(await readFile(join(queued.cwd, "files", "1-mock.png"), "utf8")).toBe("png bytes");
  expect((await stat(join(queued.cwd, "node_modules", "chrona", "sdk.ts"))).mode & 0o222).toBe(0);
  // Nobody can talk into a build conversation.
  await expect(f.api.chat.handleMessage({ sessionId: build.id, text: "也加上周报", channel: "in_app" })).rejects.toMatchObject({ code: "forbidden" });

  let report: { status?: string; report?: unknown } = {};
  f.onRun(async (input, call) => {
    expect(input).toMatchObject({ lane: "build", cwd: queued.cwd, extraTools: ["m_modules_propose", "m_modules_check", "m_modules_checkout", "m_modules_reference", "m_modules_diagnostics", "m_modules_health", "m_modules_request_group"] });
    expect(input).toMatchObject({ searchTools: true });
    // App tools as in a conversation; of Chrona's own tools only chrona_reply.
    const catalog = (await f.service.tools.catalog(input.token)).map(tool => tool.name);
    expect(catalog).toEqual(expect.arrayContaining(["chrona_reply", "m_modules_propose", "m_modules_request_group", "m_modules_list"]));
    expect(catalog.filter(name => name.startsWith("chrona_"))).toEqual(["chrona_reply"]);
    await expect(call("chrona_schedule", {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(call("m_modules_build", request)).rejects.toMatchObject({ code: "forbidden" });
    await writeFile(join(input.cwd, "request.json"), JSON.stringify({ name: "other" }));
    const diagnostic = await call("m_modules_diagnostics", {}) as { module: string; activeHash: string; incidents: { evidence: { reason: string } }[] }[];
    expect(diagnostic).toMatchObject([{ module: "mail-sort", activeHash: oldHash, configuredStatus: "paused", incidents: [{ evidence: { reason: "Synthetic test startup failure" } }] }]);
    await expect(call("m_modules_diagnostics", { module: "other" })).rejects.toMatchObject({ code: "forbidden" });
    const authority = await f.db.audit.findUniqueOrThrow({ where: { id: `build-targets:${build.id}` } });
    await f.db.audit.update({ where: { id: authority.id }, data: { details: { name: [] } } });
    await expect(call("m_modules_diagnostics", {})).rejects.toMatchObject({ code: "forbidden" });
    await f.db.audit.update({ where: { id: authority.id }, data: { details: { originSessionId: f.session.id, name: request.name } } });
    const reference = await call("m_modules_reference", { target: "modules.diagnostics" });
    expect(reference).toMatchObject({ outputSchema: { type: "array" }, examples: expect.any(Array), admission: { visibility: ["modules", "provider", "owner"] } });
    expect(input.prompt).toContain("Development references");
    await f.writeModule(input.cwd);
    const proposal = await call("m_modules_propose", { dir: "mail-sort", intent }) as { hash: string; status: string };
    expect(proposal.status).toBe("building");
    await createModules(f.ports, f.workspaceId).buildPending();
    report = await call("m_modules_check", { module: "mail-sort", hash: proposal.hash }) as typeof report;
    await call("chrona_reply", { text: `构建完成：mail-sort ${proposal.hash.slice(0, 8)} 待你批准` });
  });
  await f.step();
  expect(f.starts.map(input => input.lane)).toEqual(["build"]);
  expect(report).toMatchObject({ status: "approved", active: false, report: { tests: expect.any(Array) } });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: oldModule.id } })).toMatchObject({ status: "paused" });
  const version = await f.db.moduleVersion.findFirstOrThrow({ where: { source: "build" } });
  expect(version).toMatchObject({ source: "build", status: "approved" });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "module_submission" } })).toMatchObject({ details: { hash: version.hash, sessionId: build.id } });
  // The reply went back to the web conversation that asked.
  expect((await f.db.message.findMany({ where: { sessionId: f.session.id } })).map(m => m.text)).toEqual([`构建完成：mail-sort ${version.hash.slice(0, 8)} 待你批准\n\n未启用：mail-sort 该版本当前未启用`]);
});

for (const scenario of ["active", "approval", "failed", "empty", "long", "latest-failed", "invalid-last", "unrelated"] as const) test(`build completion reports database outcome: ${scenario}`, async () => {
  const f = await fixture();
  const started = await f.call("m_modules_build", request) as { sessionId: string };
  let expected = "未启用：本次构建未提交版本";
  const reply = scenario === "long" ? "尚未启用，仍需你确认".repeat(700) : "尚未启用，仍需你确认";
  f.onRun(async (input, call) => {
    if (scenario !== "empty") {
      await f.writeModule(input.cwd);
      if (scenario === "approval") await writeFile(join(input.cwd, "mail-sort/module.json"), JSON.stringify({ ...manifest, secrets: ["mail_account"] }));
      if (scenario === "latest-failed" || scenario === "invalid-last") {
        await call("m_modules_propose", { dir: "mail-sort", intent });
        await createModules(f.ports, f.workspaceId).buildPending();
        await writeFile(join(input.cwd, "mail-sort/test.ts"), "process.exit(1)");
      }
      if (scenario === "invalid-last") await writeFile(join(input.cwd, "mail-sort/module.json"), "{");
      const failed = scenario === "failed" || scenario === "latest-failed" || scenario === "invalid-last";
      if (failed) f.ports.sandbox!.runModule = async () => ({ status: "failed", output: "", error: "Fixture check failure", exitCode: 1 });
      const proposal = await call("m_modules_propose", { dir: "mail-sort", intent }) as { hash: string };
      await createModules(f.ports, f.workspaceId).buildPending();
      const status = scenario === "approval" ? "pending_approval" : failed ? "failed" : "active";
      if (scenario !== "invalid-last") expect(await call("m_modules_check", { module: "mail-sort", hash: proposal.hash })).toMatchObject({ status, active: status === "active" });
      expected = status === "active" ? `已启用：mail-sort 版本 ${proposal.hash.slice(0, 8)}`
        : status === "pending_approval" ? "等待你确认：此版本需要新的凭据（网页「待你决定」）" : "未启用：mail-sort 版本检查未通过或已被撤回";
      if (scenario === "invalid-last") expected = "未启用：最后提交的版本未通过检查";
      if (status === "active") expect(await call("m_modules_propose", { dir: "mail-sort", intent })).toMatchObject({ status: "active", active: true, hash: proposal.hash });
      if (scenario === "unrelated") {
        await f.writeModule(f.requester.cwd);
        await writeFile(join(f.requester.cwd, "mail-sort/test.ts"), "process.exit(1)");
        await f.call("m_modules_propose", { dir: "mail-sort", intent });
      }
    }
    await call("chrona_reply", { text: reply });
  });
  await f.step();
  const buildRun = await f.db.run.findFirstOrThrow({ where: { sessionId: started.sessionId, lane: "build" } });
  const notice = await f.db.moduleInvocation.findFirstOrThrow({ where: { key: `notify:session-result:${buildRun.id}` } });
  const body = JSON.parse((notice.args as { facts: string }).facts).body as string;
  expect(body.endsWith(expected)).toBe(true);
  expect(body.length).toBeLessThanOrEqual(4000);
  expect(body).toStartWith("尚未启用，仍需你确认");
  const report = await f.db.message.findFirstOrThrow({ where: { sessionId: f.session.id, direction: "out" } });
  expect(report.text).toBe(`${reply}\n\n${expected}`);
  const wake = await f.db.run.findFirstOrThrow({ where: { sessionId: f.session.id, trigger: "build" } });
  expect(wake.prompt).toContain(JSON.stringify(expected).slice(1, -1));
  expect(wake.prompt).toContain("no new authorization");
});

test("multi-module build diagnostics require one declared target and accept its id", async () => {
  const f = await fixture();
  const targets = await Promise.all(["first-target", "second-target"].map(name => f.db.module.create({ data: { workspaceId: f.workspaceId, name, status: "paused" } })));
  const outsider = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "outsider", status: "paused" } });
  const started = await f.call("m_modules_build", { modules: targets.map(module => module.name), goal: "Repair both modules", intent }) as { sessionId: string };
  const run = (await f.api.runs.claimNext("build"))!;
  const call = async (args: unknown) => (await f.service.tools.call(run.token, "m_modules_diagnostics", args) as { result: unknown }).result;
  await expect(call({})).rejects.toMatchObject({ code: "invalid" });
  await expect(call({ module: outsider.id })).rejects.toMatchObject({ code: "forbidden" });
  expect(await call({ module: targets[1]!.id })).toMatchObject([{ module: "second-target", moduleId: targets[1]!.id, configuredStatus: "paused" }]);
  const health = async () => (await f.service.tools.call(run.token, "m_modules_health", {}) as { result: unknown }).result;
  expect(await health()).toMatchObject({ items: [{ module: "first-target" }, { module: "second-target" }], nextCursor: null });
  expect((await health() as { items: unknown[] }).items).toHaveLength(2);
  const receipt = await f.db.audit.findUniqueOrThrow({ where: { id: `build-targets:${started.sessionId}` } });
  await f.db.audit.update({ where: { id: receipt.id }, data: { details: { name: "first-target", modules: "malformed" } } });
  await expect(call({ module: "first-target" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(health()).rejects.toMatchObject({ code: "forbidden" });
});

test("a candidate with a public tool missing output is rejected before tests run", async () => {
  const f = await fixture();
  await mkdir(f.requester.cwd, { recursive: true });
  await f.writeModule(f.requester.cwd);
  const manifestPath = join(f.requester.cwd, "mail-sort", "module.json");
  const candidate = JSON.parse(await readFile(manifestPath, "utf8"));
  candidate.tools = [{ name: "read", description: "Read", visibility: ["modules"], parameters: { type: "object", properties: {}, required: [] } }];
  await writeFile(manifestPath, JSON.stringify(candidate));
  const proposal = await f.call("m_modules_propose", { dir: "mail-sort", intent }) as { moduleId: string; hash: string };
  let executed = 0;
  const run = f.ports.sandbox!.runModule!;
  f.ports.sandbox!.runModule = async input => { executed++; return run(input); };
  await createModules(f.ports, f.workspaceId).buildPending();
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: proposal.moduleId, hash: proposal.hash } } });
  expect(version).toMatchObject({ status: "rejected", report: { errors: ["Public tool read must declare an output schema"] } });
  expect(executed).toBe(0);
});

test("module management: Provider tools stay private; owner-only tools require uses star", async () => {
  const f = await fixture();
  await expect(f.call("m_modules_checkout", { module: "mail-sort", dir: "../escape" })).rejects.toThrow();
  await mkdir(f.requester.cwd, { recursive: true });
  await f.writeModule(f.requester.cwd);
  const proposal = await f.call("m_modules_propose", { dir: "mail-sort", intent }) as { hash: string };
  // The owner gets an explicit bounded-build entry, never Provider propose/checkout/unbounded build.
  const owner = (await f.api.modules.tools()).tools.map(tool => tool.name).filter(name => name.startsWith("m_modules_"));
  expect(owner).toEqual(["m_modules_catalog", "m_modules_install", "m_modules_upstream", "m_modules_diagnostics", "m_modules_health", "m_modules_system", "m_modules_overview", "m_modules_settings_set", "m_modules_permissions", "m_modules_check", "m_modules_rollback", "m_modules_disable", "m_modules_enable", "m_modules_remove", "m_modules_build_owner", "m_modules_stop_build", "m_modules_revise_build"]);
  expect(await f.api.modules.callTool("m_modules_check", { module: "mail-sort" })).toMatchObject({ result: { hash: proposal.hash, status: "building" } });
  await expect(f.api.modules.callTool("m_modules_propose", { dir: "mail-sort", intent })).rejects.toMatchObject({ code: "not_found" });
  // Explicit targets in uses do not grant access to Provider or owner-only tools.
  const other = moduleManifestSchema.parse({ name: "other", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses: ["modules.propose", "modules.build", "modules.stop-build", "modules.revise-build"] });
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "other", activeHash: "o" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "o", manifest: other, source: "user", intent: {}, report: {}, status: "approved" } });
  for (const target of ["modules.propose", "modules.build", "modules.checkout", "modules.stop-build", "modules.revise-build"]) {
    expect(await handleModuleCall(f.ports, { workspaceId: f.workspaceId, moduleId: module.id, hash: "o", manifest: other }, { id: "1", method: "call", params: { target, args: {}, mode: "sync", reply: false } })).toMatchObject({ error: { code: "forbidden" } });
  }
});

test("stop/revise tools keep build files, cancel old capabilities and continue with new requirements in the same session", async () => {
  const f = await fixture();
  const { sessionId } = await f.call("m_modules_build", request) as { sessionId: string };
  const old = (await f.api.runs.claimNext("build"))!;
  await writeFile(join(old.cwd, "draft.txt"), "keep this work");
  await expect(f.api.modules.callTool("m_modules_revise_build", { session: sessionId, requirements: "  " })).rejects.toThrow();
  expect((await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("running");
  const revised = await f.api.modules.callTool("m_modules_revise_build", { session: sessionId, requirements: "只标记，不删除邮件" });
  expect(revised).toMatchObject({ result: { status: "build_revised", sessionId } });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("cancelled");
  await expect(f.service.tools.catalog(old.token)).rejects.toThrow();
  const next = await f.db.run.findFirstOrThrow({ where: { sessionId, status: "queued" } });
  expect(next.cwd).toBe(old.cwd);
  expect(next.prompt).toContain("只标记，不删除邮件");
  expect(await readFile(join(old.cwd, "draft.txt"), "utf8")).toBe("keep this work");
  expect(JSON.parse(await readFile(join(old.cwd, "request.json"), "utf8")).revisedRequirements).toBe("只标记，不删除邮件");
  expect(await f.db.message.findFirst({ where: { sessionId, direction: "in" } })).toMatchObject({ text: "只标记，不删除邮件" });
  await f.call("m_modules_stop_build", { session: sessionId });
  await f.call("m_modules_stop_build", { session: sessionId });
  expect(await f.db.run.count({ where: { sessionId, status: { in: ["queued", "running"] } } })).toBe(0);
  expect(await f.db.run.count({ where: { sessionId } })).toBe(2);
  await expect(f.call("m_modules_stop_build", { session: f.session.id })).rejects.toThrow();
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(f.service.forWorkspace(other.id).modules.callTool("m_modules_stop_build", { session: sessionId })).rejects.toThrow();
  // A stopped build can queue behind another without running alongside it.
  const second = await f.call("m_modules_build", request) as { sessionId: string };
  expect(await f.call("m_modules_revise_build", { session: sessionId, requirements: "继续" })).toMatchObject({ status: "build_revised", queuePosition: 2, aheadCount: 1 });
  await f.call("m_modules_stop_build", { session: second.sessionId });
  await Promise.all(["新要求一", "新要求二"].map(requirements => f.call("m_modules_revise_build", { session: sessionId, requirements })));
  expect(await f.db.run.count({ where: { sessionId, status: { in: ["queued", "running"] } } })).toBe(1);
});

test("revision waits for abort before reusing the directory; abort failure never queues replacement work", async () => {
  const f = await fixture();
  const { sessionId } = await f.call("m_modules_build", request) as { sessionId: string };
  const old = (await f.api.runs.claimNext("build"))!;
  cleanups.push(async () => { liveRuns.delete(old.id); });
  let aborted = false;
  liveRuns.set(old.id, { async inject() {}, async abort() {
    expect(await f.db.run.count({ where: { sessionId, status: "queued" } })).toBe(0);
    await Bun.sleep(20);
    aborted = true;
    throw new Error("abort failed");
  }, done: Promise.resolve({ outcome: "failed", sessionId: null, error: "aborted" }) });
  await expect(f.call("m_modules_revise_build", { session: sessionId, requirements: "new goal" })).rejects.toThrow("abort failed");
  expect(aborted).toBe(true);
  expect(await f.db.run.count({ where: { sessionId } })).toBe(1);
  liveRuns.set(old.id, { async inject() {}, async abort() { await Bun.sleep(20); }, done: Promise.resolve({ outcome: "failed", sessionId: null, error: "aborted" }) });
  expect(await f.call("m_modules_revise_build", { session: sessionId, requirements: "new goal" })).toMatchObject({ status: "build_revised" });
  expect(await f.db.run.count({ where: { sessionId, status: "queued" } })).toBe(1);
});

test("uses star discovers owner build controls, while ordinary modules cannot discover owner-only tools", async () => {
  const f = await fixture();
  for (const name of ["mcp", "ordinary"]) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], uses: name === "mcp" ? ["*"] : [] });
    const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: name } });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: name, manifest, source: "builtin", intent: {}, report: {}, status: "approved" } });
    const answer = await handleModuleCall(f.ports, { workspaceId: f.workspaceId, moduleId: module.id, hash: name, manifest }, { id: "find", method: "call", params: { target: "modules.tools", args: { query: "build" }, mode: "sync", reply: false } });
    if (name === "mcp") expect(answer).toMatchObject({ result: { output: [
      { target: "modules.stop-build", inputSchema: { required: ["session"] } },
      { target: "modules.revise-build", inputSchema: { required: ["session", "requirements"] } },
    ] } });
    else expect(answer).toMatchObject({ result: { output: [] } });
  }
});

for (const limit of [0, 2, 20]) test(`daily new-build allowance ${limit} is owner configurable and matches settings usage`, async () => {
  const f = await fixture();
  await f.api.settings.update({ builds: { dailyLimit: limit } });
  for (let i = 0; i < limit; i++) await f.db.session.create({ data: { workspaceId: f.workspaceId, key: `history:${i}`, source: "build", status: "ended", createdAt: f.ports.now() } });
  expect((await f.api.settings.get()).buildUsage).toMatchObject({ used: limit, remaining: 0 });
  await expect(f.call("m_modules_build", request)).rejects.toThrow("Daily module build budget reached");
  await f.api.settings.update({ builds: { dailyLimit: limit + 1 } });
  expect(await f.call("m_modules_build", request)).toMatchObject({ status: "build_queued" });
  expect((await f.api.settings.get()).buildUsage).toMatchObject({ used: limit + 1, remaining: 0 });
});

test("submission budget is enforced from the run snapshot, not later owner changes", async () => {
  const f = await fixture();
  await f.api.settings.update({ builds: { maxSubmissions: 1 } });
  const { sessionId } = await f.call("m_modules_build", request) as { sessionId: string };
  const run = (await f.api.runs.claimNext("build"))!;
  await f.writeModule(run.cwd);
  await f.service.tools.call(run.token, "m_modules_propose", { dir: "mail-sort", intent });
  await f.api.settings.update({ builds: { maxSubmissions: 2 } });
  await expect(f.service.tools.call(run.token, "m_modules_propose", { dir: "mail-sort", intent })).rejects.toThrow("Submission limit");
  await f.call("m_modules_revise_build", { session: sessionId, requirements: "Continue with new owner budget" });
  const next = (await f.api.runs.claimNext("build"))!;
  await f.service.tools.call(next.token, "m_modules_propose", { dir: "mail-sort", intent });
  await f.service.tools.call(next.token, "m_modules_propose", { dir: "mail-sort", intent });
  await expect(f.service.tools.call(next.token, "m_modules_propose", { dir: "mail-sort", intent })).rejects.toThrow("Submission limit");
});

test("pre-upgrade running builds without a snapshot retain the original five-submission limit", async () => {
  const f = await fixture();
  await f.api.settings.update({ builds: { maxSubmissions: 20 } });
  await f.call("m_modules_build", request);
  const run = (await f.api.runs.claimNext("build"))!;
  await f.db.audit.deleteMany({ where: { kind: "run_claimed", subjectId: run.id } });
  await f.db.audit.createMany({ data: Array.from({ length: 5 }, () => ({ workspaceId: f.workspaceId, kind: "module_submission", actorKey: `provider:${run.id}`, details: {} })) });
  await expect(f.service.tools.call(run.token, "m_modules_propose", { dir: "missing", intent })).rejects.toThrow("Submission limit");
});

test("check waits while a version is checked, but never past the caller's timeoutSeconds", async () => {
  const f = await fixture();
  await mkdir(f.requester.cwd, { recursive: true });
  await f.writeModule(f.requester.cwd);
  await f.call("m_modules_propose", { dir: "mail-sort", intent });
  const started = Date.now();
  expect(await f.call("m_modules_check", { module: "mail-sort", wait: 600 }, { timeoutSeconds: 3 })).toMatchObject({ status: "building" });
  expect(Date.now() - started).toBeLessThan(3000);
  expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
});

test("transcripts: the Provider's text, tool calls and clipped results, credentials redacted; visible to modules", async () => {
  const f = await fixture(), secret = "sk-live-1234567890abcdefXYZ";
  process.env.CHRONA_TEST_API_KEY = "very-secret-value";
  cleanups.push(async () => { delete process.env.CHRONA_TEST_API_KEY; });
  f.ports.provider!.transcript = async ({ sessionDir }) => {
    expect(sessionDir).toBe(join(f.dataDir, "sessions", f.session.id, ".chrona", "sessions"));
    return [
      { at: "2026-10-25T01:00:01Z", kind: "text", text: "先看看测试" },
      { at: "2026-10-25T01:00:01Z", kind: "tool", tool: "bash", args: JSON.stringify({ command: "bun test" }) },
      { at: "2026-10-25T01:00:02Z", kind: "result", tool: "bash", error: true, text: `key very-secret-value ${secret} ${"x".repeat(3000)}` },
    ];
  };
  const items = await sessionTranscript(f.ports, f.session.id);
  expect(items.map(item => item.kind)).toEqual(["text", "tool", "result"]);
  expect(items[0]).toMatchObject({ text: "先看看测试" });
  expect(items[1]).toMatchObject({ tool: "bash", args: '{"command":"bun test"}' });
  const result = items[2] as { text: string; error: boolean };
  expect(result.error).toBe(true);
  expect(result.text).not.toContain("very-secret-value");
  expect(result.text).not.toContain(secret);
  expect(result.text.length).toBeLessThan(2100);
  expect(JSON.stringify(items)).not.toContain("private reasoning");

  const reader = async (name: string, uses: string[]) => {
    const manifestOf = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses, ...(name === "web" ? { listen: ["/"] } : {}) });
    const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name, activeHash: name } });
    await f.db.moduleVersion.create({ data: { moduleId: row.id, hash: name, manifest: manifestOf, source: "builtin", intent: {}, report: {}, status: "approved" } });
    return handleModuleCall(f.ports, { workspaceId: f.workspaceId, moduleId: row.id, hash: name, manifest: manifestOf }, { id: "t", method: "call", params: { target: "chat.transcript", args: { session: f.session.id }, mode: "sync", reply: false } });
  };
  expect(await reader("web", ["chat.transcript"])).toMatchObject({ result: { output: [{ kind: "text" }, { kind: "tool" }, { kind: "result" }] } });
  expect(await reader("snoop", [])).toMatchObject({ result: { output: [{ kind: "text" }, { kind: "tool" }, { kind: "result" }] } });
});

test("persistent FIFO survives service recreation and tied clocks; waiting has no model calls or running deadline", async () => {
  const f = await fixture(), now = f.ports.now();
  f.ports.now = () => now;
  const builds = [];
  for (let i = 0; i < 3; i++) builds.push(await f.call("m_modules_build", { ...request, name: `queued-${i}` }) as { sessionId: string });
  expect(await f.db.run.count({ where: { lane: "build", status: "queued", startedAt: null, deadlineAt: null, leaseUntil: null } })).toBe(3);
  expect(f.starts).toHaveLength(0);
  const api = createStewardService(f.ports).forWorkspace(f.workspaceId);
  f.ports.now = () => new Date(now.getTime() + 2 * 3600_000);
  await api.settings.update({ builds: { timeoutMinutes: 75, maxSubmissions: 3 } });
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
  const [a, b] = await Promise.all([f.call("m_modules_build", request), f.call("m_modules_build", request)]) as { sessionId: string; runId: string }[];
  expect(a!.sessionId).toBe(b!.sessionId);
  const repeat = await createStewardService(f.ports).tools.call(f.requester.token, "m_modules_build", request);
  expect(repeat).toMatchObject({ result: { sessionId: a!.sessionId, runId: a!.runId, duplicate: true } });
  expect((await f.api.settings.get()).buildUsage.used).toBe(1);
  const claimed = (await f.api.runs.claimNext("build"))!;
  expect(await f.call("m_modules_build", request)).toMatchObject({ status: "build_running", runId: claimed.id, duplicate: true });
  await f.call("m_modules_stop_build", { session: a!.sessionId });
  const next = await f.call("m_modules_build", request) as { sessionId: string };
  expect(next.sessionId).not.toBe(a!.sessionId);
  expect((await f.api.settings.get()).buildUsage.used).toBe(2);
});

test("queue bound rejects without consuming admission; cancellation frees space and a full queue cannot destroy a running revision", async () => {
  const f = await fixture(), ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push((await f.call("m_modules_build", { ...request, name: `bounded-${i}` }) as { sessionId: string }).sessionId);
  await expect(f.call("m_modules_build", { ...request, name: "overflow" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("queue is full") });
  expect(await f.call("m_modules_build", { ...request, name: "bounded-0" })).toMatchObject({ sessionId: ids[0], duplicate: true });
  expect((await f.api.settings.get()).buildUsage.used).toBe(10);
  // Replacing a queued task is allowed even at capacity, and moves it to the tail.
  expect(await f.call("m_modules_revise_build", { session: ids[3], requirements: "revised while queued" })).toMatchObject({ queuePosition: 10, aheadCount: 9 });
  await f.call("m_modules_stop_build", { session: ids[5] });
  await f.call("m_modules_build", { ...request, name: "replacement" });
  const active = (await f.api.runs.claimNext("build"))!;
  expect(active.sessionId).toBe(ids[0]!);
  expect(await f.call("m_modules_build", { ...request, name: "one-more" })).toMatchObject({ queuePosition: 10, aheadCount: 10 });
  await expect(f.call("m_modules_revise_build", { session: active.sessionId, requirements: "no room" })).rejects.toThrow("queue is full");
  expect((await f.db.run.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("running");
  expect(await f.db.run.count({ where: { lane: "build", status: "queued" } })).toBe(10);
});

for (const scope of ["session", "global"] as const) test(`${scope} budget-deferred head retains FIFO position without a paid retry`, async () => {
  const f = await fixture();
  const first = await f.call("m_modules_build", request) as { sessionId: string };
  const second = await f.call("m_modules_build", { ...request, name: "second" }) as { sessionId: string };
  await f.db.run.createMany({ data: Array.from({ length: scope === "global" ? 199 : 24 }, (_, i) => ({ workspaceId: f.workspaceId, sessionId: scope === "global" ? f.session.id : first.sessionId, lane: scope === "global" ? "background" : "build", trigger: "build", status: "finished", provider: "fake", tokenHash: `budget-history-${i}`, cwd: "unused", prompt: "", startedAt: f.ports.now() })) });
  expect(await f.api.runs.claimNext("build")).toBeNull();
  expect(await f.api.runs.claimNext("build")).toBeNull();
  await f.call("m_modules_stop_build", { session: first.sessionId });
  if (scope === "global") {
    expect(await f.api.runs.claimNext("build")).toBeNull();
    const tomorrow = new Date(f.ports.now().getTime() + 86400_000);
    f.ports.now = () => tomorrow;
  }
  expect((await f.api.runs.claimNext("build"))!.sessionId).toBe(second.sessionId);
  expect(f.starts).toHaveLength(0);
});

test("existing React process view receives explicit queue position, updated cancellation state, and no fabricated Provider progress", async () => {
  const f = await fixture();
  const first = await f.call("m_modules_build", request) as { sessionId: string };
  const second = await f.call("m_modules_build", { ...request, name: "second" }) as { sessionId: string };
  const manifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], uses: ["chat.transcript"], listen: ["/"] });
  const web = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "web", activeHash: "web" } });
  await f.db.moduleVersion.create({ data: { moduleId: web.id, hash: "web", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const transcript = (session: string) => handleModuleCall(f.ports, { workspaceId: f.workspaceId, moduleId: web.id, hash: "web", manifest }, { id: "view", method: "call", params: { target: "chat.transcript", args: { session }, mode: "sync", reply: false } });
  expect(await transcript(second.sessionId)).toMatchObject({ result: { output: [{ kind: "text", text: expect.stringContaining("排队第 2 位") }] } });
  expect((await f.api.provider.list(second.sessionId))[0]).toMatchObject({ active: false, status: "queued", progress: null });
  await f.call("m_modules_stop_build", { session: first.sessionId });
  expect(await transcript(first.sessionId)).toMatchObject({ result: { output: [{ text: expect.stringContaining("构建已停止") }] } });
  expect(await transcript(second.sessionId)).toMatchObject({ result: { output: [{ text: expect.stringContaining("排队第 1 位") }] } });
  const running = (await f.api.runs.claimNext("build"))!;
  expect(await transcript(second.sessionId)).toMatchObject({ result: { output: [{ text: expect.stringContaining("正在构建") }] } });
  for (const [status, text] of [["finished", "本轮运行已结束"], ["failed", "本轮运行失败"], ["timed_out", "本轮运行超时"], ["provider_unavailable", "模型服务不可用"]]) {
    await f.db.run.update({ where: { id: running.id }, data: { status } });
    expect(await transcript(second.sessionId)).toMatchObject({ result: { output: [{ text: expect.stringContaining(text!) }] } });
  }
  expect(f.starts).toHaveLength(0);
});

test("missing required references reject before admitting or charging a build", async () => {
  const f = await fixture();
  await mkdir(f.requester.cwd, { recursive: true });
  for (const file of ["missing.txt", "content/chat/missing.txt"]) {
    await expect(f.call("m_modules_build", { ...request, files: [file] })).rejects.toMatchObject({ code: "not_found" });
  }
  await writeFile(join(f.requester.cwd, "selected.txt"), "required reference bytes");
  // Reproduce an attachment disappearing after selection; the old copy loop silently skipped it.
  const reader = spyOn(chatFiles, "readChatFile").mockResolvedValue(null);
  try {
    await expect(f.call("m_modules_build", { ...request, files: ["selected.txt"] })).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining("Build reference attachment unavailable") });
  } finally { reader.mockRestore(); }
  expect(await f.db.session.count({ where: { workspaceId: f.workspaceId, source: "build" } })).toBe(0);
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId, lane: "build" } })).toBe(0);
  expect((await f.api.settings.get()).buildUsage.used).toBe(0);
  expect(f.starts).toHaveLength(0);
});

test("a Provider supplements an old build without losing work; missing or owner paths never stop the running build", async () => {
  const f = await fixture();
  const started = await f.call("m_modules_build", request) as { sessionId: string };
  const old = (await f.api.runs.claimNext("build"))!;
  await writeFile(join(old.cwd, "draft.txt"), "retained draft");
  await mkdir(f.requester.cwd, { recursive: true });
  await expect(f.call("m_modules_revise_build", { session: started.sessionId, requirements: "补齐参考", files: ["missing.txt"] })).rejects.toMatchObject({ code: "not_found" });
  await expect(f.api.modules.callTool("m_modules_revise_build", { session: started.sessionId, requirements: "补齐参考", files: ["private.txt"] })).rejects.toMatchObject({ code: "forbidden" });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("running");
  await writeFile(join(f.requester.cwd, "interface.txt"), "supplemental fixture, not production data");
  await f.call("m_modules_revise_build", { session: started.sessionId, requirements: "使用补齐的契约继续", files: ["interface.txt"] });
  await expect(f.service.tools.catalog(old.token)).rejects.toThrow();
  expect(await readFile(join(old.cwd, "draft.txt"), "utf8")).toBe("retained draft");
  const saved = JSON.parse(await readFile(join(old.cwd, "request.json"), "utf8"));
  expect(saved.files).toHaveLength(1);
  expect(saved.files[0]).toMatch(/^files\/revision-[a-f0-9-]+\/1-interface\.txt$/);
  expect(await readFile(join(old.cwd, saved.files[0]), "utf8")).toBe("supplemental fixture, not production data");
  f.onRun(async (input, call) => {
    expect(input).toMatchObject({ searchTools: true, hostPaths: [], content: [] });
    expect(input.extraTools).toContain("m_modules_diagnostics");
    expect(input.prompt).toContain("m_modules_diagnostics");
    expect(input.prompt).toContain(saved.files[0]);
    expect(input.prompt).toContain("Development references");
    expect(await call("m_modules_reference", { target: "modules.diagnostics" })).toMatchObject({ outputSchema: { type: "array" } });
    await expect(call("m_modules_diagnostics", {})).rejects.toMatchObject({ code: "not_found" });
  });
  await f.step();
  expect(f.starts).toHaveLength(1);
  expect((await f.api.settings.get()).buildUsage.used).toBe(1);
});

test("a build discovers contracts and updates an external fixture after checks", async () => {
  const f = await fixture();
  const webManifest = moduleManifestSchema.parse({ name: "example", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [] });
  f.ports.moduleBuiltinResources = join(f.dataDir, "release");
  const source = join(f.dataDir, "legacy-source"), builtin = join(f.ports.moduleBuiltinResources, "web");
  for (const [dir, app] of [[source, "// custom layout"], [builtin, "// release feature"]]) {
    await mkdir(dir!, { recursive: true });
    await writeFile(join(dir!, "module.json"), JSON.stringify(webManifest));
    await writeFile(join(dir!, "index.ts"), 'import {on} from "chrona"; on("tool", async () => ({}));');
    await writeFile(join(dir!, "test.ts"), "process.exit(0)");
    await writeFile(join(dir!, "app.js"), app!);
  }
  const hash = await legacySourceHash(source);
  const web = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "example", builtin: false, activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: web.id, hash, manifest: webManifest, source: "user", status: "approved", intent: {}, report: {} } });
  const active = join(f.dataDir, "platform", "store", hash);
  await cp(source, active, { recursive: true });
  const started = await f.call("m_modules_build", { ...request, name: "example", goal: "Update the external app and preserve its data" }) as { sessionId: string };
  let submitted: { hash: string } | undefined;
  f.onRun(async (input, call) => {
    expect(await call("m_modules_reference", {})).toEqual(expect.arrayContaining([expect.objectContaining({ target: "modules.diagnostics" })]));
    expect(await call("m_modules_reference", { target: "modules.diagnostics" })).toMatchObject({ outputSchema: { type: "array" }, examples: expect.any(Array) });
    expect(await call("m_modules_checkout", { module: "example", dir: "active-latest" })).toMatchObject({ source: "stored", hash });
    await cp(join(input.cwd, "active-latest"), join(input.cwd, "candidate"), { recursive: true });
    const customized = await readFile(join(input.cwd, "candidate", "app.js"), "utf8"), feature = "// external feature";
    await writeFile(join(input.cwd, "candidate", "app.js"), `${customized}\n${feature}`);
    submitted = await call("m_modules_propose", { dir: "candidate", intent }) as { hash: string };
    await createModules(f.ports, f.workspaceId).buildPending();
    expect(await call("m_modules_check", { module: "example", hash: submitted.hash })).toMatchObject({ status: "active", active: true });
    await call("chrona_reply", { text: "Fixture merge checked, waiting for approval" });
  });
  await f.step();
  expect(submitted).toBeDefined();
  expect(await readFile(join(f.dataDir, "platform", "store", submitted!.hash, "app.js"), "utf8")).toBe("// custom layout\n// external feature");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: web.id } })).activeHash).toBe(submitted!.hash);
  expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: web.id, hash: submitted!.hash } } })).status).toBe("approved");
  expect(JSON.parse(await readFile(join(f.dataDir, "sessions", started.sessionId, "request.json"), "utf8")).files).toEqual([]);
});

/** v2-15: a build of two modules; the Provider submits both and asks for one approval. */
async function groupBuild(f: Awaited<ReturnType<typeof fixture>>, includeImpact = false) {
  const write = async (cwd: string, name: string) => {
    await mkdir(join(cwd, name), { recursive: true });
    const tools = includeImpact && name === "mail-sort" ? [{ name: "read", description: "Read", visibility: ["modules"], parameters: { type: "object", properties: {}, required: [] }, output: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false } }] : [];
    await writeFile(join(cwd, name, "module.json"), JSON.stringify({ ...manifest, name, tools, secrets: ["mail_account"] }));
    await writeFile(join(cwd, name, "index.ts"), 'import { on } from "chrona"; on("schedule", async () => ({}));');
    await writeFile(join(cwd, name, "test.ts"), "process.exit(0)");
  };
  await expect(f.call("m_modules_build", { ...request, modules: ["mail-sort"] })).rejects.toMatchObject({ code: "invalid" });
  const started = await f.call("m_modules_build", { goal: request.goal, intent, modules: ["mail-sort", "mail-tag"] }) as { sessionId: string };
  expect(await f.db.session.findUniqueOrThrow({ where: { id: started.sessionId } })).toMatchObject({ title: "构建模块 mail-sort、mail-tag" });
  let group: { approvalId?: string } = {};
  const hashes: Record<string, string> = {};
  f.onRun(async (input, call) => {
    expect(input.prompt).toContain("m_modules_request_group");
    await write(input.cwd, "other-app");
    await expect(call("m_modules_propose", { dir: "other-app", intent })).rejects.toMatchObject({ code: "forbidden" });
    for (const name of ["mail-sort", "mail-tag"]) {
      await write(input.cwd, name);
      hashes[name] = (await call("m_modules_propose", { dir: name, intent }) as { hash: string }).hash;
    }
    await createModules(f.ports, f.workspaceId).buildPending();
    for (const name of ["mail-sort", "mail-tag"]) expect(await call("m_modules_check", { module: name, hash: hashes[name] })).toMatchObject({ status: "pending_review" });
    // Neither waits on its own card: the group gets one.
    expect(await f.db.approval.count({ where: { status: "open" } })).toBe(0);
    await expect(call("m_modules_request_group", { versions: [{ module: "mail-sort", hash: hashes["mail-sort"] }, { module: "other-app", hash: hashes["mail-sort"] }] })).rejects.toMatchObject({ code: "invalid" });
    group = await call("m_modules_request_group", { versions: ["mail-sort", "mail-tag"].map(module => ({ module, hash: hashes[module] })) }) as typeof group;
    await call("chrona_reply", { text: "两个模块待你一起批准" });
  });
  await f.step();
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

test("a group activates all or nothing, and a new candidate of a member expires the group approval", async () => {
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
  await writeFile(join(f.requester.cwd, "mail-tag", "index.ts"), 'import { on } from "chrona"; on("schedule", async () => ({ changed: true }));');
  await writeFile(join(f.requester.cwd, "mail-tag", "test.ts"), "process.exit(0)");
  await f.call("m_modules_propose", { dir: "mail-tag", intent });
  await createModules(f.ports, f.workspaceId).buildPending();
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("expired");
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
  await expect(f.call("m_modules_build_owner", ownerRequest)).rejects.toThrow();
  const before = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings;
  const started = (await f.api.modules.callTool("m_modules_build_owner", ownerRequest)).result as Awaited<ReturnType<typeof startOwnerBuild>>;
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
  await expect(startOwnerBuild(f.ports, f.workspaceId, { ...ownerRequest, name: "web" })).rejects.toMatchObject({ code: "forbidden" });
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
test("offline recovery executes one bounded build and activates its checks-passing version", async () => {
  const f = await ownerFixture();
  await f.api.runs.finish(f.requester.id, { outcome: "finished", sessionId: null, error: null });
  f.onRun(async (input, call) => {
    expect(input).toMatchObject({ lane: "build", model: ownerRequest.execution.model, sessionId: null, searchTools: true });
    await f.writeModule(input.cwd);
    const version = await call("m_modules_propose", { dir: "mail-sort", intent }) as { hash: string };
    expect(await call("m_modules_check", { module: "mail-sort", hash: version.hash, wait: 10 }, { timeoutSeconds: 12 })).toMatchObject({ status: "active", active: true });
    await call("chrona_reply", { text: "ready for approval" });
  });
  expect(await runOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ status: "finished" });
  expect(f.starts).toHaveLength(1);
  const active = await f.db.module.findFirstOrThrow({ where: { name: "mail-sort" } });
  expect(active).toMatchObject({ status: "active" });
  const notice = await f.db.moduleInvocation.findFirstOrThrow({ where: { key: `notify:session-result:${f.starts[0]!.runId}` } });
  expect(JSON.parse((notice.args as { facts: string }).facts).body).toBe(`ready for approval\n\n已启用：mail-sort 版本 ${active.activeHash!.slice(0, 8)}`);
  expect(await f.db.approval.count({ where: { workspaceId: f.workspaceId, status: "open" } })).toBe(0);
  expect(await runOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ duplicate: true });
  expect(f.starts).toHaveLength(1);
});

const cause = { moduleId: "health-module", activationId: "activation-1", incidentId: "incident-1" };
async function otherConversation(f: Awaited<ReturnType<typeof fixture>>) {
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:other", source: "web" } });
  return f.api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Recheck health" });
}

test("same cause across conversations reuses queued/running work before references, budget or queue checks", async () => {
  const f = await fixture(), other = await otherConversation(f);
  const first = await f.call("m_modules_build", { ...request, cause }) as { sessionId: string; runId: string };
  await f.api.settings.update({ builds: { dailyLimit: 1 } });
  const auditCount = await f.db.audit.count();
  const parsed = modulesToolInputSchemas.build.parse({ ...request, goal: "Different description", files: ["missing.txt"],
    cause: { incidentId: cause.incidentId, activationId: cause.activationId, moduleId: cause.moduleId } });
  const expected = { sessionId: first.sessionId, runId: first.runId, duplicate: true, reason: "same_cause" };
  expect(await startBuild(f.ports, f.workspaceId, other.id, parsed)).toMatchObject({ ...expected, status: "build_queued" });
  expect(await f.db.audit.count()).toBe(auditCount);
  expect(await f.db.session.count({ where: { source: "build" } })).toBe(1);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
  expect((await f.api.settings.get()).buildUsage).toMatchObject({ used: 1, remaining: 0 });
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
  const parsed = modulesToolInputSchemas.build.parse({ ...request, cause });
  const results = await Promise.all([f.requester.id, other.id].map(id => startBuild(f.ports, f.workspaceId, id, parsed)));
  expect(new Set(results.map(result => result.sessionId)).size).toBe(1);
  expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
  expect(await f.db.session.count({ where: { source: "build" } })).toBe(1);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "build_request" } })).toBe(1);
  expect((await f.api.settings.get()).buildUsage.used).toBe(1);
});

for (const status of ["finished", "failed", "cancelled"] as const) test(`${status} causal work permits a fresh admission`, async () => {
  const f = await fixture();
  const first = await f.call("m_modules_build", { ...request, cause }) as { sessionId: string; runId: string };
  await f.db.run.update({ where: { id: first.runId }, data: { status } });
  const next = await f.call("m_modules_build", { ...request, cause }) as { sessionId: string; duplicate: boolean };
  expect(next.duplicate).toBe(false);
  expect(next.sessionId).not.toBe(first.sessionId);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.api.settings.get()).buildUsage.used).toBe(2);
});

test("distinct incidents, activations, topics and modules do not deduplicate", async () => {
  const f = await fixture(), ids = [];
  for (const ref of [cause, { ...cause, incidentId: "incident-2" }, { ...cause, activationId: "activation-2" },
    { ...cause, moduleId: "other-module" }, { moduleId: cause.moduleId, activationId: cause.activationId, topic: "output" }]) {
    const result = await f.call("m_modules_build", { ...request, cause: ref }) as { sessionId: string; duplicate: boolean };
    expect(result.duplicate).toBe(false);
    ids.push(result.sessionId);
  }
  expect(new Set(ids).size).toBe(5);
  const topic = { moduleId: cause.moduleId, activationId: cause.activationId, topic: "output" };
  expect(await f.call("m_modules_build", { ...request, goal: "Topic recheck", cause: topic })).toMatchObject({ duplicate: true, reason: "same_cause", sessionId: ids[4] });
});

test("without cause identical requests in different conversations still queue separately", async () => {
  const f = await fixture(), other = await otherConversation(f);
  const first = await f.call("m_modules_build", request) as { sessionId: string };
  const second = await startBuild(f.ports, f.workspaceId, other.id, modulesToolInputSchemas.build.parse(request));
  expect(second.duplicate).toBe(false);
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.api.settings.get()).buildUsage.used).toBe(2);
});

test("owner authorization is independent of a same-target causal build and key replay never retries", async () => {
  const f = await ownerFixture();
  const causal = await f.call("m_modules_build", { ...request, cause }) as { sessionId: string };
  const owner = await startOwnerBuild(f.ports, f.workspaceId, ownerRequest);
  expect(owner.duplicate).toBe(false);
  expect(owner.sessionId).not.toBe(causal.sessionId);
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ sessionId: owner.sessionId, runId: owner.runId, duplicate: true });
  await f.db.run.update({ where: { id: owner.runId }, data: { status: "cancelled" } });
  expect(await startOwnerBuild(f.ports, f.workspaceId, ownerRequest)).toMatchObject({ sessionId: owner.sessionId, runId: owner.runId, duplicate: true, status: "cancelled" });
  await expect(queueBuild(f.ports, f.workspaceId, { key: "invalid-owner-cause", actorKey: "user", originSessionId: null,
    request: modulesToolInputSchemas.build.parse({ ...request, cause }), execution: ownerRequest.execution })).rejects.toMatchObject({ code: "invalid" });
  await expect(startOwnerBuild(f.ports, f.workspaceId, { ...ownerRequest, cause })).rejects.toThrow();
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(2);
  expect((await f.api.settings.get()).buildUsage.used).toBe(2);
});

test("causes with both incidentId and topic or neither are invalid before admission", async () => {
  const f = await fixture();
  for (const invalid of [{ ...cause, topic: "output" }, { moduleId: cause.moduleId, activationId: cause.activationId }]) {
    expect(modulesToolInputSchemas.build.safeParse({ ...request, cause: invalid }).success).toBe(false);
    await expect(f.call("m_modules_build", { ...request, cause: invalid })).rejects.toMatchObject({ code: "invalid" });
  }
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(0);
  expect((await f.api.settings.get()).buildUsage.used).toBe(0);
});
