import { expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleSupervisor } from "./module-supervisor";
import { callSync, kernelOrigin, drainCalls } from "./module-calls";
import { notificationItems } from "./notify-user";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { resolveBuiltinRelease } from "./module-release";
import { testDb } from "./test-db";
import { registerSystemModules } from "./system-modules";
import type { StewardPorts } from "./ports";

const transportManifest = (name: string) => moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["notify.channel"], tests: ["test.ts"],
  tools: [{ name: "deliver", description: "Offline delivery", visibility: ["modules"], parameters: { type: "object", required: ["key", "title", "body"], properties: {
    key: { type: "string" }, title: { type: "string" }, body: { type: "string" }, format: { type: "string", enum: ["text", "markdown"] }, link: { type: "string" }, recipient: { type: "string" }, approval: { type: "string" }, scoped: { type: "boolean" } } },
  output: { type: "object", properties: { outcome: { const: "accepted" }, receiptRef: { type: "string" } }, required: ["outcome", "receiptRef"], additionalProperties: false } }] });

test("real notify SDK uses two external callbacks, persists target bindings and isolates a paused owner", async () => {
  registerSystemModules();
  const dataDir = await mkdtemp("/tmp/chrona-notify-routed-"), resources = join(dataDir, "platform/builtin"), db = testDb();
  const runtime = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, moduleBuiltinResources: resources, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  try {
    await mkdir(resources, { recursive: true }); await cp(join(import.meta.dirname, "builtin/notify"), join(resources, "notify"), { recursive: true });
    await seedTestModuleRelease(resources, "notify");
    const release = await resolveBuiltinRelease(ports, "notify");
    const workspaceId = (await db.workspace.create({ data: { name: "notify-routed" } })).id;
    const notify = await db.module.create({ data: { workspaceId, name: "notify", builtin: true, activeHash: release.hash } });
    await db.moduleVersion.create({ data: { moduleId: notify.id, hash: release.hash, manifest: release.manifest, source: "user", status: "approved", intent: {}, report: {} } });
    await mkdir(join(dataDir, "platform/store", release.hash), { recursive: true }); await cp(release.codeDir, join(dataDir, "platform/store", release.hash), { recursive: true });
    async function transport(name: string, hash: string) {
      const manifest = transportManifest(name), code = join(dataDir, "platform/store", hash);
      await mkdir(code, { recursive: true }); await writeFile(join(code, "module.json"), JSON.stringify(manifest));
      await writeFile(join(code, "index.ts"), `import {on,chrona} from "chrona"; import {appendFileSync} from "node:fs"; import {join} from "node:path";
on("tool",async ev=>{appendFileSync(join(chrona.paths.data,"sent.jsonl"),JSON.stringify({args:ev.args,caller:ev.caller})+"\\n");return {result:{outcome:"accepted",receiptRef:ev.args.key}};});`);
      const row = await db.module.create({ data: { workspaceId, name, activeHash: hash } });
      await db.moduleVersion.create({ data: { moduleId: row.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      return row;
    }
    const alpha = await transport("alpha", "a".repeat(64)), beta = await transport("beta", "b".repeat(64));
    for (const row of [alpha, beta, alpha]) {
      const origin = { workspaceId, caller: { kind: "module" as const, module: row.name, moduleId: row.id, hash: row.activeHash! }, chain: [], path: [] };
      expect((await callSync(ports, origin, "notify.channel", { channel: row.name, tool: "deliver", ready: true, at: new Date().toISOString() })).output).toEqual({ ready: true });
    }
    const kernel = kernelOrigin(workspaceId);
    async function send(key: string) {
      await callSync(ports, kernel, "notify.send", { key, title: key, body: "body", level: "now", responds: true });
      for (let i = 0; i < 150; i++) {
        await drainCalls(ports, workspaceId);
        const output = (await callSync(ports, kernel, "notify.list", {})).output as { items: { title: string; status: string }[] };
        if (output.items.some(item => item.title === key && item.status === "sent")) return;
        await Bun.sleep(20);
      }
      throw new Error(`notification not settled: ${key}`);
    }
    await send("one"); await send("one");
    const sent = async (row: typeof alpha) => { try { return (await readFile(join(dataDir, "platform/data", row.id, "sent.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } };
    expect((await sent(alpha)).map(item => item.args.title)).toEqual(["one"]); expect(await sent(beta)).toEqual([]);
    await db.module.update({ where: { id: alpha.id }, data: { status: "paused" } });
    await send("two"); expect((await sent(beta)).map(item => item.args.title)).toEqual(["two"]);
    expect((await sent(alpha))).toHaveLength(1);
    expect((await sent(beta))[0].caller).toMatchObject({ kind: "module", module: "notify", moduleId: notify.id });
    const calls = await db.moduleInvocation.findMany({ where: { workspaceId, tool: "deliver" } });
    expect(calls).toHaveLength(2);
    for (const invocation of calls) expect(await db.audit.findUnique({ where: { id: `module-invocation-target:${invocation.id}` } })).toMatchObject({ details: { moduleId: invocation.target === "alpha" ? alpha.id : beta.id, contractHash: expect.any(String) } });
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);

test("notification owner projection preserves registered channel names and bounds their length", () => {
  const item = { id: "n1", moduleId: null, sessionId: null, level: "now", channel: "external-mail", status: "sent", title: "Hi", body: "Body", link: null, attempts: 1, lastError: null, createdAt: "2026-10-28T00:00:00.000Z", sentAt: null, feedback: null } as const;
  expect(notificationItems({ items: [{ ...item, format: "markdown" }, { ...item, id: "n2", status: "unknown" }] })).toEqual([item]);
  expect(notificationItems({ items: [{ ...item, channel: "new-channel" }] })).toEqual([{ ...item, channel: "new-channel" }]);
  expect(notificationItems({ items: [{ ...item, channel: "a".repeat(120) }] })).toEqual([{ ...item, channel: "a".repeat(120) }]);
  expect(notificationItems({ items: [{ ...item, channel: "a".repeat(121) }] })).toEqual([]);
  expect(notificationItems({ items: [{ ...item, channel: "" }] })).toEqual([]);
  expect(notificationItems(null)).toEqual([]);
});
