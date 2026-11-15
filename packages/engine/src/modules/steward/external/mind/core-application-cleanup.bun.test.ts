import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreApplication, type ApplicationReceipt } from './core-application';
import { CoreMindService } from './core-service';
import { CoreMindStore, coreDigest } from './core-store';
import type { CoreAccess } from './core-types';
import type { CoreCall } from './core-execution';

const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const runtime: CoreAccess = { subject: 'PRIVATE-CALLER-PAYLOAD', role: 'runtime', scopes: [{}],
  execution: { actor: 'mind', runRef: 'original-run' }, semanticAdmission: { digest: 'PRIVATE-ADMISSION-PAYLOAD' } };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mind-application-cleanup-'));
  let store = new CoreMindStore(directory), service = new CoreMindService(store);
  let reply: () => Promise<unknown> = async () => ({ value: 'PRIVATE-RESULT-PAYLOAD' });
  const calls: { target: unknown; args: unknown; key?: string }[] = [];
  const call: CoreCall = async (target, args, options) => {
    if (target === 'modules.list') return { items: [{ id: 'catalog', name: 'catalog', activeHash: 'hash-1' }] };
    calls.push({ target, args: structuredClone(args), key: options?.key }); return reply();
  };
  let app = new CoreApplication(directory, service, call, 'mind');
  const understanding = service.remember({ actionKey: 'remember', expectedRevision: 0, expectedVisibilityRevision: 0,
    kind: 'goal', value: 'Read the catalog', scope: { sessionId: 's1' }, explicitness: 'explicit', supportingRefs: [] }, owner).value!;
  const p = service.pursue({ actionKey: 'pursue', expectedRevision: 0, expectedVisibilityRevision: 0,
    semanticKey: 'catalog', goal: 'Read catalog', completionCriteria: ['verified'], scope: { sessionId: 's1' },
    reason: 'explicit-goal', evidenceRefs: [], understandingRefs: [understanding.id] }, owner).value!;
  const pursuit = service.claim({ actionKey: 'claim', pursuitId: p.id, expectedRevision: p.revision,
    expectedVisibilityRevision: 0 }, runtime).value!;
  const params = { query: 'PRIVATE-GUARD-PAYLOAD', limit: 1 };
  const grant = () => app.grant({ moduleId: 'catalog', activeHash: 'hash-1', tool: 'lookup', effect: 'read', params,
    description: 'Reviewed exact bounded catalog read' }, owner);
  const input = (adapterId: string, actionKey = 'original-command') => ({ actionKey, pursuitId: pursuit.id,
    expectedRevision: pursuit.revision, expectedVisibilityRevision: 0, adapterId, params });
  const ref = `mind-application:${coreDigest('original-command')}`;
  const path = join(directory, 'mind-application.sqlite');
  const inspect = () => {
    const db = new Database(path, { readonly: true });
    try { return JSON.parse((db.query('SELECT json FROM invocations WHERE ref=?').get(ref) as { json: string }).json); }
    finally { db.close(); }
  };
  cleanups.push(() => { app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, get store() { return store; }, get service() { return service; }, directory, path,
    calls, pursuit, understanding, ref, params, grant, input, inspect, call,
    setReply: (next: typeof reply) => { reply = next; },
    restart: () => { app.close(); store.close(); store = new CoreMindStore(directory); service = new CoreMindService(store);
      app = new CoreApplication(directory, service, call, 'mind'); },
    forget: (kind: 'evidence' | 'understanding' | 'session') => service.forget({ actionKey: 'forget', expectedVisibilityRevision: 0,
      target: kind === 'session' ? { kind, sessionId: 's1' } : { kind,
        id: kind === 'evidence' ? pursuit.evidenceRefs[0]! : understanding.id } }, owner),
  };
}
function expectScrubbed(stored: ReturnType<ReturnType<typeof fixture>['inspect']>, original: ApplicationReceipt) {
  expect(stored.receipt).toEqual({ ...original, responseBody: undefined, responseDigest: undefined, contentWithdrawn: true });
  expect(stored.guard).toBeUndefined(); expect(stored.access).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain('PRIVATE-RESULT-PAYLOAD');
  expect(JSON.stringify(stored)).not.toContain('PRIVATE-GUARD-PAYLOAD');
  expect(JSON.stringify(stored)).not.toContain('PRIVATE-CALLER-PAYLOAD');
  expect(JSON.stringify(stored)).not.toContain('PRIVATE-ADMISSION-PAYLOAD');
}

