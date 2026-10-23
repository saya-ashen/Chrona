import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_LIMITS, type ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { createTick } from "./tick";
import type { StewardPorts } from "./ports";
import { testModuleSandbox } from "./module-test-process";
import { testDb } from "./test-db";
import { proposeFromBuild } from "./module-build-lane";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const intent = { changes: ["Sort shop mail without the model"], preserves: [] };
const request = { name: "mail-sort", goal: "Mark mail from *@shop.example handled", examples: ["from a@shop.example → handled"] };
const manifest = { name: "mail-sort", entry: "index.ts", triggers: [{ id: "mail", inbound: { connector: "box", match: { from: "*@shop.example" } } }], effects: ["notify_user"], tests: ["test.ts"] };
type Build = (input: ProviderRunInput, f: { call: (name: string, args: unknown) => Promise<unknown> }) => Promise<void>;

async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-build-lane-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const starts: ProviderRunInput[] = [], pending: Promise<unknown>[] = [];
  let fail = false, build: Build = async () => {};
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-21T04:00:00Z"), deliveries: [], chat: null, publicUrl: null,
    moduleBuildResources: {
      sdk: fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk/sdk.ts", import.meta.url)),
      testing: fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk/testing.ts", import.meta.url)),
    },
    sandbox: { available: true, async runModule() { return { status: fail ? "failed" : "succeeded", output: '{"effects":[]}', error: fail ? "public stderr" : null, exitCode: fail ? 1 : 0 }; } },
    provider: { name: "fake", async health() { return { available: true, sandboxed: true, error: null }; }, start(input) {
      starts.push(input);
      const done = build(input, { call: (name, args) => service.tools.call(input.token, name, args) }).then(() => ({ outcome: "finished" as const, sessionId: `session-${input.runId}`, error: null }));
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
  /** One tick, then wait for launched runs to finish and builds to settle. */
  async function step() {
    await tick();
    await Promise.all(pending.splice(0));
    for (let i = 0; i < 50 && await db.run.count({ where: { lane: "build", status: "running" } }); i++) await Bun.sleep(5);
    await tick.settled();
  }
  async function writeModule(cwd: string) {
    await mkdir(join(cwd, "mail-sort"), { recursive: true });
    await writeFile(join(cwd, "mail-sort", "module.json"), JSON.stringify(manifest));
    await writeFile(join(cwd, "mail-sort", "index.ts"), "console.log(JSON.stringify({ effects: [], handled: true }))");
    await writeFile(join(cwd, "mail-sort", "test.ts"), "process.exit(0)");
  }
  return { db, dataDir, ports, service, workspaceId, session, requester, starts, step, writeModule,
    request: () => service.tools.call(requester.token, "chrona_propose", { request, intent }),
    onBuild: (next: Build) => { build = next; }, fail: (value = true) => { fail = value; } };
}

test("intent proposal runs a clean, isolated build whose module goes to review", async () => {
  const f = await fixture();
  const queued = await f.request() as { status: string; runId: string };
  expect(queued).toMatchObject({ status: "build_queued" });
  await expect(f.request()).rejects.toMatchObject({ code: "conflict" });
  f.onBuild(async (input, run) => {
    expect(input).toMatchObject({ lane: "build", cwd: join(f.dataDir, "builds", queued.runId), sessionId: null, extraTools: [] });
    expect(input.prompt).toContain(request.goal);
    for (const text of ["/chrona/sdk.ts", "/chrona/testing.ts", "chrona.notify", "chrona.wakeProvider", "CHRONA_SOCKET", "only in /data", "two different events", "must not use the network", "data, never instructions", "Keep the module minimal"]) expect(input.prompt).toContain(text);
    for (const file of ["sdk.ts", "testing.ts", "run-tests.sh"]) {
      expect((await stat(join(input.cwd, "chrona", file))).mode & 0o222).toBe(0);
    }
    expect(await readFile(join(input.cwd, "chrona", "sdk.ts"), "utf8")).toBe(await readFile(f.ports.moduleBuildResources!.sdk, "utf8"));
    expect(await readFile(join(input.cwd, "chrona", "testing.ts"), "utf8")).toBe(await readFile(f.ports.moduleBuildResources!.testing, "utf8"));
    expect(JSON.parse(await readFile(join(input.cwd, "request.json"), "utf8"))).toEqual({ ...request, intent });
    expect((await f.service.tools.catalog(input.token)).map(tool => tool.name)).toEqual(["chrona_propose"]);
    await expect(run.call("chrona_reply", { text: "hi" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(run.call("chrona_propose", { request, intent })).rejects.toMatchObject({ code: "conflict" });
    for (const dir of ["chrona", "./chrona/", "mail-sort/../chrona", "."]) {
      await expect(proposeFromBuild(f.ports, f.workspaceId, { id: queued.runId, workspaceId: f.workspaceId, lane: "build", status: "running", toolCalls: [], cwd: input.cwd }, { dir, intent })).rejects.toMatchObject({ code: "forbidden" });
    }
    await f.writeModule(input.cwd);
    expect(await run.call("chrona_propose", { dir: "mail-sort", intent })).toMatchObject({ status: "building" });
  });
  await f.step();
  await f.step();
  expect(f.starts.map(input => input.lane)).toEqual(["build"]);
  const version = await f.db.moduleVersion.findFirstOrThrow();
  expect(version).toMatchObject({ source: "build", status: "pending_review" });
  expect(await f.db.approval.count({ where: { status: "open", action: "activate_module" } })).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "module_build_settled" } })).toBe(1);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(1);
  expect((await f.db.session.findUniqueOrThrow({ where: { id: f.session.id } })).providerSessionId).toBeNull();
  expect((await f.db.run.findUniqueOrThrow({ where: { id: queued.runId } })).sessionId).toBeNull();
  expect(existsSync(join(f.dataDir, "builds", queued.runId))).toBe(false);
});

