import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptSandbox } from "../../../host/src/runtime/script-sandbox";
import { createStewardService } from "../service";
import { moduleSupervisor } from "./module-supervisor";
import { testDb } from "../test-db";
import type { StewardPorts } from "../ports";
import { notices } from "../test-notices";
import { installNotifyTarget } from "../test-notify-target";
import { callsSettled } from "./module-calls";
const sandbox = createScriptSandbox({  });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
(sandbox.health.available ? test : test.skip)("real sandbox SDK serves two routed tools on one process", async () => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cm-events-");
  const now = new Date("2026-10-21T04:00:00Z");
  const runtime = createScriptSandbox({ dataDir });
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, sandbox: { ...runtime.health, startModule: runtime.startModule } };
  cleanups.push(async () => { await callsSettled(ports); await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "sdk" } });
  await installNotifyTarget(ports, workspace.id);
  const api = createStewardService(ports).forWorkspace(workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "event-counter", activeHash: "sdk" } });
  const manifest = { name: "event-counter", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["notify.send"], tools: [{ name: "increment", description: "Increment and notify", parameters: { type: "object", properties: {}, required: [] },
      output: {}
}, { name: "read", description: "Read event count", parameters: { type: "object", properties: {}, required: [] },
      output: {}
}] };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "sdk", manifest, source: "user", intent: {}, report: {}, status: "approved" } });
  const code = join(dataDir, "platform/store/sdk"); await mkdir(code, { recursive: true });
  await writeFile(join(code, "index.ts"), `
import { on, chrona } from 'chrona';
let count = 0;
on('tool', async event => { if (event.id === 'increment') { count++; const key = event.id + ':' + event.firedAt + ':increment'; await chrona.call({moduleId:chrona.dependencies.notify,tool:'send'}, { key, level: 'now', title: 'Incremented', body: String(count) }, { mode: 'async', key }); } return { result: { count } }; });
`);
  expect(await api.modules.callTool("m_event_counter_increment", {})).toEqual({ result: { count: 1 } });
  expect(await api.modules.callTool("m_event_counter_read", {})).toEqual({ result: { count: 1 } });
  await callsSettled(ports);
  expect(await db.moduleRun.count({ where: { moduleId: module.id, error: null, exitCode: 0 } })).toBe(2);
  expect(await db.moduleInvocation.findFirstOrThrow({ where: { target: "notify", tool: "send" } })).toMatchObject({ status: "succeeded", output: { id: expect.any(String), status: "queued", duplicate: false } });
  expect(await db.moduleCall.count({ where: { method: "call", status: { not: "rejected" } } })).toBe(0);
  expect((await notices(db)).length).toBe(1);
});
