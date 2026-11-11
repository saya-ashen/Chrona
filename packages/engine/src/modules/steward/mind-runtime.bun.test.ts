import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createServerApp } from "../../../../../apps/server/src/app";
import { createStewardRuntime } from "../../../../../apps/server/src/steward-runtime";
import { resetEnvCacheForTests } from "../../../../../apps/server/src/config/env";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";
import { drainTimers } from "./timers";

type Args = Record<string, unknown>;
type PageRef = { module: string; id: string; revision: string };
async function fixture(withFiles = false) {
  const db = testDb({ injectedAgent: false });
  const rows = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = rows.find(row => row.name === "main")?.file;
  if (!database || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) throw new Error("Mind acceptance needs its own temporary SQLite database");
  const root = await mkdtemp(join(tmpdir(), "chrona-mind-runtime-"));
  const previousKey = process.env.API_KEY;
  process.env.API_KEY = "mind-offline-acceptance";
  resetEnvCacheForTests();
  const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
  const runtime = createStewardRuntime(db, { provider: null, dataDir: root, sandbox: { ...sandbox.health, startModule: sandbox.startModule } });
  async function close() {
    try { await runtime.stop(); } finally {
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      await rm(dirname(database!), { recursive: true, force: true });
      if (previousKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = previousKey;
      resetEnvCacheForTests();
    }
  }
  try {
    await symlink(resolve(import.meta.dir, "../../../../../node_modules"), join(root, "node_modules"), "dir");
    const workspace = await db.workspace.create({ data: { name: "Mind production SDK acceptance" } });
    async function install(name: string, source?: string) {
      const hash = `mind-runtime-${name}`, code = join(root, "platform/store", hash);
      if (source) {
        await cp(source, code, { recursive: true, filter: path => path !== join(source, "node_modules") });
        if (name === "web") await symlink(join(source, "node_modules"), join(code, "node_modules"), "dir");
      } else {
        await mkdir(code, { recursive: true });
        const parameters = { type: "object", properties: { input: { type: "string" } }, required: ["input"] };
        await writeFile(join(code, "module.json"), JSON.stringify({
          name, description: "Authenticated signal sender fixture", entry: "index.ts", effects: [], tests: ["test.ts"], uses: ["mind.signal", "mind.note", "mind.agenda"],
          tools: [
            { name: "emit", description: "Forward one bounded signal", visibility: ["owner"], parameters, output: { type: "object", properties: { signalId: { type: "string" }, associations: { type: "array", items: { type: "string" } }, duplicate: { type: "boolean" } }, required: ["signalId", "associations", "duplicate"], additionalProperties: false } },
            { name: "attempt-note", description: "Attempt a mutation as this ordinary module", visibility: ["owner"], parameters,
                output: {}
            },
            { name: "attempt-agenda", description: "Attempt a private read as this ordinary module", visibility: ["owner"], parameters,
                output: {}
            },
          ],
        }));
        await writeFile(join(code, "index.ts"), `import { chrona, on, ModelError } from "chrona";
          on("tool", async ({ id, args }) => {
            const input = String(args.input);
            if (input.length > 32_000) throw new ModelError("invalid", "Signal fixture input exceeds 32000 characters");
            return { result: await chrona.call(
              { moduleId: chrona.dependencies.mind, tool: id === "emit" ? "signal" : id === "attempt-note" ? "note" : "agenda" },
              JSON.parse(input)
            ) };
          });`);
      }
      const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
      const app = await db.module.create({ data: { workspaceId: workspace.id, name, status: "active", activeHash: hash } });
      await db.moduleVersion.create({ data: { moduleId: app.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return app;
    }
    const web = await install("web", join(import.meta.dir, "external/web"));
    const files = withFiles ? await install("files", join(import.meta.dir, "external/files")) : null;
    const mind = await install("mind", join(import.meta.dir, "external/mind"));
    const sender = await install("evidence-source");
    const otherSender = await install("other-source");
    const app = await createServerApp({ steward: runtime });
    const request = (target: string, args: Args = {}, key: string | null = "mind-offline-acceptance", page?: PageRef) => app.request("/api/web/call", {
      method: "POST", headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) }, body: JSON.stringify({ target, args, ...(page ? { page } : {}) }),
    });
    async function call(target: string, args: Args = {}) {
      const response = await request(target, args), body = await response.json();
      if (response.status !== 200) throw new Error(`${target}: ${response.status} ${JSON.stringify(body)}`);
      return body;
    }
    async function activate(module: typeof mind) {
      const now = new Date().toISOString();
      return moduleSupervisor(runtime.ports).deliver(module.id, module.activeHash!, { trigger: { kind: "activated", id: "activated", firedAt: now }, now, params: {} });
    }
    async function page(id: string): Promise<PageRef> {
      const response = await app.request(`/api/web/pages/mind/${id}`, { headers: { authorization: "Bearer mind-offline-acceptance" } });
      const value = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(200);
      expect(value).toMatchObject({ module: "mind", moduleId: mind.id, id, ...(id === "settings" ? { purpose: "settings" } : {}) });
      expect(value.revision).toBeString();
      return { module: value.module, id: value.id, revision: value.revision };
    }
    const privateFile = join(root, "platform/data", mind.id, "mind-v1.json");
    return { db, root, runtime, web, mind, files, sender, otherSender, request, call, activate, page, privateFile, close };
  } catch (error) { await close(); throw error; }
}
let current: Awaited<ReturnType<typeof fixture>> | undefined;
afterEach(async () => { await current?.close(); current = undefined; });

// Production auth, routing, manifests and SDK subprocesses; no Provider or kernel ticker.
// Mind starts with proactive checks disabled, and every case asserts that no Agent Run was created.
test("Mind owner mutations are durable and replay exact keys across SDK restart", async () => {
  const f = current = await fixture();
  for (const key of [null, "wrong-key"]) expect((await f.request("mind.ui-agenda", {}, key)).status).toBe(401);
  const settings = await f.call("mind.ui-settings");
  expect(settings.enabled).toBe(false);
  const args = { "request-key": "create-once", title: "等申请材料确认", project: "application", status: "waiting-external" };
  const first = await f.call("mind.note", args);
  expect(first.concern).toMatchObject({ title: args.title, project: args.project, status: args.status });
  expect(await f.call("mind.note", args)).toEqual(first);
  expect((await f.request("mind.note", { ...args, title: "Changed" })).status).toBe(409);
  await moduleSupervisor(f.runtime.ports).settleModule(f.mind.id);
  expect(await f.call("mind.note", args)).toEqual(first);
  const agenda = await f.call("mind.ui-agenda");
  expect(agenda.concerns).toHaveLength(1);
  expect(agenda.concerns[0].id).toBe(first.concern.id);
  expect((await stat(f.privateFile)).mode & 0o777).toBe(0o600);
  expect(await f.db.run.count()).toBe(0);
}, 30_000);

test("Mind binds signals to the SDK sender, matches every awaited field and replays exact receipts", async () => {
  const f = current = await fixture();
  const matcher = { source: "evidence-source", moduleId: f.sender.id, event: "application.reply", ref: "application-1", thread: "thread-1", from: "office", domain: "example.test", textAll: ["材料", "收到"] };
  const concern = (await f.call("mind.note", { "request-key": "waiting", title: "等确认", awaiting: JSON.stringify([matcher]) })).concern;
  // Each decoy disagrees in exactly one required dimension. A partial match must never associate it.
  const mismatches: Args = { source: "other-source", moduleId: f.otherSender.id, event: "other.event", ref: "application-2", thread: "other-thread", from: "other-office", domain: "other.test", textAll: ["材料", "not-present"] };
  for (const [field, value] of Object.entries(mismatches)) {
    await f.call("mind.note", { "request-key": `decoy-${field}`, title: `Unrelated ${field}`, awaiting: JSON.stringify([{ ...matcher, [field]: value }]) });
  }
  const signal = { "request-key": "signal-once", "event-id": "reply-1", event: "application.reply", ref: "application-1", version: "v1", thread: "thread-1", from: "office", domain: "example.test", text: "材料已收到，已完成", "occurred-at": new Date().toISOString() };
  const emit = (args: Args, source = "evidence-source") => f.call(`${source}.emit`, { input: JSON.stringify(args) });
  const output = await emit(signal);
  expect(output).toEqual({ signalId: expect.any(String), associations: [concern.id], duplicate: false });
  // A request-key replay returns the original output, including duplicate:false.
  expect(await emit(signal)).toEqual(output);
  // A new receipt for the same source event explicitly reports event deduplication.
  expect(await emit({ ...signal, "request-key": "same-event-new-key" })).toEqual({ ...output, duplicate: true });
  const changed = await f.request("evidence-source.emit", { input: JSON.stringify({ ...signal, "request-key": "changed-event", version: "v2" }) });
  expect(changed.status, await changed.text()).toBe(409);
  const other = await emit(signal, "other-source");
  expect(other.associations).toEqual([]);
  expect(other.signalId).not.toBe(output.signalId);
  for (const forged of [{ moduleId: f.otherSender.id }, { source: "other-source" }, { caller: { kind: "owner", via: "web" } }]) {
    const response = await f.request("evidence-source.emit", { input: JSON.stringify({ ...signal, "request-key": "forged", ...forged }) });
    expect(response.status, await response.text()).toBe(400);
  }
  await moduleSupervisor(f.runtime.ports).settleModule(f.mind.id);
  await moduleSupervisor(f.runtime.ports).settleModule(f.sender.id);
  expect(await emit(signal)).toEqual(output);
  const agenda = await f.call("mind.ui-agenda");
  expect(agenda.concerns.find((item: Args) => item.id === concern.id)).toEqual(concern);
  const state = JSON.parse(await readFile(f.privateFile, "utf8"));
  expect(state.signals).toHaveLength(2);
  expect(state.signals.find((item: Args) => item.id === output.signalId)).toMatchObject({ source: "evidence-source", moduleId: f.sender.id, eventId: "reply-1", associations: [concern.id] });
  expect(state.decisions).toEqual([]);
  expect(await f.db.run.count()).toBe(0);
}, 30_000);

test("Mind rejects ordinary-module owner claims and loses revoked Web owner authority immediately", async () => {
  const f = current = await fixture();
  const args = { "request-key": "owner-only", title: "Owner concern" };
  const saved = await f.call("mind.note", args);
  for (const [tool, input] of [["attempt-note", { ...args, "request-key": "module-write" }], ["attempt-agenda", {}]] as const) {
    const response = await f.request(`evidence-source.${tool}`, { input: JSON.stringify(input) });
    expect(response.status, await response.text()).toBe(403);
  }
  const forged = await f.request("evidence-source.attempt-note", { input: JSON.stringify({ ...args, caller: { kind: "owner", via: "web" } }) });
  expect(forged.status, await forged.text()).toBe(403);
  const before = await readFile(f.privateFile, "utf8");
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.web.id, hash: f.web.activeHash! } } });
  const manifest = moduleManifestSchema.parse(version.manifest);
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { manifest: { ...manifest, authority: undefined, uses: [] } } });
  for (const [target, input] of [["mind.note", args], ["mind.note", { ...args, "request-key": "revoked", title: "Unauthorized" }], ["mind.ui-agenda", {}], ["mind.ui-settings", { enabled: true }]] as const) {
    const response = await f.request(target, input);
    expect(response.status, await response.text()).toBe(404);
  }
  expect(await readFile(f.privateFile, "utf8")).toBe(before);
  expect(JSON.parse(before).concerns).toEqual([saved.concern]);
  expect(await f.db.run.count()).toBe(0);
}, 30_000);

