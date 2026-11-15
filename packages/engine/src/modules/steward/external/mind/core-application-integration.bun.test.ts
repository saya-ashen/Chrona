import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreMindStore, coreDigest } from './core-store';
import { CoreMindService } from './core-service';
import { CoreApplication } from './core-application';
import { CoreActions, type DocumentArtifact } from './core-actions';
import { CoreExecutionJournal, type CoreCall, type ToolFact } from './core-execution';
import { CoreVerification, type VerdictInput } from './core-verification';
import type { CoreAccess, Evidence, Pursuit } from './core-types';

const now = '2026-11-13T14:00:00.000Z';
const identity = { moduleId: 'mind-real', hash: 'mind-hash' };
const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const workerAccess: CoreAccess = { subject: 'worker', role: 'runtime', scopes: [{}], execution: { actor: 'worker', runRef: 'worker-run' } };
const verifierAccess: CoreAccess = { subject: 'verifier', role: 'runtime', scopes: [{}] };
const binding = { ...identity, runId: 'verifier-run' };
const fact = (tool: string, output: unknown, runId: string, callId = tool): ToolFact => ({
  runId, callId, target: { moduleId: identity.moduleId, tool }, ...identity, status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(output) },
});
const item = (value: ToolFact) => ({ kind: 'tool-result', payload: { type: 'tool-result', value } });

