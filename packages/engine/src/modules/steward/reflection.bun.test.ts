import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderRunInput } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { createTick } from "./tick";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { notices } from "./test-notices";
import { moduleSupervisor } from "./module-supervisor";
import { REFLECT_PROMPT, startReflection } from "./reflection";
import { listActivity } from "./activity";
import { systemApps } from "./system-apps";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const HOUR = 3600_000;
const okxManifest = { name: "okx-trader", description: "OKX demo experiments", entry: "index.ts", triggers: [], effects: ["network"], tools: [{ name: "status", description: "Experiment status", parameters: { type: "object", properties: {}, required: [] } }], tests: ["test.ts"] };
const suggestion = { key: "web-page:okx-trader", title: "为 okx-trader 加操作页", why: "它刚上线，web 里还没有它的页面。",
  build: { name: "okx-page", goal: "A page that shows okx-trader.status", intent: { changes: ["Add an okx-trader page"], preserves: [] } } };
type Call = (name: string, args: unknown) => Promise<unknown>;

/** A real service and tick, a scripted Provider, and one custom (non-entry) app that went live. */
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-reflection-"));
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  let at = Date.parse("2026-10-27T02:00:00Z");
  const starts: ProviderRunInput[] = [], pending: Promise<unknown>[] = [];
  let script = async (_input: ProviderRunInput, _call: Call) => {};
  const ports: StewardPorts = { db, dataDir, now: () => new Date(at), publicUrl: null,
    moduleSdk: fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk", import.meta.url)),
    provider: { name: "fake", async health() { return { available: true, sandboxed: true, error: null }; }, start(input) {
      starts.push(input);
      const done = script(input, (name, args) => service.tools.call(input.token, name, args)).then(() => ({ outcome: "finished" as const, sessionId: null, error: null }));
      pending.push(done);
      return { async inject() {}, async abort() {}, done };
    } },
  };
  const service = createStewardService(ports), tick = createTick(ports);
  const workspaceId = (await db.workspace.create({ data: { name: "reflect" } })).id;
  const okx = await db.module.create({ data: { workspaceId, name: "okx-trader", activeHash: "a5a71f8d00", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: okx.id, hash: "a5a71f8d00", manifest: okxManifest, source: "provider", intent: {}, report: {}, status: "active" } });
  const signal = (kind = "module_activate", subjectId = okx.id) => db.audit.create({ data: { workspaceId, actorKey: "chrona", kind, subjectId, details: { hash: "a5a71f8d00", status: "unresolved" }, createdAt: new Date(at - 60_000) } });
  async function step() {
    await tick();
    await Promise.all(pending.splice(0));
    // Finishing a run follows the Provider's completion.
    for (let i = 0; i < 100 && await db.run.count({ where: { workspaceId, status: "running" } }); i++) await Bun.sleep(10);
    await tick.settled();
  }
  return { db, ports, workspaceId, okx, starts, signal, step, advance: (ms: number) => { at += ms; }, onRun: (next: typeof script) => { script = next; } };
}