test('completed result remains readable after release and restart; fresh effects still require current responsibility', async () => {
  const f = fixture(), adapter = await f.grant(), input = f.input(adapter.id);
  const receipt = await f.app.invoke(input, runtime);
  f.service.release({ actionKey: 'release', expectedVisibilityRevision: 0, pursuitId: f.pursuit.id,
    expectedRevision: f.pursuit.revision, runRef: 'original-run', executionStopped: true, effectsReconciled: true }, runtime);
  const before = f.store.read().revision;
  expect(f.app.readReceipt(receipt.ref, owner)).toEqual(receipt);
  expect(f.app.readReceipt(receipt.ref, { subject: 'reader', role: 'application', scopes: [{ sessionId: 's1' }] })).toEqual(receipt);
  expect(f.store.read().revision).toBe(before); // Reading must not mutate/replay the original effect guard.
  expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 0, deferred: 0, checkpoint: 'complete' });
  f.restart(); expect(f.app.readReceipt(receipt.ref, owner)).toEqual(receipt);
  expect(() => f.app.readReceipt(receipt.ref, { subject: 'reader', role: 'application', scopes: [{ sessionId: 's2' }] })).toThrow('scope');
  await expect(f.app.invoke({ ...input, actionKey: 'new-effect', expectedRevision: f.pursuit.revision + 1 }, runtime)).rejects.toThrow('responsibility');
  expect(f.calls).toHaveLength(1);
});

for (const withdrawal of ['session', 'evidence', 'understanding', 'restore'] as const) {
  test(`cleanup of a completed receipt after ${withdrawal} preserves original identity and outcome across full restart`, async () => {
    const f = fixture(), adapter = await f.grant(), original = await f.app.invoke(f.input(adapter.id), runtime);
    if (withdrawal === 'restore') f.service.setRestoreBlocked(true, runtime); else f.forget(withdrawal);
    expect(() => f.app.readReceipt(f.ref, owner)).toThrow('visibility');
    expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 0, checkpoint: 'complete' });
    expectScrubbed(f.inspect(), original);
    expect(f.store.read().actions.find(a => a.id === original.actionKey)?.outcome).toBe('succeeded');
    expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 0, deferred: 0, checkpoint: 'complete' });
    f.restart(); expectScrubbed(f.inspect(), original);
    expect(() => f.app.readReceipt(f.ref, owner)).toThrow('visibility');
    // secure_delete + a successful checkpoint removes these particular test bytes; not a forensic guarantee.
    expect(readFileSync(f.path).includes(Buffer.from('PRIVATE-RESULT-PAYLOAD'))).toBe(false);
    expect(readFileSync(f.path).includes(Buffer.from('PRIVATE-CALLER-PAYLOAD'))).toBe(false);
    const persistedGrant = (await f.app.list(owner)).find(a => a.id === adapter.id)!;
    expect(persistedGrant.params).toEqual(f.params); // Owner configuration has its own lifecycle.
  });
}