async function fixture(reply: unknown = { departure: '09:00', arrival: '11:30', source: 'published timetable', password: 'private-fixture-value' }, overview = false) {
  const directory = mkdtempSync(join(tmpdir(), 'mind-app-integration-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store), workers = new CoreExecutionJournal(directory);
  const pursuit: Pursuit = { id: 'p', revision: 2, createdAt: now, updatedAt: now, visibilityRevision: 0,
    semanticKey: 'train', goal: 'Read the published train timetable and find an arrival before noon',
    completionCriteria: ['Give supported departure and arrival times before noon'], scope: { sessionId: 's1' }, reason: 'explicit-goal',
    evidenceRefs: ['e'], understandingRefs: [], artifactRefs: [], status: 'active', paused: false,
    currentActor: { actor: 'worker', runRef: 'worker-run', claimedRevision: 2, stopRequested: false } };
  const evidence: Evidence = { id: 'e', revision: 1, createdAt: now, updatedAt: now, sourceIdentity: 'owner', epoch: '1', eventId: 'message', cursor: '1',
    object: { kind: 'message', id: 'message', revision: 1 }, kind: 'message', scope: { sessionId: 's1' }, actor: 'user', origin: { rootId: 'message' },
    occurredAt: now, receivedAt: now, scopeRevision: 1, visibilityRevision: 0, sourceDigest: 'original',
    content: { text: 'Read the published train timetable and give departure and arrival times, arriving before noon.', truncated: false } };
  store.update(tx => { tx.put('evidence', evidence); tx.put('pursuit', pursuit); });
  let actualReply = reply, items: unknown[] = [], ended = false, appCalls = 0;
  const calls: Array<{ target: unknown; args: Record<string, unknown> }> = [];
  const call: CoreCall = async (target, args) => {
    calls.push({ target, args: structuredClone(args) });
    if (target === 'modules.list') return { items: [{ id: 'trains-real', name: 'trains', activeHash: 'reviewed-v1' },
      { id: 'pi-real', name: 'pi', activeHash: 'pi-v1' }, { id: identity.moduleId, name: 'mind', activeHash: identity.hash },
      ...(overview ? [{ id: 'apps-real', name: 'apps', activeHash: 'reviewed-apps' }] : [])], nextCursor: null };
    if (typeof target === 'object' && (target.moduleId === 'trains-real' && target.tool === 'lookup' || overview && target.moduleId === 'apps-real' && target.tool === 'overview')) { appCalls++; return actualReply; }
    if (target === 'agent.run') return { runId: binding.runId, contextId: 'verifier-context', active: true, status: 'running' };
    if (target === 'agent.read') return { run: { runId: binding.runId, contextId: 'verifier-context', active: !ended, status: ended ? 'finished' : 'running' }, items, ended, nextCursor: null, interactions: [] };
    throw Error(`Unexpected target ${JSON.stringify(target)}`);
  };
  let application = new CoreApplication(directory, service, call, identity.moduleId);
  let actions = new CoreActions(directory, service, () => application);
  const verification = new CoreVerification(directory, { store, actions, call, self: () => identity, hasActiveRun: () => false });
  const adapter = overview ? (await application.list(owner)).find(a => a.moduleId === 'apps-real')! : await application.grant({ moduleId: 'trains-real', activeHash: 'reviewed-v1', tool: 'lookup', effect: 'read', params: { route: 'one' }, description: 'Reviewed published timetable lookup; exact route' }, owner);
  const input = { actionKey: 'read-timetable', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0, adapterId: adapter.id, params: adapter.params };
  const worker = { ...workers.prepare({ purpose: 'pursuit', subject: 'p', revision: 2, visibilityRevision: 0, prompt: 'Read timetable',
    tools: ['action', 'artifact', 'progress'].map(tool => ({ moduleId: identity.moduleId, tool })) }, now),
    runId: 'worker-run', contextId: 'worker-context', ended: true, active: false, status: 'finished' as const };
  workers.save(worker);
  return { directory, store, service, workers, worker, verification, calls, adapter, input,
    get actions() { return actions; }, get application() { return application; }, get appCalls() { return appCalls; },
    setReply(value: unknown) { actualReply = value; },
    reopen() { actions.close(); application.close(); application = new CoreApplication(directory, service, call, identity.moduleId); actions = new CoreActions(directory, service, () => application); },
    finish(document: DocumentArtifact, receipt: unknown, altered = false) { items = [item(fact('artifact', altered ? { ...document, body: 'model invented response' } : actions.read(document.ref, verifierAccess), binding.runId)), item(fact('verdict', receipt, binding.runId))]; ended = true; },
    close() { verification.close(); workers.close(); actions.close(); application.close(); store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

function candidateFor(f: Awaited<ReturnType<typeof fixture>>, document: DocumentArtifact, originalReceiptRef = document.ref) {
  const candidate = f.service.progress({ actionKey: 'progress', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: f.store.read().visibilityRevision,
    summary: 'Published timetable read for independent assessment', artifactRefs: [document.ref], originalReceiptRef, evidenceRefs: ['e'], desiredStatus: 'done' }, workerAccess).value!;
  f.worker.facts = [fact('action', document, 'worker-run', 'original-action'), fact('progress', { value: candidate }, 'worker-run')];
  f.workers.save(f.worker);
  return candidate;
}

async function prepareVerification(f: Awaited<ReturnType<typeof fixture>>, document: DocumentArtifact) {
  const candidate = candidateFor(f, document), request = f.verification.prepare(candidate.id, f.worker, now);
  await f.verification.reconcile(now);
  const input: VerdictInput = { requestId: request.id, candidateRef: candidate.receipt, artifacts: [{ ref: document.ref, digest: document.digest }],
    decision: 'accepted', observations: [{ criterion: f.store.read().pursuits[0].completionCriteria[0], satisfied: true,
      observation: 'The actual published timetable response gives departure 09:00 and arrival 11:30, meeting the requested arrival before noon.',
      artifactRefs: [document.ref], excerpt: '"arrival":"11:30"' }] };
  return { candidate, request, input };
}

test('actual qualified app read becomes immutable sanitized artifact, independently accepted after worker terminal', async () => {
  const f = await fixture(); try {
    const document = await f.actions.applicationRead({ ...f.input, target: 'application-read', document: { body: 'forged model body' }, responseBody: { arrival: 'invented' } } as never, workerAccess) as DocumentArtifact;
    expect(document.title).toBe('Application read trains');
    expect(document.ref).toStartWith('mind-application:'); expect(document.body).not.toContain('forged'); expect(document.body).not.toContain('private-fixture-value');
    const body = JSON.parse(document.body);
    expect(body).toMatchObject({ kind: 'application-read', moduleId: 'trains-real', activeHash: 'reviewed-v1', tool: 'lookup', response: { departure: '09:00', arrival: '11:30' } });
    expect(body.responseDigest).toBe(f.application.readReceipt(document.ref, owner).responseDigest);
    expect(f.calls.find(c => typeof c.target === 'object' && c.target !== null && 'tool' in c.target && c.target.tool === 'lookup')?.target).toEqual({ moduleId: 'trains-real', tool: 'lookup' });
    expect(f.actions.list('p', verifierAccess)).toHaveLength(1);
    // No execution binding on the independent reader; the original actor remains owned until verification.
    expect(f.actions.read(document.ref, verifierAccess)).toEqual(document);
    const { candidate, request, input } = await prepareVerification(f, document);
    const launch = f.calls.find(c => c.target === 'agent.run')!.args;
    expect(launch.model).toBeUndefined(); expect(launch.profile).toBeUndefined(); expect(launch.contextId).toBeUndefined();
    const receipt = f.verification.verdict(input, binding);
    expect(f.verification.assess(request.id).verified).toBeUndefined();
    f.finish(document, receipt); await f.verification.reconcile(now);
    const result = f.verification.assess(request.id);
    expect(result.status).toBe('accepted'); expect(result.scope).toBe('persisted-app-read-or-document');
    expect(result.verified?.artifactRefs).toEqual([document.ref]);
    expect(f.store.read().pursuits[0].status).toBe('active');
    expect(f.store.read().pursuits[0].currentActor?.runRef).toBe('worker-run');
    const applied = f.service.applyProgress({ actionKey: 'apply-verified', expectedVisibilityRevision: 0, candidateId: candidate.id, expectedRevision: 2, verified: result.verified! }, workerAccess);
    expect(applied.value?.pursuit.status).toBe('done');
    f.service.release({ actionKey: 'release-verified', pursuitId: 'p', expectedRevision: applied.value!.pursuit.revision,
      expectedVisibilityRevision: 0, runRef: 'worker-run', executionStopped: true, effectsReconciled: true }, workerAccess);
    expect(f.actions.read(document.ref, owner)).toEqual(document);
  } finally { f.close(); }
});

test('persisted read replay/reopen ignores changed gateway reply and never stores a second derived body', async () => {
  const f = await fixture(); try {
    const original = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
    f.setReply({ arrival: 'invented later reply' }); f.reopen();
    expect(f.actions.read(original.ref, owner)).toEqual(original);
    expect(await f.actions.applicationRead(f.input, workerAccess)).toEqual(original); expect(f.appCalls).toBe(1);
    expect(f.actions.list('p', owner)[0].digest).toBe(original.digest);
    f.actions.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    expect(readFileSync(join(f.directory, 'mind-artifacts.sqlite')).includes(Buffer.from('published timetable'))).toBe(false);
  } finally { f.close(); }
});

test.each([{ status: 'unknown' }, { approvalRequired: true }, { ok: false, error: 'lookup failed' }])('unconfirmed app reply %j never supplies completion artifact', async reply => {
  const f = await fixture(reply); try {
    const result = await f.actions.applicationRead(f.input, workerAccess);
    expect('body' in result).toBe(false); expect('status' in result && ['unknown', 'failed'].includes(result.status)).toBe(true);
    expect(() => f.actions.read(result.ref, verifierAccess)).toThrow('confirmed successful');
    expect(f.actions.list('p')).toEqual([]);
    const candidate = f.service.progress({ actionKey: 'invented-completion', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
      summary: 'Model says done', artifactRefs: [result.ref], originalReceiptRef: result.ref, evidenceRefs: ['e'], desiredStatus: 'done' }, workerAccess).value!;
    expect(() => f.verification.prepare(candidate.id, f.worker, now)).toThrow('confirmed successful');
    expect(f.store.read().pursuits[0].status).toBe('active');
    expect(f.calls.some(c => c.target === 'agent.run')).toBe(false);
  } finally { f.close(); }
});

test('original action and independent artifact read must exactly match persisted response; semantic needs-work remains decisive', async () => {
  for (const mode of ['forged-original', 'forged-read', 'needs-work']) {
    const f = await fixture(); try {
      const document = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
      if (mode === 'forged-original') {
        const candidate = candidateFor(f, document); f.worker.facts[0].output = { json: JSON.stringify({ ...document, body: 'model claimed result' }) };
        expect(() => f.verification.prepare(candidate.id, f.worker, now)).toThrow('persisted selected'); continue;
      }
      const { request, input } = await prepareVerification(f, document);
      if (mode === 'needs-work') { input.decision = 'needs-work'; input.observations[0].satisfied = false; input.observations[0].observation = 'The actual response does not meet the independent assessment of the requested timetable support.'; }
      const receipt = f.verification.verdict(input, binding);
      f.finish(document, receipt, mode === 'forged-read'); await f.verification.reconcile(now);
      expect(f.verification.assess(request.id).status).toBe(mode === 'forged-read' ? 'unverified' : 'needs-work');
      expect(f.verification.assess(request.id).verified).toBeUndefined(); expect(f.store.read().pursuits[0].status).toBe('active');
    } finally { f.close(); }
  }
});

test.each(['source', 'visibility', 'goal', 'scope'])('receipt artifact enforces live %s before any independent completion', async mode => {
  const f = await fixture(); try {
    const document = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
    const { request } = await prepareVerification(f, document);
    if (mode === 'scope') expect(() => f.actions.read(document.ref, { subject: 'other', role: 'application', scopes: [{ sessionId: 'different' }] })).toThrow('scope');
    else {
      f.store.update(tx => {
        if (mode === 'source') tx.delete('evidence', 'e');
        if (mode === 'visibility') tx.setMeta({ ...tx.meta(), visibilityRevision: 1 });
        if (mode === 'goal') { const p = tx.get('pursuit', 'p')!; p.goal = 'Different current goal'; p.revision++; tx.put('pursuit', p); }
      });
      if (mode === 'visibility') expect(f.actions.read(document.ref, verifierAccess)).toEqual(document);
      else expect(() => f.actions.read(document.ref, verifierAccess)).toThrow();
      expect(f.verification.assess(request.id).status).toBe('invalidated');
    }
  } finally { f.close(); }
});

test('temporary source gap hides application artifacts and repair restores discovery after cleanup', async () => {
  const f = await fixture(); try {
    f.store.update(tx => {
      const e = tx.get('evidence', 'e')!; e.sourceIdentity = 'external-source'; tx.put('evidence', e);
      tx.put('checkpoint', { id: 'external-source', revision: 1, sourceIdentity: e.sourceIdentity, epoch: e.epoch,
        cursor: '1', scopeRevision: e.scopeRevision, coverage: { complete: true }, capturedAt: e.receivedAt });
    });
    const original = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
    expect(f.actions.list('p', owner)).toHaveLength(1);
    f.store.update(tx => { const cp = tx.get('checkpoint', 'external-source')!; cp.coverage.complete = false; tx.put('checkpoint', cp); });
    f.actions.forgetPursuits([]);
    expect(f.actions.list('p', owner)).toEqual([]);
    f.store.update(tx => { const cp = tx.get('checkpoint', 'external-source')!; cp.coverage.complete = true; tx.put('checkpoint', cp); });
    expect(f.actions.list('p', owner)).toHaveLength(1);
    expect(f.actions.read(original.ref, owner)).toEqual(original);
    expect(f.appCalls).toBe(1);
  } finally { f.close(); }
});

test('forget cleanup removes all succeeded and unknown derived response bodies from application database', async () => {
  const f = await fixture({ value: 'forget-derived-fixture-marker' }); try {
    await f.actions.applicationRead(f.input, workerAccess);
    f.setReply({ status: 'unknown', value: 'forget-unknown-fixture-marker' });
    await f.actions.applicationRead({ ...f.input, actionKey: 'unknown-forget' }, workerAccess);
    f.service.forget({ actionKey: 'forget-source', expectedVisibilityRevision: 0, target: { kind: 'evidence', id: 'e' } }, owner);
    f.actions.forgetPursuits([]); // A global visibility change must scrub even without erased pursuit IDs.
    expect(f.actions.applicationCleanup).toMatchObject({ scrubbed: 2, deferred: 1, checkpoint: 'complete' });
    expect(f.actions.list('p')).toEqual([]);
    for (const suffix of ['', '-wal']) {
      const path = join(f.directory, `mind-application.sqlite${suffix}`);
      if (existsSync(path)) { const bytes = readFileSync(path); expect(bytes.includes(Buffer.from('forget-derived-fixture-marker'))).toBe(false); expect(bytes.includes(Buffer.from('forget-unknown-fixture-marker'))).toBe(false); }
    }
  } finally { f.close(); }
});

 test('new verification can reuse an unchanged artifact after unrelated forgetting', async () => {
  const f = await fixture(); try {
    const document = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
    f.service.forget({ actionKey: 'forget-other', expectedVisibilityRevision: 0,
      target: { kind: 'session', sessionId: 'other-session' } }, owner);
    f.actions.forgetPursuits([]);
    const { request, input } = await prepareVerification(f, document);
    const receipt = f.verification.verdict(input, binding);
    f.finish(document, receipt); await f.verification.reconcile(now);
    expect(f.verification.assess(request.id).status).toBe('accepted');
    expect(f.appCalls).toBe(1);
  } finally { f.close(); }
 });

// Shape emitted by the reviewed apps service + materials.overview, including modules.list records.
function appsOverview() {
  const target = { id: 'target-real', name: 'desktop', activeHash: 'desktop-v2',
    versions: [{ hash: 'desktop-v1', status: 'rejected', errors: ['window status check failed'], createdAt: now }],
    health: { activation: { hash: 'desktop-v2', status: 'verified' } },
    runs: [{ id: 'desktop-open', status: 'failed', error: 'DISPLAY unavailable' }] };
  const material = { id: 'desktop-material', name: 'desktop', repo: 'https://example.test/desktop', upstreamCommit: 'desktop-source',
    target: { name: 'desktop', moduleId: 'target-real', expectedActiveHash: 'desktop-v1' },
    submitter: { moduleId: 'apps-real', hash: 'reviewed-apps' }, state: 'submitted',
    admissionId: 'admission-desktop', requestKey: 'original-key',
    receipt: { receiptId: 'receipt-desktop', state: 'approved', members: [{ moduleId: 'target-real', hash: 'desktop-v2', status: 'approved' }] } };
  return { installed: [target, { id: 'qq-real', name: 'qq', activeHash: 'qq-v3', versions: [{ hash: 'unrelated-qq-history' }], runs: [{ id: 'unrelated-qq-run' }] }],
    installedError: 'Partial directory coverage: next page failed',
    official: [{ name: 'desktop', source: 'remote', checkedAt: now, error: 'upstream fetch failed', contract: 'metadata only' }, { name: 'qq', error: 'unrelated-official-error' }],
    materials: [material, { ...material, id: 'unrelated-qq-material', name: 'qq', target: { name: 'qq', moduleId: 'qq-real' } }],
    managed: { desktop: { moduleId: 'target-real', kernelHash: 'desktop-v2', upstreamCommit: 'desktop-source', receiptId: 'receipt-desktop' },
      qq: { moduleId: 'qq-real', kernelHash: 'unrelated-managed-hash' } },
    localMaterials: [], executionGap: 'Source receipt does not prove activation', checking: false,
    settingsGap: 'Use registered application settings', historyNotice: 'Only recent versions supplied by modules.list are listed' };
}

test('focused reviewed overview retains target records, errors and original provenance through replay and full reads', async () => {
  const reply = appsOverview();
  reply.materials.push({ ...reply.materials[0], id: 'unrelated-same-name-material', target: { ...reply.materials[0].target, moduleId: 'other-target' } });
  const f = await fixture(reply, true); try {
    const input = { ...f.input, focus: { moduleId: 'target-real' } };
    const document = await f.actions.applicationRead(input, workerAccess) as DocumentArtifact;
    const body = JSON.parse(document.body), receipt = f.application.readReceipt(document.ref, owner);
    expect(document.title).toBe('Application read desktop');
    expect(body).toMatchObject({ receiptRef: receipt.ref, adapterId: f.adapter.id, moduleId: 'apps-real', activeHash: 'reviewed-apps',
      argsDigest: coreDigest({}), responseDigest: coreDigest(reply), pursuitId: 'p', pursuitRevision: 2, visibilityRevision: 0,
      actor: 'worker', runRef: 'worker-run', projection: { kind: 'apps-overview-focus', complete: false, focus: input.focus } });
    expect(body.response).toEqual({ ...reply, installed: [reply.installed[0]], official: [reply.official[0]], materials: [reply.materials[0]], managed: { desktop: reply.managed.desktop } });
    expect(body.projection.omitted).toContainEqual({ path: 'installed', records: 1 });
    expect(body.projection.notice).toContain('Omitted information is not verified');
    for (const unrelated of ['unrelated-qq-history', 'unrelated-qq-run', 'unrelated-qq-material', 'unrelated-managed-hash', 'unrelated-official-error', 'unrelated-same-name-material']) expect(document.body).not.toContain(unrelated);
    expect(receipt.responseBody).toEqual(reply); expect(receipt.responseDigest).toBe(body.responseDigest);
    const full = f.actions.read(document.ref, verifierAccess, { full: true });
    expect(JSON.parse(full.body).response).toEqual(reply); expect(JSON.parse(full.body).projection).toBeUndefined();
    expect(full.ref).toBe(`${document.ref}:full`); expect(JSON.parse(full.body).receiptRef).toBe(receipt.ref);
    expect(f.actions.read(full.ref, verifierAccess)).toEqual(full);
    expect(f.actions.read(full.ref, verifierAccess, { full: true })).toEqual(full);
    expect(f.actions.list('p', verifierAccess).map(d => d.ref)).toEqual([document.ref, full.ref]);
    expect(full.digest).not.toBe(document.digest); expect(JSON.parse(full.body).responseDigest).toBe(body.responseDigest);
    expect(f.calls.find(c => typeof c.target === 'object' && c.target !== null && 'tool' in c.target && c.target.tool === 'overview')?.args).toEqual({});
    f.setReply({ installed: [] }); f.reopen();
    expect(f.actions.read(document.ref, verifierAccess)).toEqual(document);
    expect(f.actions.read(full.ref, verifierAccess)).toEqual(full);
    expect(await f.actions.applicationRead(input, workerAccess)).toEqual(document); expect(f.appCalls).toBe(1);
    await expect(f.actions.applicationRead({ ...input, focus: { name: 'qq' } }, workerAccess)).rejects.toThrow();
    expect(JSON.parse(f.actions.read(document.ref, owner, { full: true }).body).response).toEqual(reply);
    f.actions.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    expect(readFileSync(join(f.directory, 'mind-artifacts.sqlite')).includes(Buffer.from('desktop-source'))).toBe(false);
  } finally { f.close(); }
});

test('name focus and missing target keep observed errors and explicitly incomplete coverage', async () => {
  const reply = appsOverview(), f = await fixture(reply, true); try {
    const named = await f.actions.applicationRead({ ...f.input, focus: { name: 'desktop' } }, workerAccess) as DocumentArtifact;
    expect(JSON.parse(named.body).response.installed).toEqual([reply.installed[0]]);
    const missing = await f.actions.applicationRead({ ...f.input, actionKey: 'missing-target', focus: { moduleId: 'missing' } }, workerAccess) as DocumentArtifact;
    const body = JSON.parse(missing.body);
    expect(body.response).toMatchObject({ installed: [], materials: [], official: [], managed: {}, installedError: reply.installedError, historyNotice: reply.historyNotice });
    expect(body.projection.notice).toContain('missing match does not prove absence');
    expect(body.projection.complete).toBe(false);
  } finally { f.close(); }
});

test('ordinary overview stays full; unsupported focused shape falls back to the complete reply', async () => {
  const reply = appsOverview(), f = await fixture(reply, true); try {
    const full = await f.actions.applicationRead(f.input, workerAccess) as DocumentArtifact;
    expect(full.title).toBe('Application read apps');
    expect(JSON.parse(full.body).response).toEqual(reply); expect(JSON.parse(full.body).projection).toBeUndefined();
    const changedShape = { directoryError: 'Directory transport failed', diagnostic: { state: 'unavailable' } };
    f.setReply(changedShape);
    const fallback = await f.actions.applicationRead({ ...f.input, actionKey: 'changed-shape', focus: { name: 'desktop' } }, workerAccess) as DocumentArtifact;
    expect(JSON.parse(fallback.body).response).toEqual(changedShape); expect(JSON.parse(fallback.body).projection).toBeUndefined();
    for (const original of [full, fallback]) {
      const complete = f.actions.read(original.ref, verifierAccess, { full: true });
      expect(complete).toEqual(original);
      expect(f.actions.list('p', verifierAccess).some(item => item.ref === complete.ref)).toBe(true);
      expect(f.actions.read(complete.ref, verifierAccess)).toEqual(complete);
    }
  } finally { f.close(); }
});

test('id plus name preserves source errors with failed installed coverage and excludes conflicting material IDs', async () => {
  const reply = appsOverview(); reply.installed = [];
  reply.materials.push({ ...reply.materials[0], id: 'same-name-other-id', target: { ...reply.materials[0].target, moduleId: 'other-target' } });
  const f = await fixture(reply, true); try {
    const document = await f.actions.applicationRead({ ...f.input, focus: { moduleId: 'target-real', name: 'desktop' } }, workerAccess) as DocumentArtifact;
    const body = JSON.parse(document.body);
    expect(body.response).toMatchObject({ installed: [], installedError: reply.installedError,
      official: [reply.official[0]], materials: [reply.materials[0]], managed: { desktop: reply.managed.desktop } });
    expect(body.projection.complete).toBe(false);
    expect(body.projection.notice).toContain('missing match does not prove absence');
    expect(document.body).not.toContain('same-name-other-id'); expect(document.body).not.toContain('unrelated-official-error');
    expect(body.responseDigest).toBe(coreDigest(reply));
  } finally { f.close(); }
});

test('full view candidate verifies the exact full identity through its original action and actual worker read', async () => {
  const f = await fixture(appsOverview(), true); try {
    f.store.update(tx => {
      const p = tx.get('pursuit', 'p')!; p.goal = 'Inspect the overview and report the QQ version history';
      p.completionCriteria = ['Report the QQ version hash returned by the overview']; tx.put('pursuit', p);
      const e = tx.get('evidence', 'e')!; e.content!.text = p.goal; tx.put('evidence', e);
    });
    const compact = await f.actions.applicationRead({ ...f.input, focus: { moduleId: 'target-real' } }, workerAccess) as DocumentArtifact;
    const full = f.actions.read(compact.ref, workerAccess, { full: true });
    expect(compact.body).not.toContain('unrelated-qq-history'); expect(full.body).toContain('unrelated-qq-history');
    const candidate = candidateFor(f, full);
    f.worker.facts[0] = fact('action', compact, 'worker-run', 'original-action');
    f.worker.facts.push(fact('artifact', full, 'worker-run', 'full-read'));
    const request = f.verification.prepare(candidate.id, f.worker, now);
    await f.verification.reconcile(now);
    expect(JSON.stringify(f.calls.find(c => c.target === 'agent.run')!.args)).toContain(full.ref);
    const receipt = f.verification.verdict({ requestId: request.id, candidateRef: candidate.receipt,
      artifacts: [{ ref: full.ref, digest: full.digest }], decision: 'accepted', observations: [{
        criterion: f.store.read().pursuits[0].completionCriteria[0], satisfied: true,
        observation: 'The full overview includes the observed QQ version hash.', artifactRefs: [full.ref], excerpt: 'unrelated-qq-history',
      }] }, binding);
    f.finish(full, receipt); await f.verification.reconcile(now);
    expect(f.verification.assess(request.id)).toMatchObject({ status: 'accepted', scope: 'persisted-app-read-or-document',
      verified: { artifactRefs: [full.ref], originalReceiptRef: full.ref } });
    const p = f.store.read().pursuits[0];
    const applied = f.service.applyProgress({ actionKey: 'apply-full', expectedVisibilityRevision: 0, candidateId: candidate.id,
      expectedRevision: p.revision, verified: f.verification.assess(request.id).verified! }, workerAccess);
    expect(applied.value?.pursuit.status).toBe('done');
    expect(f.actions.list('p', owner).map(d => d.ref)).toContain(full.ref);
    expect(f.actions.read(full.ref, owner)).toEqual(full);
  } finally { f.close(); }
});

test.each(['missing-action', 'missing-read', 'forged-read', 'other-run', 'unselected-tool', 'full-as-action'])('full view cannot bypass worker action provenance: %s', async mode => {
  const f = await fixture(appsOverview(), true); try {
    const compact = await f.actions.applicationRead({ ...f.input, focus: { moduleId: 'target-real' } }, workerAccess) as DocumentArtifact;
    const full = f.actions.read(compact.ref, workerAccess, { full: true }), candidate = candidateFor(f, full);
    const action = fact('action', mode === 'full-as-action' ? full : compact, 'worker-run', 'original-action');
    const read = fact('artifact', mode === 'forged-read' ? { ...full, body: 'invented' } : full,
      mode === 'other-run' ? 'other-run' : 'worker-run', 'full-read');
    f.worker.facts = [f.worker.facts[1], ...(mode === 'missing-action' ? [] : [action]), ...(mode === 'missing-read' ? [] : [read])];
    if (mode === 'unselected-tool') f.worker.tools = f.worker.tools.filter(t => typeof t === 'string' || t.tool !== 'artifact');
    expect(() => f.verification.prepare(candidate.id, f.worker, now)).toThrow('persisted selected');
    expect(f.calls.some(c => c.target === 'agent.run')).toBe(false);
  } finally { f.close(); }
});

test.each(['scope', 'goal', 'source'])('full view enforces the original receipt authorization: %s', async mode => {
  const f = await fixture(appsOverview(), true); try {
    const compact = await f.actions.applicationRead({ ...f.input, focus: { moduleId: 'target-real' } }, workerAccess) as DocumentArtifact;
    const full = f.actions.read(compact.ref, workerAccess, { full: true });
    if (mode === 'scope') expect(() => f.actions.read(full.ref, { subject: 'other', role: 'application', scopes: [{ sessionId: 'different' }] })).toThrow('scope');
    else {
      f.store.update(tx => {
        if (mode === 'source') tx.delete('evidence', 'e');
        else { const p = tx.get('pursuit', 'p')!; p.goal = 'Changed goal'; p.revision++; tx.put('pursuit', p); }
      });
      expect(() => f.actions.read(full.ref, verifierAccess)).toThrow();
      expect(f.actions.list('p', verifierAccess)).toEqual([]);
    }
  } finally { f.close(); }
});

test.each(['original-call', 'replay-call', 'receipt-ref', 'full-ref'])('full candidate preserves matching action proof by %s', async original => {
  const f = await fixture(appsOverview(), true); try {
    const input = { ...f.input, focus: { moduleId: 'target-real' } };
    const compact = await f.actions.applicationRead(input, workerAccess) as DocumentArtifact;
    expect(await f.actions.applicationRead(input, workerAccess)).toEqual(compact);
    const full = f.actions.read(compact.ref, workerAccess, { full: true });
    const originalReceiptRef = original === 'receipt-ref' ? compact.ref : original === 'full-ref' ? full.ref : original;
    const candidate = candidateFor(f, full, originalReceiptRef);
    f.worker.facts = [fact('action', compact, 'worker-run', 'original-call'), fact('action', compact, 'worker-run', 'replay-call'),
      fact('artifact', full, 'worker-run', 'full-read'), f.worker.facts[1]];
    const request = f.verification.prepare(candidate.id, f.worker, now);
    expect(request.artifacts).toEqual([{ ref: full.ref, digest: full.digest }]); expect(f.appCalls).toBe(1);
  } finally { f.close(); }
});
