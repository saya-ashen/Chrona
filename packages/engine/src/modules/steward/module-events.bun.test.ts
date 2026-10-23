import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { createLocalTestSource } from "../../../../integrations/src/steward/local-test-source";
import { createStewardService } from "./service";
import { processModuleInbound } from "./module-inbound";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "./test-db";
import { testFilesContent } from "./test-content";
import type { StewardPorts } from "./ports";
const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
(sandbox.health.available ? test : test.skip)("real sandbox SDK serves schedule, inbound and tool on one process", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cm-events-");
  const source = createLocalTestSource();
  const now = new Date("2026-10-21T04:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, deliveries: [], chat: null, connectors: [source.adapter], sandbox: { available: true, startModule: sandbox.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "sdk" } });
  const api = createStewardService(ports).forWorkspace(workspace.id);
  await testFilesContent(ports, workspace.id);
  const connector = await api.connectors.create({ kind: "local_test", label: "mail" });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "events", activeHash: "sdk" } });
  const manifest = { name: "events", entry: "index.ts", tests: ["test.ts"], effects: ["notify_user"], triggers: [{ id: "daily", schedule: { kind: "every", minutes: 5 } }, { id: "mail", inbound: { connector: connector.id, match: { from: "*@example.com" } } }], tools: [{ name: "read", description: "Read event count", parameters: { type: "object", properties: {}, required: [] } }] };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "sdk", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/sdk"); await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `
import { on, chrona } from '/chrona/sdk.ts';
let count = 0;
on('schedule', async () => { count++; await chrona.notify({ key: 'schedule', level: 'now', title: 'Scheduled', body: String(count) }); });
on('inbound', async ev => { count++; await chrona.notify({ key: 'mail', level: 'now', title: 'Mail', body: ev.item.body }); return { handled: ev.item.subject !== 'fallback' }; });
on('tool', async () => ({ result: { count } }));
`);
  await db.schedule.create({ data: { workspaceId: workspace.id, moduleId: module.id, triggerId: "daily", mode: "module", rule: { kind: "every", minutes: 5 }, text: "daily", createdBy: "chrona", nextAt: now } });
  expect(await api.schedules.fireDue()).toBe(1);
  for (const subject of ["handled", "fallback"]) {
    source.push([{ externalId: subject, from: "sender@example.com", subject, body: "mail body", receivedAt: now.toISOString(), url: null }]);
    await api.connectors.sync(connector.id);
    await processModuleInbound(ports, workspace.id);
    expect((await db.inboundItem.findUniqueOrThrow({ where: { connectorId_externalId: { connectorId: connector.id, externalId: subject } } })).status).toBe(subject === "handled" ? "delivered" : "new");
  }
  expect(await api.modules.callTool("m_events_read", {})).toEqual({ result: { count: 3 } });
  expect(await db.moduleRun.count({ where: { error: null, exitCode: 0 } })).toBe(4);
  expect(await db.moduleCall.count({ where: { status: "executed" } })).toBe(3);
  expect(await db.notification.count()).toBe(3);
});
