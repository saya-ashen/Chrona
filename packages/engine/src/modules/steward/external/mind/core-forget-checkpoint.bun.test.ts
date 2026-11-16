import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreActions } from './core-actions';
import { CoreExecutionJournal, CoreExecutor } from './core-execution';
import { CoreRuntime } from './core-runtime';
import { CoreMindService } from './core-service';
import { CoreMindStore } from './core-store';
import type { CoreAccess, Evidence, Pursuit } from './core-types';

const now = '2026-11-14T01:00:00.000Z';
const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const identity = { moduleId: 'mind', hash: 'current' };
const input = { purpose: 'understand' as const, subject: 'u', revision: 0, visibilityRevision: 0,
 prompt: 'PRIVATE-CHECKPOINT-PROMPT', tools: ['mind.progress'] };
function pin(path: string, table: string) {
 const reader = new Database(path);
 reader.exec('BEGIN'); reader.query(`SELECT * FROM ${table}`).all();
 return reader;
}
function expectErased(path: string, marker: string) {
 for (const file of [path, `${path}-wal`]) if (existsSync(file))
  expect(readFileSync(file).includes(Buffer.from(marker))).toBe(false);
}
function fixture() {
 const directory = mkdtempSync(join(tmpdir(), 'mind-forget-checkpoint-'));
 const store = new CoreMindStore(directory), service = new CoreMindService(store, { now: () => now });
 let actions = new CoreActions(directory, service);
 const openRuntime = () => new CoreRuntime(store, service, async target => { throw Error(`Unexpected ${JSON.stringify(target)}`); }, () => identity, actions);
 let runtime = openRuntime();
 return { directory, store, service, get actions() { return actions; }, get runtime() { return runtime; },
  forget() { service.forget({ actionKey: 'forget', expectedVisibilityRevision: 0, target: { kind: 'session', sessionId: 's1' } }, owner); },
  restart() { runtime.close(); actions.close(); actions = new CoreActions(directory, service); runtime = openRuntime(); },
  close() { runtime.close(); actions.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('forgotten document WAL stays deferred across restart until its pinned reader releases', () => {
 const f = fixture(), marker = 'PRIVATE-CHECKPOINT-DOCUMENT'; let reader: Database | undefined;
 const path = join(f.directory, 'mind.sqlite');
 try {
  const evidence: Evidence = { id: 'e', revision: 1, createdAt: now, updatedAt: now, sourceIdentity: 'owner', epoch: '1', eventId: 'message', cursor: '1',
   object: { kind: 'message', id: 'message', revision: 1 }, kind: 'message', scope: { sessionId: 's1' }, actor: 'user', origin: { rootId: 'message' },
   occurredAt: now, receivedAt: now, scopeRevision: 1, visibilityRevision: 0, sourceDigest: 'original', content: { text: 'Prepare a document', truncated: false } };
  const pursuit: Pursuit = { id: 'p', revision: 2, createdAt: now, updatedAt: now, visibilityRevision: 0, semanticKey: 'document', goal: 'Prepare a document',
   completionCriteria: ['Create the document'], scope: { sessionId: 's1' }, reason: 'explicit-goal', evidenceRefs: ['e'], understandingRefs: [], artifactRefs: [],
   status: 'active', paused: false, currentActor: { actor: 'worker', runRef: 'worker-run', claimedRevision: 2, stopRequested: false } };
  f.store.update(tx => { tx.put('evidence', evidence); tx.put('pursuit', pursuit); });
  const document = f.actions.create({ actionKey: 'document', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
   target: 'document', arguments: {}, document: { title: 'Private document', body: marker } },
  { subject: 'worker', role: 'runtime', scopes: [{}], execution: { actor: 'worker', runRef: 'worker-run' } });
  reader = pin(path, 'documents'); f.forget();
  // Withdrawal hides derived content before any recovery I/O or artifact deletion.
  expect(f.actions.list('p', owner)).toEqual([]);
  expect(() => f.actions.read(document.ref, owner)).toThrow('Document pursuit has been withdrawn');
  expect(f.runtime.cleanupWithdrawn().deferred).toBeGreaterThan(0);
  expect(() => f.actions.read(document.ref)).toThrow('Document not found');
  expect(readFileSync(`${path}-wal`).includes(Buffer.from(marker))).toBe(true);
  f.restart();
  expect(f.runtime.cleanupWithdrawn().deferred).toBeGreaterThan(0);
  expect(() => f.actions.read(document.ref)).toThrow('Document not found');
  expect(readFileSync(`${path}-wal`).includes(Buffer.from(marker))).toBe(true);
  reader.close(); reader = undefined;
  expect(f.runtime.cleanupWithdrawn().deferred).toBe(0);
  expectErased(path, marker);
  expect(f.actions.forgetPursuits([]).deferred).toBe(0);
 } finally { reader?.close(); f.close(); }
});

for (const settled of [false, true]) test(`${settled ? 'settled' : 'prepared'} journal WAL busy propagates through runtime and later maintenance erases bytes`, () => {
 const f = fixture(); let reader: Database | undefined;
 const journal = f.runtime.journal, path = join(f.directory, 'mind.sqlite');
 try {
  let e = journal.prepare(input, now);
  e = journal.save({ ...e, settled, status: settled ? 'finished' : 'prepared', summary: input.prompt, interactions: [input.prompt], error: input.prompt,
   facts: [{ runId: 'r', callId: 'c', target: 'mind.progress', moduleId: 'mind', hash: 'current', status: 'succeeded', outputState: 'complete', output: input.prompt }] });
  reader = pin(path, 'executions'); f.forget();
  expect(f.runtime.cleanupWithdrawn().deferred).toBeGreaterThan(0);
  const clean = journal.get(e.id);
  expect(clean.args).toEqual({}); expect(clean.interactions).toEqual([]); expect(clean.summary).toBe(''); expect(clean.error).toBeNull();
  expect(clean.facts[0].output).toBeUndefined(); expect(clean.key).toBe(e.key); expect(clean.stopKey).toBe(e.stopKey);
  expect(readFileSync(`${path}-wal`).includes(Buffer.from(input.prompt))).toBe(true);
  reader.close(); reader = undefined;
  expect(f.runtime.cleanupWithdrawn().deferred).toBe(0);
  expectErased(path, input.prompt);
 } finally { reader?.close(); f.close(); }
});

test('busy cleanup preserves unknown original command occupancy until recovery, then erases late content', async () => {
 const directory = mkdtempSync(join(tmpdir(), 'mind-unknown-checkpoint-')), journal = new CoreExecutionJournal(directory);
 const path = join(directory, 'mind.sqlite'); let reader: Database | undefined;
 try {
  const prepared = journal.prepare(input, now), original = journal.save({ ...prepared, status: 'unknown' });
  reader = pin(path, 'executions');
  expect(journal.scrubInvalid(() => false).deferred).toBe(2); // Original receipt and WAL both remain unresolved.
  expect(journal.get(original.id)).toEqual(original);
  expect(() => journal.prepare({ ...input, subject: 'replacement' }, now)).toThrow('requires reconciliation');
  reader.close(); reader = undefined;
  expect(journal.scrubInvalid(() => false).deferred).toBe(1);
  expect(journal.get(original.id).args).toEqual(original.args);
  const commands: string[] = [], run = { runId: 'original-run', contextId: 'original-context', status: 'cancelled', active: false };
  const executor = new CoreExecutor(journal, async (target, args, options) => {
   commands.push(String(target));
   if (target === 'agent.run') { expect(options?.key).toBe(original.key); expect(args).toEqual(original.args); return run; }
   if (target === 'agent.stop') { expect(options?.key).toBe(original.stopKey); expect(args).toEqual({ runId: run.runId }); return { ...run, stopConfirmed: true }; }
   if (target === 'agent.read') return { run, items: [{ kind: 'tool-result', payload: { type: 'tool-result', value: {
    runId: run.runId, callId: 'late', target: 'mind.progress', moduleId: 'mind', hash: 'current', status: 'succeeded', outputState: 'complete', output: input.prompt } } }],
    interactions: [input.prompt], ended: true, nextCursor: null };
   throw Error(`Unexpected ${JSON.stringify(target)}`);
  }, { current: () => false, settle: async () => {} });
  await executor.reconcile(now);
  expect(commands).toEqual(['agent.run', 'agent.stop', 'agent.read']);
  const clean = journal.get(original.id);
  expect(clean.key).toBe(original.key); expect(clean.stopKey).toBe(original.stopKey); expect(clean.runId).toBe(run.runId);
  expect(clean.stopRequested).toBe(true); expect(clean.stopConfirmed).toBe(true); expect(clean.settled).toBe(true);
  expect(clean.args).toEqual({}); expect(clean.interactions).toEqual([]); expect(clean.facts[0].output).toBeUndefined();
  expect(journal.outstanding()).toBeUndefined();
  expect(journal.scrubInvalid(() => false).deferred).toBe(0);
  expectErased(path, input.prompt);
 } finally { reader?.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
});
