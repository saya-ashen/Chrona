import { expect, test } from "bun:test";
import "./module-effects";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { registerBuiltins } from "./module-builtin";
import { moduleSupervisor } from "./module-supervisor";
import { callsSettled, drainCalls } from "./module-calls";
import { createNotificationsView, moveLegacyNotifications, notificationItems, notifyUser } from "./notify-user";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
// A stand-in for the qq module: same interface (qq.deliver for notify, notify.channel readiness), no network, records what it was asked to send.
const fakeQq = {
  "module.json": JSON.stringify({ name: "qq", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: ["notify.channel"], tests: ["test.ts"],
    tools: [{ name: "deliver", description: "Fake QQ delivery", visibility: ["modules"], callers: ["notify"], output: { type: "object", properties: { outcome: { const: "accepted" }, receiptRef: { type: "string" } }, required: ["outcome", "receiptRef"], additionalProperties: false }, parameters: { type: "object", required: ["key", "title", "body"], properties: {
      key: { type: "string" }, title: { type: "string" }, body: { type: "string" }, link: { type: "string" }, recipient: { type: "string" }, approval: { type: "string" }, scoped: { type: "boolean" } } } }] }),
  "index.ts": `// @ts-expect-error SDK at run time
import { chrona, on } from "chrona";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
on("tool", async event => { appendFileSync(join(chrona.paths.data, "sent.jsonl"), JSON.stringify({ args: event.args, caller: event.caller }) + "\\n"); return { result: { outcome: "accepted", receiptRef: "chrona_qq:fake-" + event.args.key } }; });
const report = async () => { try { await chrona.call("notify.channel", { channel: "chrona_qqbot", ready: true, at: new Date().toISOString() }, { mode: "async", key: "ready:" + Date.now() }); } catch { setTimeout(report, 500); } };
void report();
`,
  "test.ts": "// Fake module: the end-to-end test is its check.\n",
};

if (!sandbox.health.available) console.info("SKIP notify end to end: module sandbox unavailable");
(sandbox.health.available ? test : test.skip)("Chrona → notify.send → notify module → qq.deliver (fake exit) → receipt; legacy rows are copied and delivered", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-notify-e2e-"), resources = join(dataDir, "builtin");
  await mkdir(join(resources, "qq"), { recursive: true });
  await cp(resolve(import.meta.dirname, "builtin/notify"), join(resources, "notify"), { recursive: true });
  for (const [name, content] of Object.entries(fakeQq)) await writeFile(join(resources, "qq", name), content);
  const db = testDb();
  const runtime = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, moduleBuiltinResources: resources, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } };
  try {
    // No quiet hours: the test runs on the real clock, at any time of day.
    const workspace = await db.workspace.create({ data: { name: "notify", settings: { notifications: { dailyCap: 5, quietHours: null, timezone: "UTC", digestAt: "09:00" } } } }), w = workspace.id;
    // A row from before the notify module existed, still waiting to be sent, and one whose send lease was held.
    await db.notification.create({ data: { workspaceId: w, level: "now", channel: "chrona_qqbot", status: "queued", title: "Old pending", body: "From the old outbox", idempotencyKey: "legacy:pending", nextAttemptAt: new Date() } });
    await db.notification.create({ data: { workspaceId: w, level: "now", channel: "chrona_qqbot", status: "queued", title: "Old leased", body: "Maybe sent", idempotencyKey: "legacy:leased", leaseToken: "t", leaseUntil: new Date() } });
    await registerBuiltins(ports, w);
    for (const name of ["notify", "qq"]) expect(await db.module.findFirstOrThrow({ where: { name } })).toMatchObject({ status: "active", activeHash: expect.any(String) });
    await moduleSupervisor(ports).reconcile();
    const view = createNotificationsView(ports, w);
    async function until(condition: () => Promise<boolean>) {
      for (let i = 0; i < 150; i++) { void drainCalls(ports, w); await callsSettled(ports); if (await condition()) return; await Bun.sleep(100); }
      throw new Error(`Not reached: ${JSON.stringify(await view.list())}`);
    }
    await until(async () => (await view.status())?.chat.bound === true);
    expect(await moveLegacyNotifications(ports, w)).toBe(2);
    expect(await moveLegacyNotifications(ports, w)).toBe(0);
    await notifyUser(db, ports, w, { level: "now", title: "Build finished", body: "All green", key: "e2e:1" });
    await notifyUser(db, ports, w, { level: "now", title: "Build finished", body: "All green", key: "e2e:1" });
    const sent = (title: string) => async () => (await view.list()).some(item => item.title === title && item.status === "sent");
    await until(sent("Build finished")); await until(sent("Old pending"));
    const items = await view.list();
    expect(items.find(item => item.title === "Build finished")).toMatchObject({ channel: "chrona_qqbot", status: "sent", attempts: 1 });
    expect(items.find(item => item.title === "Old leased")).toMatchObject({ status: "uncertain" });
    const qq = await db.module.findFirstOrThrow({ where: { name: "qq" } });
    const lines = (await readFile(join(dataDir, "platform/data", qq.id, "sent.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    // Each notice reached the exit exactly once, from the notify module (the real caller), never the leased legacy row.
    expect(lines.map(line => line.args.title).sort()).toEqual(["Build finished", "Old pending"]);
    expect(lines.every(line => line.caller.kind === "module" && line.caller.module === "notify")).toBe(true);
    expect(await db.moduleInvocation.count({ where: { target: "qq", tool: "deliver", status: "succeeded" } })).toBe(2);
  } finally { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
}, 60_000);

test("the owner's notification list keeps valid items and ignores extra fields from a customized notify module", () => {
  const item = { id: "n1", moduleId: null, sessionId: null, level: "now", channel: "chrona_qqbot", status: "sent", title: "Hi", body: "Body", link: null, attempts: 1, lastError: null, createdAt: "2026-10-28T00:00:00.000Z", sentAt: null, feedback: null } as const;
  expect(notificationItems({ items: [{ ...item, format: "markdown" }, { ...item, id: "n2", status: "unknown" }] })).toEqual([item]);
  expect(notificationItems(null)).toEqual([]);
});