for (const late of ['success', 'unknown', 'exception'] as const) {
  test(`cleanup from another SQLite instance fences a deferred ${late} reply without inventing a terminal outcome`, async () => {
    const f = fixture(), adapter = await f.grant(), entered = deferred<void>(), reply = deferred<unknown>();
    const second = new CoreApplication(f.directory, f.service, f.call, 'mind');
    cleanups.push(() => second.close());
    f.setReply(() => { entered.resolve(); return reply.promise; });
    const pending = f.app.invoke(f.input(adapter.id), runtime).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const original = f.inspect().receipt as ApplicationReceipt;
    expect(original.status).toBe('unknown');
    if (late === 'success') {
      // Missing understanding is a read withdrawal outside the actor/effect guard's own evidence checks.
      // Keep the guard live to exercise the SQLite fence even when post-await effect authorization succeeds.
      const guard = f.inspect().guard;
      f.store.update(tx => { tx.delete('understanding', f.understanding.id); });
      expect(() => f.service.guardAction(guard, runtime)).not.toThrow();
    } else f.forget('understanding');
    expect(second.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 1, checkpoint: 'complete' });
    if (late === 'exception') reply.reject(Error('PRIVATE-LATE-EXCEPTION'));
    else reply.resolve(late === 'unknown' ? { status: 'unknown', value: 'PRIVATE-LATE-REPLY' } : { value: 'PRIVATE-LATE-REPLY' });
    expect('error' in await pending).toBe(true);
    expectScrubbed(f.inspect(), original);
    expect(JSON.stringify(f.inspect())).not.toContain('PRIVATE-LATE');
    expect(f.store.read().actions.find(a => a.id === original.actionKey)?.outcome).toBe('unknown');
    expect(second.cleanupWithdrawn()).toEqual({ scrubbed: 0, deferred: 1, checkpoint: 'complete' });
    f.restart(); expectScrubbed(f.inspect(), original);
    await expect(f.app.invoke(f.input(adapter.id), runtime)).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
}

test('terminal scrub is monotonic even when a second invocation still holds an older unknown snapshot', async () => {
  const f = fixture(), adapter = await f.grant(), entered = deferred<void>(), late = deferred<unknown>();
  const second = new CoreApplication(f.directory, f.service, f.call, 'mind'); cleanups.push(() => second.close());
  let attempts = 0;
  f.setReply(() => { if (++attempts === 1) { entered.resolve(); return late.promise; } return Promise.resolve({ value: 'PRIVATE-RESULT-PAYLOAD' }); });
  const pending = f.app.invoke(f.input(adapter.id), runtime).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  const original = await second.invoke(f.input(adapter.id), runtime); expect(original.status).toBe('succeeded');
  const guard = f.inspect().guard;
  f.store.update(tx => { tx.delete('understanding', f.understanding.id); });
  expect(second.cleanupWithdrawn().scrubbed).toBe(1);
  // The effect guard still admits this original live actor. The SQLite fence must independently reject the late body.
  expect(() => f.service.guardAction(guard, runtime)).not.toThrow();
  late.resolve({ value: 'PRIVATE-LATE-REPLY' }); expect('error' in await pending).toBe(true);
  expectScrubbed(f.inspect(), original);
  expect(f.calls[0]).toEqual(f.calls[1]);
  expect(f.store.read().actions.find(a => a.id === original.actionKey)?.outcome).toBe('succeeded');
});

test('unknown observation is scrubbed on restart and cannot be retried after restore is reconciled', async () => {
  const f = fixture(), adapter = await f.grant();
  f.setReply(async () => ({ status: 'pending', value: 'PRIVATE-RESULT-PAYLOAD' }));
  const original = await f.app.invoke(f.input(adapter.id), runtime);
  expect(original.status).toBe('unknown'); expect(original.responseDigest).toBeDefined();
  f.service.setRestoreBlocked(true, runtime); f.restart();
  expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 1, checkpoint: 'complete' });
  f.service.setRestoreBlocked(false, runtime); f.restart();
  expectScrubbed(f.inspect(), original);
  expect(() => f.app.readReceipt(f.ref, owner)).toThrow('visibility');
  await expect(f.app.invoke({ ...f.input(adapter.id), expectedVisibilityRevision: f.store.read().visibilityRevision }, runtime)).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
});

test('WAL checkpoint reports pinned readers while logical cleanup succeeds, then safely retries', async () => {
  const f = fixture(), adapter = await f.grant();
  const original = await f.app.invoke(f.input(adapter.id), runtime);
  const reader = new Database(f.path, { readonly: true });
  try {
    reader.exec('BEGIN');
    const pinned = reader.query('SELECT json FROM invocations').get() as { json: string };
    expect(pinned.json).toContain('PRIVATE-RESULT-PAYLOAD');
    f.forget('session');
    expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 0, checkpoint: 'busy' });
    expectScrubbed(f.inspect(), original);
    // An already-open SQLite snapshot can retain old data; cleanup must not claim otherwise or delete its WAL.
    expect((reader.query('SELECT json FROM invocations').get() as { json: string }).json).toBe(pinned.json);
    reader.exec('ROLLBACK');
    expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 0, deferred: 0, checkpoint: 'complete' });
    expect(readFileSync(`${f.path}-wal`).byteLength).toBe(0);
  } finally { reader.close(); }
});

