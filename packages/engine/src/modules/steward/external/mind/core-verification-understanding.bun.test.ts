import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreActions } from './core-actions';
import { CoreExecutionJournal, type CoreCall, type ToolFact } from './core-execution';
import { CoreVerification, type VerdictInput } from './core-verification';
import type { CoreAccess, IngestBatch } from './core-types';

const now = '2026-11-13T14:00:00.000Z';
const identity = { moduleId: 'mind-real', hash: 'mind-version' };
const binding = { ...identity, runId: 'verifier-run' };
const owner: CoreAccess = { subject: 'owner', role: 'owner', scopes: [{}] };
const runtime: CoreAccess = { subject: 'runtime', role: 'runtime', scopes: [{}], execution: { actor: 'worker', runRef: 'worker-run' } };
const fact = (tool: string, output: unknown, runId: string, callId = tool): ToolFact => ({
  runId, callId, target: { moduleId: identity.moduleId, tool }, ...identity,
  status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(output) },
});
const item = (value: ToolFact) => ({ kind: 'tool-result', payload: { type: 'tool-result', value } });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mind-verification-understanding-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store, { now: () => now });
  const actions = new CoreActions(directory, service), workers = new CoreExecutionJournal(directory);
  const ingest = (sourceIdentity: string, text: string) => {
    const event: IngestBatch['events'][number] & { sourceKind: 'chat' } = {
      id: 'message', eventId: 'message', cursor: '1', sourceKind: 'chat',
      object: { kind: 'message', id: `${sourceIdentity}-message`, revision: 1 }, kind: 'message', actor: 'user', scope: {},
      origin: { rootId: `${sourceIdentity}-session` }, occurredAt: now, receivedAt: now, scopeRevision: 1,
      content: { text, truncated: false },
    };
    const batch: IngestBatch = { sourceIdentity, epoch: '1', expectedCheckpointRevision: 0, nextCursor: '1', scopeRevision: 1,
      capturedAt: now, coverage: { complete: true }, events: [event] };
    service.ingest(batch, runtime);
    return store.read().evidence.find(e => e.sourceIdentity === sourceIdentity)!.id;
  };
  const support = ingest('chat-support', 'Published timetable: depart 09:00, arrive 11:30.');
  const opposition = ingest('chat-opposition', 'The older timetable said arrival 12:30; it has been superseded.');
  const understanding = service.remember({ actionKey: 'remember', expectedVisibilityRevision: 0, expectedRevision: 0,
    kind: 'constraint', value: 'Use the current timetable, departing 09:00 and arriving 11:30; the old 12:30 arrival is obsolete.',
    scope: {}, explicitness: 'explicit', supportingRefs: [support], opposingRefs: [opposition] }, owner).value!;
  const created = service.pursue({ actionKey: 'pursue', expectedVisibilityRevision: 0, expectedRevision: 0, semanticKey: 'train',
    goal: 'Provide an itinerary arriving before noon', completionCriteria: ['Give supported departure and arrival times before noon'],
    scope: {}, reason: 'explicit-goal', evidenceRefs: [], understandingRefs: [understanding.id] }, owner).value!;
  const pursuit = service.claim({ actionKey: 'claim', expectedVisibilityRevision: 0, pursuitId: created.id, expectedRevision: created.revision }, runtime).value!;
  const document = actions.create({ actionKey: 'document', expectedVisibilityRevision: 0, pursuitId: pursuit.id, expectedRevision: pursuit.revision,
    target: 'document', arguments: {}, document: { title: 'Itinerary', body: 'Depart 09:00, arrive 11:30 before noon, using the current published timetable. The old 12:30 arrival is obsolete.' } }, runtime);
  const candidate = service.progress({ actionKey: 'progress', expectedVisibilityRevision: 0, pursuitId: pursuit.id, expectedRevision: pursuit.revision,
    summary: 'Itinerary ready', evidenceRefs: pursuit.evidenceRefs, artifactRefs: [document.ref], originalReceiptRef: document.ref, desiredStatus: 'done' }, runtime).value!;
  const worker = { ...workers.prepare({ purpose: 'pursuit', subject: pursuit.id, revision: pursuit.revision, visibilityRevision: 0,
    prompt: 'Write the requested itinerary', tools: ['action', 'progress'].map(tool => ({ moduleId: identity.moduleId, tool })) }, now),
    runId: 'worker-run', contextId: 'worker-context', ended: true, active: false, status: 'finished' as const,
    facts: [fact('action', document, 'worker-run'), fact('progress', { value: candidate }, 'worker-run')] };
  workers.save(worker);
  let items: unknown[] = [], ended = false;
  const launches: Array<Record<string, unknown>> = [];
  // Only the Agent transport is simulated; all source, understanding, pursuit, artifact and verdict state uses real services/SQLite.
  const call: CoreCall = async (target, args) => {
    if (target === 'agent.run') { launches.push(structuredClone(args)); return { runId: binding.runId, contextId: 'verifier-context', active: true, status: 'running' }; }
    if (target === 'agent.read') return { run: { runId: binding.runId, contextId: 'verifier-context', active: !ended, status: ended ? 'finished' : 'running' }, items, ended, nextCursor: null, interactions: [] };
    throw Error(`Unexpected verifier call ${JSON.stringify(target)}`);
  };
  const options = { store, actions, call, self: () => identity, hasActiveRun: () => false };
  let verification = new CoreVerification(directory, options);
  return { store, service, actions, understanding, pursuit, candidate, document, worker, support, opposition, launches,
    get verification() { return verification; },
    prepare() { return verification.prepare(candidate.id, worker, now); },
    async accept() {
      const request = verification.prepare(candidate.id, worker, now);
      await verification.reconcile(now);
      const input: VerdictInput = { requestId: request.id, candidateRef: candidate.receipt, artifacts: [{ ref: document.ref, digest: document.digest }],
        decision: 'accepted', observations: [{ criterion: pursuit.completionCriteria[0], satisfied: true,
          observation: 'The document follows the supported current timetable and explicitly excludes the superseded arrival.',
          artifactRefs: [document.ref], excerpt: 'Depart 09:00, arrive 11:30 before noon' }] };
      const receipt = verification.verdict(input, binding);
      items = [item(fact('artifact', actions.read(document.ref), binding.runId)), item(fact('verdict', receipt, binding.runId))]; ended = true;
      await verification.reconcile(now);
      expect(verification.assess(request.id).status).toBe('accepted');
      return request;
    },
    restart() { verification.close(); verification = new CoreVerification(directory, options); },
    gap(ref: string) {
      const e = service.detail({ kind: 'evidence', id: ref }, owner);
      const cp = store.read().checkpoints.find(cp => cp.sourceIdentity === e.sourceIdentity)!;
      return service.ingest({ sourceIdentity: cp.sourceIdentity, epoch: cp.epoch, expectedCheckpointRevision: cp.revision,
        nextCursor: '2', scopeRevision: cp.scopeRevision, capturedAt: now,
        coverage: { complete: false, gap: 'Chat source page unavailable' }, events: [] }, runtime);
    },
    // Follow the runtime's public assessment -> apply/reject boundary with the actual service.
    reconcileProgress(requestId: string) {
      const result = verification.assess(requestId);
      const mutation = { actionKey: 'apply-verification', expectedVisibilityRevision: store.read().visibilityRevision,
        candidateId: candidate.id, expectedRevision: candidate.pursuitRevision };
      if (result.verified) service.applyProgress({ ...mutation, verified: result.verified }, runtime);
      else service.rejectProgress({ ...mutation, reason: `Independent verification ${result.status}: ${result.reason}` }, runtime);
      return result;
    },
    close() { verification.close(); workers.close(); actions.close(); store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('verifier receives full linked understanding and both indirect evidence records; unchanged result applies done', async () => {
  const f = fixture(); try {
    expect(f.pursuit.evidenceRefs).not.toContain(f.support); expect(f.candidate.evidenceRefs).not.toContain(f.opposition);
    const request = await f.accept();
    const data = JSON.parse((f.launches[0].prompt as string).split('\nData:\n')[1]);
    expect(data.understandings).toEqual([f.understanding]);
    expect(data.evidence).toEqual(expect.arrayContaining([f.service.detail({ kind: 'evidence', id: f.support }, owner),
      f.service.detail({ kind: 'evidence', id: f.opposition }, owner)]));
    expect(f.launches[0].model).toBeUndefined(); expect(f.launches[0].profile).toBeUndefined();
    f.restart(); expect(f.reconcileProgress(request.id).status).toBe('accepted');
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).status).toBe('done');
  } finally { f.close(); }
});

