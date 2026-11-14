import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreActions } from './core-actions';
import { CoreRuntime } from './core-runtime';
import { CoreExecutionJournal, CoreExecutor, type CoreCall, type Execution } from './core-execution';

const now = '2026-11-13T12:00:00.000Z';
const owner = { subject: 'owner', role: 'owner' as const, scopes: [{}] };
const input = { purpose: 'understand' as const, subject: 'u', revision: 0, visibilityRevision: 0,
 prompt: 'WITHDRAWN-PRIVATE-EXECUTION-PROMPT', tools: ['mind.progress'] };
const run = { runId: 'r1', contextId: 'ctx', status: 'running', active: true };
const fact = { kind: 'tool-result', payload: { type: 'tool-result', value: { runId: 'r1', callId: 'effect',
 target: 'mind.progress', moduleId: 'mind', hash: 'h', status: 'succeeded', outputState: 'complete', output: 'WITHDRAWN-OUTPUT' } } };
function deferred<T>() {
 let resolve!: (value: T) => void;
 const promise = new Promise<T>(done => { resolve = done; });
 return { promise, resolve };
}
function expectScrubbed(e: Execution) {
 expect(e.args).toEqual({}); expect(e.interactions).toEqual([]); expect(e.summary).toBe(''); expect(e.error).toBeNull();
 expect(e.facts.every(f => f.output === undefined)).toBe(true); expect(e.stopRequested).toBe(true);
}

test('real forget completes while Agent read is pending and late payload cannot resurrect withdrawn content', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'mind-forget-read-race-'));
 const store = new CoreMindStore(dir), service = new CoreMindService(store, { now: () => now });
 const actions = new CoreActions(dir, service), started = deferred<void>(), response = deferred<unknown>();
 const runtime = new CoreRuntime(store, service, async target => {
  if (target === 'agent.read') { started.resolve(); return response.promise; }
  throw Error(`Unexpected ${target}`);
 }, () => ({ moduleId: 'mind', hash: 'h' }), actions);
 try {
  let e = runtime.journal.prepare(input, now);
  e = runtime.journal.save({ ...e, ...run, status: 'running' });
  const pending = runtime.executor.reconcile(now); await started.promise;
  const forgotten = service.forget({ actionKey: 'forget', expectedVisibilityRevision: 0,
   target: { kind: 'session', sessionId: 's1' } }, owner);
  await runtime.executor.reconcile(now);
  expect(forgotten.value?.cleanup.mind).toBe('complete'); expect(runtime.cleanupWithdrawn().deferred).toBe(0);
  expectScrubbed(runtime.journal.get(e.id));
  response.resolve({ run, items: [fact], interactions: [{ prompt: 'LATE-WITHDRAWN-INTERACTION' }], ended: false, nextCursor: null });
  await pending;
  const latest = runtime.journal.get(e.id); expectScrubbed(latest);
  expect(latest.runId).toBe(e.runId); expect(latest.contextId).toBe(e.contextId);
  expect(latest.key).toBe(e.key); expect(latest.stopKey).toBe(e.stopKey);
  expect(latest.visibilityRevision).toBe(0); expect(store.read().visibilityRevision).toBe(1);
  expect(runtime.accessForCaller('stale', true, 'r1').execution).toBeUndefined();
  const persisted = new CoreExecutionJournal(dir);
  try { expectScrubbed(persisted.get(e.id)); } finally { persisted.close(); }
 } finally { runtime.close(); actions.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const boundary of ['run', 'admitted', 'stop', 'settle'] as const) test(`withdrawal during ${boundary} preserves scrub, stop flags and current journal revision`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'mind-execution-await-race-')), journal = new CoreExecutionJournal(dir);
 const started = deferred<void>(), response = deferred<unknown>(); let current = true;
 const hold = () => { started.resolve(); return response.promise; };
 const keys: string[] = []; const argumentsSent: Record<string, unknown>[] = [];
 const call: CoreCall = async (target, args, options) => {
  if (target === 'agent.run') { keys.push(options!.key!); argumentsSent.push(structuredClone(args)); return hold(); }
  if (target === 'agent.stop') return hold();
  if (target === 'agent.read') return { run: boundary === 'settle' ? { ...run, active: false, status: 'finished' } : run,
   items: [fact], interactions: [{ prompt: 'LATE-INTERACTION' }], ended: boundary === 'settle', nextCursor: null };
  throw Error(`Unexpected ${target}`);
 };
 try {
  let e = journal.prepare(input, now);
  if (boundary !== 'run') e = journal.save({ ...e, ...run, status: 'running', stopRequested: boundary === 'stop' });
  // A lost run receipt must replay the original command even after withdrawal.
  if (boundary === 'run') e = journal.save({ ...e, status: 'unknown' });
  const executor = new CoreExecutor(journal, call, { current: () => current,
   admitted: async () => { if (boundary === 'admitted') await hold(); },
   settle: async () => { if (boundary === 'settle') await hold(); } });
  const pending = executor.reconcile(now); await started.promise; current = false;
  expect(journal.scrubInvalid(() => false).deferred).toBe(boundary === 'run' ? 1 : 0);
  const latest = journal.get(e.id); latest.revision = 7;
  if (boundary === 'stop') latest.stopConfirmed = true;
  journal.save(latest);
  response.resolve(boundary === 'stop' ? { ...run, stopConfirmed: false } : run);
  await pending;
  const saved = journal.get(e.id); expectScrubbed(saved);
  expect(saved.revision).toBe(7); expect(saved.visibilityRevision).toBe(e.visibilityRevision);
  expect(saved.key).toBe(e.key); expect(saved.stopKey).toBe(e.stopKey);
  expect(saved.runId).toBe('r1'); expect(saved.contextId).toBe('ctx');
  if (boundary === 'stop') expect(saved.stopConfirmed).toBe(true);
  if (boundary === 'run') { expect(keys).toEqual([e.key]); expect(argumentsSent).toEqual([e.args]); }
  if (boundary === 'settle') { expect(saved.settled).toBe(true); expect(saved.status).toBe('failed'); }
 } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('withdrawal without cleanup suppresses late interaction, output and error content', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'mind-execution-current-race-')), journal = new CoreExecutionJournal(dir);
 let current = true; const started = deferred<void>(), response = deferred<unknown>();
 try {
  const e = journal.prepare(input, now); journal.save({ ...e, ...run, status: 'running' });
  const executor = new CoreExecutor(journal, async () => { started.resolve(); return response.promise; }, { current: () => current, settle: async () => {} });
  const pending = executor.reconcile(now); await started.promise; current = false;
  response.resolve({ run, items: [fact], interactions: [{ prompt: 'PRIVATE' }], ended: false, nextCursor: null });
  await pending; expectScrubbed(journal.get(e.id));
 } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});