test('read permission follows original evidence scope and source coverage without requiring its old actor', async () => {
  const f = fixture(), adapter = await f.grant(), original = await f.app.invoke(f.input(adapter.id), runtime);
  const evidenceId = f.pursuit.evidenceRefs[0]!;
  // Exercise the live service-owned evidence boundary; no caller can replace these facts through receipt JSON.
  f.store.update(tx => {
    const e = tx.get('evidence', evidenceId)!; e.sourceIdentity = 'external-source'; e.scope = { sessionId: 's2' }; tx.put('evidence', e);
    tx.put('checkpoint', { id: 'external-source', revision: 1, sourceIdentity: e.sourceIdentity, epoch: e.epoch,
      cursor: '1', scopeRevision: e.scopeRevision, coverage: { complete: true }, capturedAt: e.receivedAt });
  });
  expect(() => f.app.readReceipt(original.ref, { subject: 'reader', role: 'application', scopes: [{ sessionId: 's1' }] })).toThrow('scope');
  expect(f.app.readReceipt(original.ref, owner)).toEqual(original);
  f.store.update(tx => { const cp = tx.get('checkpoint', 'external-source')!; cp.coverage.complete = false; tx.put('checkpoint', cp); });
  expect(() => f.app.readReceipt(original.ref, owner)).toThrow('evidence');
  expect(f.app.cleanupWithdrawn().scrubbed).toBe(0); // Incomplete coverage may be repaired; it is not a withdrawal.
});

for (const dependency of ['pursuit', 'expired-evidence', 'understanding-evidence'] as const) {
  test(`cleanup detects ${dependency} withdrawal independently of global visibility`, async () => {
    const f = fixture(), adapter = await f.grant(), original = await f.app.invoke(f.input(adapter.id), runtime);
    f.store.update(tx => {
      if (dependency === 'pursuit') { tx.delete('pursuit', f.pursuit.id); return; }
      const p = tx.get('pursuit', f.pursuit.id)!; p.evidenceRefs = []; tx.put('pursuit', p);
      if (dependency === 'expired-evidence') {
        const e = tx.get('evidence', f.pursuit.evidenceRefs[0]!)!; e.expiredAt = new Date().toISOString(); tx.put('evidence', e);
      } else {
        const originalEvidence = tx.get('evidence', f.pursuit.evidenceRefs[0]!)!;
        tx.put('evidence', { ...originalEvidence, id: 'new-support', retractedAt: new Date().toISOString() });
        const u = tx.get('understanding', f.understanding.id)!; u.supportingRefs = ['new-support']; tx.put('understanding', u);
      }
    });
    expect(f.store.read().visibilityRevision).toBe(0);
    expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 0, checkpoint: 'complete' });
    expectScrubbed(f.inspect(), original);
    f.restart(); expectScrubbed(f.inspect(), original);
  });
}

test('cleanup detects missing or forgotten dependencies even without a visibility bump and retains original scope after edits', async () => {
  const f = fixture(), adapter = await f.grant(), original = await f.app.invoke(f.input(adapter.id), runtime);
  f.store.update(tx => {
    const p = tx.get('pursuit', f.pursuit.id)!; p.scope = { sessionId: 's2' }; p.evidenceRefs = []; p.understandingRefs = []; tx.put('pursuit', p);
  });
  expect(() => f.app.readReceipt(original.ref, { subject: 'reader', role: 'application', scopes: [{ sessionId: 's2' }] })).toThrow('scope');
  f.store.update(tx => { tx.delete('understanding', f.understanding.id); });
  expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 1, deferred: 0, checkpoint: 'complete' });
  expectScrubbed(f.inspect(), original);
});

 test('forgetting an unrelated session preserves completed results across cleanup and restart', async () => {
  const f = fixture(), adapter = await f.grant(), original = await f.app.invoke(f.input(adapter.id), runtime);
  f.service.forget({ actionKey: 'forget-unrelated', expectedVisibilityRevision: 0,
    target: { kind: 'session', sessionId: 'unrelated-session' } }, owner);
  expect(f.app.readReceipt(f.ref, owner)).toEqual(original);
  expect(f.app.cleanupWithdrawn()).toEqual({ scrubbed: 0, deferred: 0, checkpoint: 'complete' });
  f.restart(); expect(f.app.readReceipt(f.ref, owner)).toEqual(original);
  expect(f.calls).toHaveLength(1);
 });