test("an app going live starts one reflection that sees the facts, may only suggest, and its suggestion starts a build at once", async () => {
  const f = await fixture();
  await f.signal();
  const answers: unknown[] = [];
  f.onRun(async (input, call) => {
    if (!input.prompt.startsWith(REFLECT_PROMPT)) return;
    answers.push(await call("m_reflection_suggest", suggestion));
    answers.push(await call("m_reflection_suggest", suggestion).catch(error => String(error)));
    answers.push(await call("chrona_notify", { title: "x", body: "y" }).catch(error => String(error)));
  });
  await f.step();
  const reflection = f.starts.find(input => input.prompt.startsWith(REFLECT_PROMPT))!;
  expect(reflection.extraTools).toEqual(["m_reflection_suggest"]);
  expect(reflection.prompt).toContain('"signals":[{"kind":"module_activate","module":"okx-trader"');
  expect(reflection.prompt).toContain('"tools":["status"]');
  expect(answers[0]).toMatchObject({ result: { key: "web-page:okx-trader", status: expect.stringMatching(/^build_/) } });
  expect(String(answers[1])).toContain("already suggested");
  expect(String(answers[2])).toContain("may only use m_reflection_suggest");
  const build = await f.db.session.findFirstOrThrow({ where: { source: "build" } });
  const reflect = await f.db.session.findFirstOrThrow({ where: { source: "reflect" } });
  expect(build.originSessionId).toBe(reflect.id);
  expect(reflect.status).toBe("ended");
  expect(await notices(f.db, { title: "Chrona 开始构建：为 okx-trader 加操作页" })).toHaveLength(1);
  // v2-20: the reflection app's lines link to their process: the reflection itself, and the build it started.
  expect((await listActivity(f.ports, f.workspaceId, { module: "reflection" })).items).toMatchObject([
    { text: "Chrona 开始构建「为 okx-trader 加操作页」（okx-page）：它刚上线，web 里还没有它的页面。", session: { id: build.id, source: "build" } },
    { text: "Chrona 反思了一次（okx-trader 上线）", session: { id: reflect.id, source: "reflect" } }]);
  const app = await systemApps(f.ports, f.workspaceId, "reflection") as { sessions: string; tools: { name: string; callers: null }[]; work: { id: string; status: string }[] };
  expect(app).toMatchObject({ sessions: "reflect", tools: [{ name: "suggest" }], work: [{ id: reflect.id, status: "ended" }] });
  expect((await systemApps(f.ports, f.workspaceId) as { name: string; description: string }[]).every(item => item.description)).toBe(true);
  // Six hours apart, and only for a new signal.
  expect(await startReflection(f.ports, f.workspaceId)).toBeNull();
  f.advance(HOUR);
  await f.signal("module_runtime_incident");
  expect(await startReflection(f.ports, f.workspaceId)).toBeNull();
  f.advance(6 * HOUR);
  // The next reflection sees what was built, whoever asked for it, and what it started before.
  const next = await startReflection(f.ports, f.workspaceId);
  expect(next?.prompt).toContain('"builds":[{');
  expect(next?.prompt).toContain('"modules":["okx-page"],"goal":"A page that shows okx-trader.status"');
  expect(next?.prompt).toContain('"suggestions":[{"key":"web-page:okx-trader"');
});

test("no reflection without a signal, when turned off, or for built-in and entry apps changing", async () => {
  const f = await fixture();
  expect(await startReflection(f.ports, f.workspaceId)).toBeNull();
  const qq = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "qq", activeHash: "2a501daa00", status: "active" } });
  await f.db.moduleVersion.create({ data: { moduleId: qq.id, hash: "2a501daa00", manifest: { ...okxManifest, name: "qq" }, source: "builtin", intent: {}, report: {}, status: "active" } });
  await f.signal("module_activate", qq.id);
  expect(await startReflection(f.ports, f.workspaceId)).toBeNull();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { reflection: { enabled: false } } } });
  await f.signal();
  expect(await startReflection(f.ports, f.workspaceId)).toBeNull();
});

test("only a reflection conversation sees or calls reflection.suggest", async () => {
  const f = await fixture();
  const service = createStewardService(f.ports), api = service.forWorkspace(f.workspaceId);
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:chat", source: "web" } });
  await api.runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "hi" });
  const run = (await api.runs.claimNext("foreground"))!;
  expect((await service.tools.catalog(run.token)).map(tool => tool.name)).not.toContain("m_reflection_suggest");
  expect(String(await service.tools.call(run.token, "m_reflection_suggest", suggestion).catch(error => error))).toContain("Only a reflection may suggest");
  expect(String(await service.chat.handleMessage({ workspaceId: f.workspaceId, channel: "in_app", text: "hi", key: "reflect:x" }).catch(error => error))).toContain("does not take messages");
});
