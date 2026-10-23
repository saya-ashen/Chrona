import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { smokeRun, probeKeys } from "./module-probe";
import { checkContinuity, runTests } from "./module-continuity";
import { moduleContext, type ContinuityReport, type TestReport } from "./module-context";
import { testDb } from "./test-db";

const sandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
(sandbox.health.available ? test : test.skip)("SDK author helper, smoke, key probe and migrated continuity use fake kernels", async () => {
  const dir = await mkdtemp("/tmp/cb-sdk-"), db = testDb();
  try {
    const code = join(dir, "code"); await mkdir(code);
    const manifest = moduleManifestSchema.parse({ name: "sdk-check", entry: "index.ts", tests: ["test.ts"], effects: ["notify_user", "model"], model: { maxCalls: 1, maxOutputTokens: 20 }, data: { schema: 2, migrate: "migrate.ts" },
      triggers: [{ id: "daily", schedule: { kind: "every", minutes: 5 } }, { id: "mail", inbound: { connector: "box", match: {} } }],
      tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object", properties: {} } }] });
    await writeFile(join(code, "module.json"), JSON.stringify(manifest));
    await writeFile(join(code, "index.ts"), `
import { on, chrona } from '/chrona/sdk.ts';
import { existsSync, readFileSync } from 'node:fs';
on('schedule', async ev => {
  if (existsSync('/data/state') && readFileSync('/data/state', 'utf8') !== 'migrated') throw new Error('migration missing');
  const completion = await chrona.model({ prompt: 'Never send this to a real model', maxOutputTokens: 20 });
  if (!['Chrona test model response', 'Stub summary'].includes(completion.text)) throw new Error('unexpected model response');
  const params = { key: 'daily:' + ev.firedAt, level: 'now', title: 'Build', body: completion.text };
  await chrona.notify(params);
  if ((await chrona.notify(params)).status !== 'duplicate') throw new Error('dedup missing');
  try { await chrona.wakeProvider({ key: 'no', prompt: 'No execution' }); throw new Error('accepted undeclared'); }
  catch (error) { if (!String(error).includes('Undeclared')) throw error; }
});
on('inbound', async ev => { await chrona.notify({ key: 'mail:' + ev.firedAt, level: 'digest', title: 'Mail', body: 'Recorded' }); return { handled: true }; });
on('tool', () => ({ result: 'tool answered' }));
`);
    await writeFile(join(code, "migrate.ts"), `import { writeFileSync } from 'node:fs'; writeFileSync('/data/state', 'migrated');`);
    await writeFile(join(code, "test.ts"), `
import { startModule } from '/chrona/testing.ts';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
for (const path of ['/chrona/sdk.ts', '/chrona/testing.ts']) assert.throws(() => writeFileSync(path, 'changed'));
const module = await startModule('/module/index.ts', { stubs: { model: () => ({ text: 'Stub summary', inputTokens: 1, outputTokens: 2 }) } });
try {
  const now = '2026-10-21T04:00:00.000Z';
  const reply = await module.send({ trigger: { kind: 'schedule', id: 'daily', firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined);
  assert.equal(module.calls.length, 4);
  assert.equal(module.calls[1].params.body, 'Stub summary');
  assert.equal(module.calls[3].method, 'wakeProvider');
} finally { await module.stop(); }
const defaultModule = await startModule('/module/index.ts');
try {
  const now = '2026-10-21T04:00:00.000Z';
  const reply = await defaultModule.send({ trigger: { kind: 'schedule', id: 'daily', firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined);
  assert.equal(defaultModule.calls[1].params.body, 'Chrona test model response');
} finally { await defaultModule.stop(); }
`);
    const workspace = await db.workspace.create({ data: { name: "build checks" } });
    const context = moduleContext({ db, dataDir: dir, now: () => new Date("2026-10-21T04:00:00Z"), publicUrl: null, chat: null, deliveries: [], sandbox: { available: true, runModule: sandbox.runModule, startModule: sandbox.startModule } }, workspace.id);
    const tests: TestReport = [];
    expect(await runTests(context, code, manifest, tests)).toBe(true);
    expect(tests).toMatchObject([{ exitCode: 0 }]);
    expect(await smokeRun(context, code, manifest)).toEqual([]);
    expect(await probeKeys(context, code, manifest)).toEqual({ status: "repeated", keys: ["wake_provider:no"] });
    // Rejected calls are recorded too; a fixed key remains visible in the probe.
    const entry = await readFile(join(code, "index.ts"), "utf8");
    await writeFile(join(code, "index.ts"), entry.replace("key: 'no'", "key: 'no:' + ev.firedAt"));
    expect(await probeKeys(context, code, manifest)).toEqual({ status: "passed" });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: "sdk-check", activeHash: "old", dataSchema: 1 } });
    const live = join(dir, "platform/data", module.id); await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "original");
    const continuity: ContinuityReport = { status: "skipped", fromSchema: 1, toSchema: 2, migrated: false };
    expect(await checkContinuity(context, code, module, manifest, continuity)).toEqual({ passed: true, needsMigration: true });
    expect(continuity).toMatchObject({ status: "passed", migrated: true });
    expect(continuity.effects).toHaveLength(4);
    expect(await readFile(join(live, "state"), "utf8")).toBe("original");
    expect(await db.notification.count()).toBe(0);
    expect(await db.run.count()).toBe(0);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