test.each(['support', 'opposition'] as const)('Chat coverage gap reached only through understanding %s invalidates accepted verdict and prevents done', async role => {
  const f = fixture(); try {
    const request = await f.accept();
    expect(f.candidate.evidenceRefs).not.toContain(f[role]); expect(f.pursuit.evidenceRefs).not.toContain(f[role]);
    const checkpoint = f.gap(f[role]); expect(checkpoint.coverage.complete).toBe(false);
    // The candidate/actor/pursuit revision and document remain unchanged: only the indirect source coverage changed.
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner)).toEqual(f.pursuit);
    expect(f.actions.read(f.document.ref)).toEqual(f.document);
    f.restart(); const result = f.reconcileProgress(request.id);
    expect(result.status).toBe('invalidated'); expect(result.verified).toBeUndefined();
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).status).toBe('waiting');
  } finally { f.close(); }
});

test.each(['value', 'supportingRefs', 'opposingRefs', 'missing', 'retracted', 'empty'] as const)
('understanding %s alone invalidates accepted material even without a pursuit revision change', async mode => {
  const f = fixture(); try {
    const request = await f.accept();
    // Isolate verification's content/dependency fingerprint from service-level pursuit invalidation.
    f.store.update(tx => {
      if (mode === 'missing') { tx.delete('understanding', f.understanding.id); return; }
      const u = tx.get('understanding', f.understanding.id)!;
      if (mode === 'value') u.value = 'The current train arrives after noon.';
      if (mode === 'supportingRefs') u.supportingRefs = [f.opposition];
      if (mode === 'opposingRefs') u.opposingRefs = [];
      if (mode === 'retracted') u.status = 'retracted';
      if (mode === 'empty') u.value = '';
      tx.put('understanding', u);
    });
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner)).toEqual(f.pursuit);
    f.restart(); const result = f.reconcileProgress(request.id);
    expect(result.status).toBe('invalidated'); expect(result.verified).toBeUndefined();
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).status).toBe('waiting');
  } finally { f.close(); }
});