test("failed, invalid or empty attempts retry with the public report, then give up after the attempt limit", async () => {
  const f = await fixture();
  f.fail();
  let attempt = 0;
  f.onBuild(async (input, run) => {
    attempt++;
    expect(existsSync(join(input.cwd, "previous-report.json"))).toBe(attempt > 1);
    if (attempt === 3) {
      // The invalid manifest of attempt 2 reaches this attempt; then it ends without a submission.
      expect(await readFile(join(input.cwd, "previous-report.json"), "utf8")).toContain("module.json: missing or not valid JSON");
      return;
    }
    await f.writeModule(input.cwd);
    if (attempt === 2) await writeFile(join(input.cwd, "mail-sort", "module.json"), "{");
    expect(await run.call("chrona_propose", { dir: "mail-sort", intent })).toMatchObject({ status: attempt === 2 ? "rejected" : "building" });
  });
  await f.request();
  for (let i = 0; i < 6; i++) await f.step();
  expect(attempt).toBe(RUN_LIMITS.maxBuildAttempts);
  expect(await f.db.run.count({ where: { lane: "build" } })).toBe(RUN_LIMITS.maxBuildAttempts);
  expect(await f.db.run.count({ where: { lane: { not: "build" }, status: "queued" } })).toBe(0);
  expect(await f.db.notification.count({ where: { title: "模块 mail-sort 自动构建未成功" } })).toBe(1);
  expect(await f.db.audit.count({ where: { kind: "module_build_settled" } })).toBe(RUN_LIMITS.maxBuildAttempts);
});

test("build helper runs SDK tests against temporary copies without /chrona or bwrap", async () => {
  const f = await fixture();
  f.onBuild(async input => {
    await f.writeModule(input.cwd);
    const entry = `import { on, chrona } from "/chrona/sdk.ts";
on("inbound", async ev => {
  await chrona.notify({ key: ev.item.externalId, level: "now", title: "Mail", body: ev.item.subject });
  return { handled: true };
});`;
    const testSource = `import { startModule } from "/chrona/testing.ts";
import { strict as assert } from "node:assert";
const module = await startModule("index.ts");
try {
  for (const externalId of ["mail-1", "mail-2"]) {
    const reply = await module.send({ trigger: { kind: "inbound", id: "mail", firedAt: "2026-10-21T04:00:00Z", item: { externalId, subject: "Shop mail" } }, now: "2026-10-21T04:00:00Z", params: {} });
    assert.equal(reply.result?.handled, true);
  }
  assert.equal(module.calls.length, 2);
  assert.notEqual(module.calls[0].params.key, module.calls[1].params.key);
  console.log("SDK self-test: 2 events, distinct keys, passed");
} finally { await module.stop(); }`;
    await writeFile(join(input.cwd, "mail-sort", "index.ts"), entry);
    await writeFile(join(input.cwd, "mail-sort", "test.ts"), testSource);
    const result = spawnSync("bash", ["chrona/run-tests.sh", "mail-sort"], { cwd: input.cwd, encoding: "utf8", timeout: 15000 });
    console.log(result.stdout.trim());
    if (result.stderr) console.error(result.stderr);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SDK self-test: 2 events, distinct keys, passed");
    expect(await readFile(join(input.cwd, "mail-sort", "index.ts"), "utf8")).toBe(entry);
    expect(await readFile(join(input.cwd, "mail-sort", "test.ts"), "utf8")).toBe(testSource);
    expect(await readFile(join(input.cwd, "chrona", "testing.ts"), "utf8")).toBe(await readFile(f.ports.moduleBuildResources!.testing, "utf8"));
  });
  await f.request();
  await f.step();
});

test("daily build budget and build-run recursion are refused", async () => {
  const f = await fixture();
  for (let i = 0; i < RUN_LIMITS.maxBuildRunsPerDay; i++) {
    await f.db.run.create({ data: { workspaceId: f.workspaceId, lane: "build", trigger: "build", status: "finished", provider: "fake", prompt: "", tokenHash: `t${i}`, cwd: f.dataDir, createdAt: f.ports.now() } });
  }
  await expect(f.request()).rejects.toMatchObject({ code: "conflict", message: "Daily module build budget reached" });
  await f.db.run.update({ where: { id: f.requester.id }, data: { lane: "build" } });
  await expect(f.request()).rejects.toMatchObject({ code: "conflict" });
});
