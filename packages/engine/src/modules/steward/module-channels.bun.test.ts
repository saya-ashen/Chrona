import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { moduleChannel } from "./module-channels";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test("a channel module reports readiness and answers deliver events with the outcome", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-channel-");
  const sandbox = createScriptSandbox({ dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-23T00:00:00Z"), publicUrl: null, deliveries: [], chat: null, sandbox: { ...sandbox.health, startModule: sandbox.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "channel" } });
  const channel = moduleChannel(ports, "chrona_qqbot");
  expect(await channel.delivery.send({ idempotencyKey: "n0", title: "t", body: "b", link: null, recipient: null })).toMatchObject({ outcome: "rejected", retryable: true });
  const manifest = moduleManifestSchema.parse({ name: "relay", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, channel: "chrona_qqbot", effects: ["owner"] });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "relay", status: "active", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, intent: {}, source: "user", report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/v1");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `import { chrona, on } from "chrona";
await chrona.channel({ ready: true });
on("deliver", ev => ({ result: ev.message.recipient === "bad" ? { outcome: "rejected", retryable: false, error: "nope" } : { outcome: "accepted", receiptRef: "r:" + ev.message.idempotencyKey } }));`);
  await moduleSupervisor(ports).reconcile();
  for (let i = 0; i < 100 && !await channel.bound(); i++) await Bun.sleep(20);
  expect(await channel.bound()).toBe(true);
  expect(await channel.delivery.send({ idempotencyKey: "n1", title: "t", body: "b", link: null, recipient: null })).toEqual({ outcome: "accepted", receiptRef: "r:n1" });
  expect(await channel.delivery.send({ idempotencyKey: "n2", title: "t", body: "b", link: null, recipient: "bad" })).toEqual({ outcome: "rejected", retryable: false, error: "nope" });
}, 30_000);