test("Mind activation registers its main and settings pages with current contract pins", async () => {
  const f = current = await fixture();
  await f.activate(f.web);
  await f.activate(f.mind);
  const main = await f.page("main"), settings = await f.page("settings");
  const read = await f.request("mind.ui-agenda", {}, "mind-offline-acceptance", main);
  expect(read.status, await read.clone().text()).toBe(200);
  expect((await read.json()).concerns).toEqual([]);
  const save = await f.request("mind.ui-settings", { "interval-minutes": "30" }, "mind-offline-acceptance", settings);
  expect(save.status, await save.clone().text()).toBe(200);
  expect(await save.json()).toMatchObject({ enabled: false, intervalMinutes: 30 });
  await f.activate(f.mind);
  const stale = await f.request("mind.ui-settings", {}, "mind-offline-acceptance", settings);
  expect(stale.status, await stale.text()).toBe(409);
  const refreshed = await f.page("settings");
  expect(refreshed.revision).not.toBe(settings.revision);
  expect(await f.call("mind.ui-settings")).toMatchObject({ enabled: false, intervalMinutes: 30 });
  expect(await f.db.run.count()).toBe(0);
}, 30_000);

test("Mind timer observes an actual Files tool through pinned SDK contracts without launching reasoning during quiet hours", async () => {
  const f = current = await fixture(true);
  await f.activate(f.web);
  await f.activate(f.mind);
  await f.call("files.write", { path: "reports/status.txt", content: "First observation" });
  const configured = await f.call("mind.ui-sources", { paths: "reports/status.txt" });
  expect(configured.sources[0]).toMatchObject({ path: "reports/status.txt", moduleId: f.files!.id });
  await f.call("mind.ui-settings", { enabled: true, timezone: "UTC", "daily-time": "23:59" });
  async function fire(minute: string) {
    const now = new Date(`2026-11-11T00:${minute}:00.000Z`);
    f.runtime.ports.now = () => now;
    await f.db.schedule.updateMany({ where: { moduleId: f.mind.id, mode: "timer", status: "active" }, data: { nextAt: now } });
    await drainTimers(f.runtime.ports, f.mind.workspaceId);
    const deliveries = await f.db.moduleInvocation.findMany({ where: { targetModuleId: f.mind.id, mode: "timer" } });
    expect(deliveries.every(row => row.status === "succeeded")).toBe(true);
    return JSON.parse(await readFile(f.privateFile, "utf8"));
  }
  expect((await fire("01")).signals).toMatchObject([{ source: "files", moduleId: f.files!.id, text: "First observation" }]);
  expect((await fire("02")).signals).toHaveLength(1);
  await f.call("files.write", { path: "reports/status.txt", content: "Changed observation" });
  expect((await fire("03")).signals.at(-1)).toMatchObject({ text: "Changed observation" });
  await f.call("mind.ui-settings", { enabled: false });
  await f.call("files.write", { path: "reports/status.txt", content: "Paused observation" });
  expect((await fire("04")).signals).toHaveLength(2);
  expect(await f.db.run.count()).toBe(0);
}, 30_000);
