import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { smokeRun } from "./module-probe";
import { checkContinuity, runTests } from "./module-continuity";
import { moduleContext, type ContinuityReport, type TestReport } from "./module-context";
import { testDb } from "./test-db";
import { notices } from "./test-notices";

const sandbox = createScriptSandbox({  });
(sandbox.health.available ? test : test.skip)("SDK routed calls, startup and copied-data continuity run without business probes", async () => {
  const dir = await mkdtemp("/tmp/cb-sdk-"), db = testDb();
  try {
    const runtime = createScriptSandbox({ dataDir: dir });
    const code = join(dir, "platform/store/sdk"); await mkdir(code, { recursive: true });
    const manifest = moduleManifestSchema.parse({ name: "sdk-check", entry: "index.ts", tests: ["test.ts"], effects: [], uses: ["notify.send", "agent.run", "agent.read"], model: { tier: "fast", maxCalls: 1, maxOutputTokens: 20 }, data: { schema: 2, migrate: "migrate.ts" },
      keepAlive: true,
      tools: [{ name: "lookup", description: "Lookup", idempotent: true, parameters: { type: "object", properties: {} },
          output: {}
    }] });
    await writeFile(join(code, "module.json"), JSON.stringify(manifest));
    await writeFile(join(code, "index.ts"), `
import { on, chrona } from 'chrona';
import { existsSync, readFileSync } from 'node:fs';
on('tool', async ev => {
  if (ev.id !== 'lookup') throw new Error('unexpected tool');
  const state = chrona.paths.data + '/state';
  if (existsSync(state) && readFileSync(state, 'utf8') !== 'migrated') throw new Error('migration missing');
  const key = ev.id + ':' + ev.firedAt;
  const args = { kind: 'completion', prompt: 'Never send this to a real model', providerOptions: { maxOutputTokens: 20 } };
  const started = await chrona.call({moduleId:chrona.dependencies.agent,tool:'run'}, args, { key });
  const replayed = await chrona.call({moduleId:chrona.dependencies.agent,tool:'run'}, args, { key });
  if (!started.runId || !started.contextId || replayed.runId !== started.runId || replayed.contextId !== started.contextId) throw new Error('completion receipt changed');
  const page = await chrona.call({moduleId:chrona.dependencies.agent,tool:'read'}, { runId: started.runId });
  if (!page.ended || page.run.runId !== started.runId || page.run.contextId !== started.contextId || page.run.status !== 'finished' || page.run.active) throw new Error('completion failed or unconfirmed');
  const completion = page.items.find(item => item.kind === 'completion')?.payload;
  if (!completion || !['Chrona test model response', 'Stub summary'].includes(completion.text)) throw new Error('unexpected model response');
  if (!Number.isInteger(completion.inputTokens) || completion.inputTokens < 0 || !Number.isInteger(completion.outputTokens) || completion.outputTokens < 0 || completion.outputTokens > args.providerOptions.maxOutputTokens) throw new Error('unexpected model usage');
  const params = { key, level: 'now', title: 'Build', body: completion.text };
  await chrona.call({moduleId:chrona.dependencies.notify,tool:'send'}, params, { mode: 'async', key });
  if (!(await chrona.call({moduleId:chrona.dependencies.notify,tool:'send'}, params, { mode: 'async', key })).duplicate) throw new Error('dedup missing');
});
`);
    await writeFile(join(code, "migrate.ts"), `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.CHRONA_DATA + '/state', 'migrated');`);
    await writeFile(join(code, "test.ts"), `
import { startModule } from 'chrona/testing';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
if (${runtime.health.isolated}) for (const path of ['/node_modules/chrona/sdk.ts', '/node_modules/chrona/testing.ts']) assert.throws(() => writeFileSync(path, 'changed'));
const module = await startModule('index.ts', { stubs: {
  'agent.run': (_args, options) => ({ runId: 'stub:' + options.key, contextId: 'stub-context', status: 'finished', active: false }),
  'agent.read': args => ({ run: { runId: args.runId, contextId: 'stub-context', status: 'finished', active: false }, items: [{ sequence: 0, at: new Date(0).toISOString(), kind: 'completion', payload: { text: 'Stub summary', inputTokens: 1, outputTokens: 2 } }], nextCursor: null, ended: true, interactions: [] }),
} });
try {
  const now = '2026-10-21T04:00:00.000Z';
  const reply = await module.send({ trigger: { kind: 'tool', id: 'lookup', args: {}, firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined);
  assert.deepEqual(module.calls.map(call => typeof call.params.target === "string" ? call.params.target : call.params.target.moduleId + "." + call.params.target.tool), ['agent.run', 'agent.run', 'agent.read', 'notify.send', 'notify.send']);
  assert.deepEqual(module.calls[0].params.args, { kind: 'completion', prompt: 'Never send this to a real model', providerOptions: { maxOutputTokens: 20 } });
  assert.deepEqual(module.calls[0].params.args, module.calls[1].params.args);
  assert.equal(module.calls[0].params.key, 'lookup:' + now);
  assert.equal(module.calls[1].params.key, module.calls[0].params.key);
  assert.deepEqual(module.calls[2].params.args, { runId: 'stub:lookup:' + now });
  assert.equal(module.calls[3].params.args.body, 'Stub summary');
  assert.equal(module.calls[3].params.key, 'lookup:' + now);
} finally { await module.stop(); }
const defaultModule = await startModule('index.ts');
try {
  const now = '2026-10-21T04:00:00.000Z';
  const reply = await defaultModule.send({ trigger: { kind: 'tool', id: 'lookup', args: {}, firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined);
  assert.deepEqual(defaultModule.calls.map(call => call.params.target.tool), ['run', 'run', 'read', 'send', 'send']);
  assert.deepEqual(defaultModule.calls[2].params.args, { runId: 'agent.run:lookup:' + now });
  assert.equal(defaultModule.calls[3].params.args.body, 'Chrona test model response');
} finally { await defaultModule.stop(); }
`);
    const workspace = await db.workspace.create({ data: { name: "build checks" } });
    const context = moduleContext({ db, dataDir: dir, now: () => new Date("2026-10-21T04:00:00Z"), publicUrl: null, sandbox: { ...runtime.health, runModule: runtime.runModule, startModule: runtime.startModule } }, workspace.id);
    const tests: TestReport = [];
    expect(await runTests(context, code, manifest, tests)).toBe(true);
    expect(tests).toMatchObject([{ exitCode: 0 }]);
    expect(await smokeRun(context, code, manifest)).toEqual([]);
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: "sdk-check", activeHash: "old", dataSchema: 1 } });
    const live = join(dir, "platform/data", module.id); await mkdir(live, { recursive: true }); await writeFile(join(live, "state"), "original");
    const continuity: ContinuityReport = { status: "skipped", fromSchema: 1, toSchema: 2, migrated: false };
    expect(await checkContinuity(context, code, module, manifest, continuity)).toEqual({ passed: true, needsMigration: true });
    expect(continuity).toMatchObject({ status: "passed", migrated: true });
    expect(continuity.tests).toMatchObject([{ exitCode: 0 }]);
    expect(await readFile(join(live, "state"), "utf8")).toBe("original");
    expect((await notices(db)).length).toBe(0);
    expect(await db.run.count()).toBe(0);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