test.each(['support', 'opposition'] as const)('changed indirect %s evidence content invalidates accepted fingerprint', async role => {
  const f = fixture(); try {
    const request = await f.accept();
    f.store.update(tx => { const e = tx.get('evidence', f[role])!; e.content!.text = 'Corrected timetable: arrival 13:30'; tx.put('evidence', e); });
    const result = f.reconcileProgress(request.id);
    expect(result.status).toBe('invalidated'); expect(result.verified).toBeUndefined();
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).status).toBe('waiting');
  } finally { f.close(); }
});

test('service remember correction invalidates an already accepted result', async () => {
  const f = fixture(); try {
    const request = await f.accept();
    f.service.remember({ actionKey: 'correct-understanding', expectedVisibilityRevision: 0, expectedRevision: f.understanding.revision,
      id: f.understanding.id, kind: 'constraint', value: 'Arrival must be before 11:00 instead.', scope: {}, explicitness: 'explicit',
      supportingRefs: [f.support], opposingRefs: [f.opposition] }, owner);
    f.restart(); const result = f.verification.assess(request.id);
    expect(result.status).toBe('invalidated'); expect(result.verified).toBeUndefined();
    expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).status).toBe('waiting');
  } finally { f.close(); }
});

test.each(['support', 'opposition'] as const)('incomplete indirect %s source refuses verification before dispatch', role => {
  const f = fixture(); try {
    f.gap(f[role]);
    expect(() => f.prepare()).toThrow('Original evidence is missing, incomplete or withdrawn');
    expect(f.launches).toHaveLength(0);
  } finally { f.close(); }
});
