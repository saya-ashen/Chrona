import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreActions } from './core-actions';
import { CoreExecutionJournal, type CoreCall, type ToolFact } from './core-execution';
import { CoreVerification, type VerdictInput, type VerdictReceipt } from './core-verification';
import type { Evidence, Pursuit, CoreAccess } from './core-types';

const now = '2026-11-13T14:00:00.000Z';
const identity = { moduleId: 'mind-id', hash: 'mind-version' };
const binding = { ...identity, runId: 'verifier-run' };
const fact = (tool: string, output: unknown, callId = tool, runId = binding.runId): ToolFact =>
  ({ runId, callId, target: { moduleId: identity.moduleId, tool }, ...identity, status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(output) } });
const item = (value: ToolFact) => ({ kind: 'tool-result', payload: { type: 'tool-result', value } });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mind-verification-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store), actions = new CoreActions(directory, service);
  const workers = new CoreExecutionJournal(directory);
  let worker = workers.prepare({ purpose: 'pursuit', subject: 'p', revision: 2, visibilityRevision: 0,
    prompt: 'Write an evidence-backed train itinerary', tools: ['action', 'progress'].map(tool => ({ moduleId: identity.moduleId, tool })) }, now);
  worker = { ...worker, runId: 'worker-run', contextId: 'worker-context', ended: true, active: false, status: 'finished' };
  workers.save(worker);
  const p: Pursuit = { id: 'p', revision: 2, createdAt: now, updatedAt: now, visibilityRevision: 0,
    semanticKey: 'itinerary', goal: 'Provide a train itinerary arriving before noon', completionCriteria: ['Give departure and arrival times with source support'],
    scope: {}, reason: 'explicit-goal', evidenceRefs: ['e'], understandingRefs: [], artifactRefs: [], status: 'active', paused: false,
    currentActor: { actor: 'worker', runRef: 'worker-run', claimedRevision: 2, stopRequested: false } };
  const evidence: Evidence = { id: 'e', revision: 1, createdAt: now, updatedAt: now, sourceIdentity: 'owner', epoch: '1', eventId: 'message', cursor: '1',
    object: { kind: 'message', id: 'user-message', revision: 1 }, kind: 'message', scope: {}, actor: 'user', origin: { rootId: 'user-message' },
    occurredAt: now, receivedAt: now, scopeRevision: 1, visibilityRevision: 0, sourceDigest: 'source',
    content: { text: 'Use the published timetable: depart 09:00, arrive 11:30; I need to arrive before noon.', truncated: false } };
  store.update(tx => { tx.put('evidence', evidence); tx.put('pursuit', p); });
  const access: CoreAccess = { subject: 'runtime', role: 'runtime', scopes: [{}], execution: { actor: 'worker', runRef: 'worker-run' } };
  const document = actions.create({ actionKey: 'create-document', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
    target: 'document', arguments: {}, document: { title: 'Train itinerary', body: 'Take the 09:00 train, arriving at 11:30 before noon. Source: the user-provided published timetable.' } }, access);
  const candidate = service.progress({ actionKey: 'progress', pursuitId: 'p', expectedRevision: 2, expectedVisibilityRevision: 0,
    summary: 'Train itinerary ready for independent checking', artifactRefs: [document.ref], originalReceiptRef: 'original-action', evidenceRefs: ['e'], desiredStatus: 'done' }, access).value!;
  worker.facts = [fact('action', document, 'original-action', 'worker-run'), fact('progress', { value: candidate }, 'progress', 'worker-run')];
  workers.save(worker);
  const state = { active: true, loseRunReply: false, runCalls: [] as Array<{ key?: string; args: Record<string, unknown> }>,
    items: [] as unknown[], ended: false, verifierActive: true, stopConfirmed: false, stopCalls: 0 };
  const call: CoreCall = async (target, args, options) => {
    if (target === 'agent.run') {
      state.runCalls.push({ key: options?.key, args: structuredClone(args) });
      if (state.loseRunReply) { state.loseRunReply = false; throw Error('run reply lost'); }
      return { runId: binding.runId, contextId: 'verifier-context', active: true, status: 'running' };
    }
    if (target === 'agent.stop') { state.stopCalls++; return { runId: binding.runId, contextId: 'verifier-context', active: state.verifierActive, status: 'stopping', stopConfirmed: state.stopConfirmed }; }
    if (target === 'agent.read') return { run: { runId: binding.runId, contextId: 'verifier-context', active: state.verifierActive, status: state.verifierActive ? 'running' : 'finished' },
      items: state.items, ended: state.ended, nextCursor: null, interactions: [] };
    throw Error(`Unexpected verifier target ${JSON.stringify(target)}`);
  };
  const options = { store, actions, call, self: () => identity, hasActiveRun: () => state.active };
  let verification = new CoreVerification(directory, options);
  const request = verification.prepare(candidate.id, worker, now);
  const input: VerdictInput = { requestId: request.id, candidateRef: candidate.receipt, artifacts: [{ ref: document.ref, digest: document.digest }],
    decision: 'accepted', observations: [{ criterion: p.completionCriteria[0], satisfied: true,
      observation: 'The full document gives 09:00 and 11:30, matches the original timetable, and arrives before noon.',
      artifactRefs: [document.ref], excerpt: 'Take the 09:00 train, arriving at 11:30 before noon.' }] };
  return { directory, store, actions, workers, worker, document, candidate, request, input, state,
    get verification() { return verification; },
    restart() { verification.close(); verification = new CoreVerification(directory, options); },
    async start() { state.active = false; const e = workers.get(worker.id); e.settled = true; workers.save(e); await verification.reconcile(now); },
    finish(receipt: VerdictReceipt, extra: unknown[] = []) { state.items = [item(fact('artifact', document)), ...extra, item(fact('verdict', receipt))]; state.ended = true; state.verifierActive = false; },
    cleanup() { verification.close(); workers.close(); actions.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('independent local-document result uses actual VerifiedProgress and never applies completion itself', async () => {
  const f = fixture(); try {
    await f.verification.reconcile(now); expect(f.state.runCalls).toHaveLength(0);
    await f.start(); const args = f.state.runCalls[0].args;
    expect(args).toMatchObject({ lane: 'background', content: [], kind: 'conversation' });
    expect(args.contextId).toBeUndefined(); expect(args.model).toBeUndefined(); expect(args.profile).toBeUndefined();
    expect(args.tools).toEqual(['artifact', 'detail', 'verdict'].map(tool => ({ moduleId: identity.moduleId, tool })));
    const receipt = f.verification.verdict(f.input, binding);
    expect(f.verification.verdict(f.input, binding)).toEqual(receipt);
    expect(f.verification.assess(f.request.id).status).toBe('pending');
    f.finish(receipt); await f.verification.reconcile(now); f.restart();
    const result = f.verification.assess(f.request.id);
    expect(result.status).toBe('accepted'); expect(result.scope).toBe('local-document');
    expect(result.verified).toMatchObject({ candidateReceipt: f.candidate.receipt, runRef: 'worker-run', originalReceiptRef: 'original-action',
      artifactRefs: [f.document.ref], criteriaSatisfied: true, executionTerminal: true });
    expect(result.verified?.method).toContain('module delivery excluded');
    expect(f.store.read().pursuits[0].status).toBe('active');
    expect(f.store.read().pursuits[0].currentActor?.runRef).toBe('worker-run');
  } finally { f.cleanup(); }
});

test('lost run reply survives restart with identical command key and arguments, never nests under active worker', async () => {
  const f = fixture(); try {
    f.state.loseRunReply = true; await f.start(); expect(f.verification.outstanding()?.status).toBe('unknown');
    f.restart(); f.state.active = true; await f.verification.reconcile(now); expect(f.state.runCalls).toHaveLength(1);
    f.state.active = false; await f.verification.reconcile(now);
    expect(f.state.runCalls).toHaveLength(2); expect(f.state.runCalls[0]).toEqual(f.state.runCalls[1]);
    expect(f.verification.outstanding()?.runId).toBe(binding.runId);
  } finally { f.cleanup(); }
});

test('forged adapter identity and mismatched candidate/digests cannot mint a verdict receipt', async () => {
  const f = fixture(); try {
    await f.start();
    for (const bad of [{ ...binding, runId: 'worker-run' }, { ...binding, runId: 'other' }, { ...binding, hash: 'other' }, { ...binding, moduleId: 'other' }])
      expect(() => f.verification.verdict(f.input, bad)).toThrow('actual current independent');
    expect(() => f.verification.verdict({ ...f.input, candidateRef: 'forged' }, binding)).toThrow('exact candidate');
    expect(() => f.verification.verdict({ ...f.input, artifacts: [{ ref: f.document.ref, digest: 'forged' }] }, binding)).toThrow('exact candidate');
    expect(() => f.verification.verdict({ ...f.input, observations: [{ ...f.input.observations[0], excerpt: 'fabricated claim' }] }, binding)).toThrow('exact original');
  } finally { f.cleanup(); }
});

test.each(['plaintext', 'invented-receipt', 'wrong-run', 'wrong-module', 'wrong-version', 'filtered', 'failed', 'unselected', 'no-artifact-read', 'partial-document', 'malformed-json'])
('untrusted verifier result %s never completes', async mode => {
    const f = fixture(); try {
      await f.start(); const receipt = f.verification.verdict(f.input, binding);
      const value = fact('verdict', receipt);
      if (mode === 'invented-receipt') value.output = { ...receipt, receipt: 'invented' };
      if (mode === 'wrong-run') value.runId = 'worker-run';
      if (mode === 'wrong-module') value.moduleId = 'attacker';
      if (mode === 'wrong-version') value.hash = 'different-version';
      if (mode === 'filtered') value.outputState = 'filtered';
      if (mode === 'failed') value.status = 'failed';
      if (mode === 'unselected') value.target = { moduleId: identity.moduleId, tool: 'other' };
      f.state.items = [item(fact('artifact', f.document)), mode === 'plaintext' ? { kind: 'text', text: JSON.stringify(receipt) } : item(value)];
      if (mode === 'no-artifact-read') f.state.items.shift();
      if (mode === 'partial-document') f.state.items[0] = item(fact('artifact', { ...f.document, body: 'Only a summary' }));
      if (mode === 'malformed-json') f.state.items[1] = item({ ...value, output: { json: 'invalid JSON' } });
      f.state.ended = true; f.state.verifierActive = false; await f.verification.reconcile(now);
      expect(f.verification.assess(f.request.id).status).toBe('unverified');
      expect(f.verification.assess(f.request.id).verified).toBeUndefined();
    } finally { f.cleanup(); }
});

test('nonempty placeholder and hashes remain unverified; independent needs-work/rejection are durable', async () => {
  for (const decision of ['needs-work', 'rejected'] as const) {
    const f = fixture(); try {
      expect(f.verification.assess(f.request.id).verified).toBeUndefined(); await f.start();
      const receipt = f.verification.verdict({ ...f.input, decision, observations: [{ ...f.input.observations[0], satisfied: false,
        observation: 'The report provides no independently supported useful result.', excerpt: undefined }] }, binding);
      f.finish(receipt); await f.verification.reconcile(now); f.restart();
      expect(f.verification.assess(f.request.id).status).toBe(decision); expect(f.verification.assess(f.request.id).verified).toBeUndefined();
    } finally { f.cleanup(); }
  }
});

test('stalled active verifier and unknown effects retain responsibility and durable concurrency', async () => {
  const f = fixture(); try {
    await f.start(); const receipt = f.verification.verdict(f.input, binding);
    f.state.items = [item(fact('artifact', f.document)), item(fact('verdict', receipt))];
    await f.verification.reconcile('2026-11-13T14:11:00.000Z');
    expect(f.state.stopCalls).toBe(1); expect(f.verification.outstanding()?.stopRequested).toBe(true);
    expect(f.verification.assess(f.request.id).verified).toBeUndefined(); f.restart();
    expect(f.verification.outstanding()?.stopConfirmed).toBe(false);
    expect(f.store.read().pursuits[0].currentActor?.runRef).toBe('worker-run');
  } finally { f.cleanup(); }
  const g = fixture(); try {
    await g.start(); const receipt = g.verification.verdict(g.input, binding); g.finish(receipt);
    g.state.items.push(item({ ...fact('verdict', null, 'uncertain'), status: 'unknown', outputState: 'omitted' }));
    await g.verification.reconcile(now); expect(g.verification.outstanding()).toBeDefined();
    expect(g.verification.assess(g.request.id).status).toBe('pending');
  } finally { g.cleanup(); }
});

test.each(['artifact', 'candidate', 'goal', 'revision', 'evidence', 'visibility', 'withdrawal', 'actor', 'criteria', 'source-scope'])
('exact material change %s invalidates even accepted receipts', async mode => {
    const f = fixture(); try {
      await f.start(); const receipt = f.verification.verdict(f.input, binding); f.finish(receipt); await f.verification.reconcile(now);
      expect(f.verification.assess(f.request.id).status).toBe('accepted');
      if (mode === 'artifact') f.actions.db.query('DELETE FROM documents WHERE ref=?').run(f.document.ref);
      else f.store.update(tx => {
        if (mode === 'candidate') { const c = tx.get('candidate', f.candidate.id)!; c.summary = 'different candidate material'; tx.put('candidate', c); }
        if (mode === 'goal' || mode === 'revision' || mode === 'actor' || mode === 'criteria') { const p = tx.get('pursuit', 'p')!;
          if (mode === 'goal') p.goal = 'A different goal'; if (mode === 'revision') p.revision++; if (mode === 'actor') delete p.currentActor;
          if (mode === 'criteria') p.completionCriteria = ['Provide a bus itinerary instead']; tx.put('pursuit', p); }
        if (mode === 'source-scope') tx.put('checkpoint', { id: 'owner', revision: 1, sourceIdentity: 'owner', epoch: 'new', cursor: '2', scopeRevision: 2, coverage: { complete: true }, capturedAt: now });
        if (mode === 'evidence') { const e = tx.get('evidence', 'e')!; e.content!.text = 'Corrected original timetable'; tx.put('evidence', e); }
        if (mode === 'visibility') tx.setMeta({ ...tx.meta(), visibilityRevision: 1 });
        if (mode === 'withdrawal') tx.delete('evidence', 'e');
      });
      expect(f.verification.assess(f.request.id).status).toBe('invalidated'); expect(f.verification.assess(f.request.id).verified).toBeUndefined();
    } finally { f.cleanup(); }
});

test('prepare requires ended worker, exact original receipt and genuine selected document/progress results', () => {
  const f = fixture(); try {
    expect(f.verification.prepare(f.candidate.id, f.worker, now).id).toBe(f.request.id);
    expect(() => f.verification.prepare(f.candidate.id, { ...f.worker, active: true }, now)).toThrow('terminal');
    expect(() => f.verification.prepare(f.candidate.id, { ...f.worker, facts: f.worker.facts.filter(f => f.callId !== 'original-action') }, now)).toThrow('persisted selected');
    const forged = structuredClone(f.worker); forged.facts[0].hash = 'forged';
    expect(() => f.verification.prepare(f.candidate.id, forged, now)).toThrow('persisted selected');
  } finally { f.cleanup(); }
});

test('real verdict arriving during lost-admission recovery survives restart; other-run receipt cannot substitute', async () => {
  const f = fixture(); try {
    f.state.loseRunReply = true; await f.start();
    expect(f.verification.outstanding()?.runId).toBeNull();
    const other = f.verification.verdict(f.input, { ...binding, runId: 'unrelated-authenticated-run' });
    const real = f.verification.verdict(f.input, binding);
    expect(other.receipt).not.toBe(real.receipt); f.restart();
    expect(f.verification.verdict(f.input, binding)).toEqual(real);
    f.finish(real); await f.verification.reconcile(now);
    expect(f.state.runCalls[0]).toEqual(f.state.runCalls[1]);
    expect(f.verification.assess(f.request.id).status).toBe('accepted');
  } finally { f.cleanup(); }
});

test('credential-bearing original evidence is refused before any verifier dispatch', () => {
  const f = fixture(); try {
    f.store.update(tx => { const e = tx.get('evidence', 'e')!;
      e.content!.text = 'Use password=fixture-password-only when preparing this document'; tx.put('evidence', e); });
    // Make a different exact candidate to exercise preparation's prompt boundary rather than cached request matching.
    const candidate = { ...f.candidate, id: 'credential-candidate', receipt: 'credential-receipt' };
    f.store.update(tx => tx.put('candidate', candidate));
    const worker = { ...f.worker, facts: [f.worker.facts[0], fact('progress', { value: candidate }, 'other-progress', 'worker-run')] };
    expect(() => f.verification.prepare(candidate.id, worker, now)).toThrow('credential-free');
    expect(f.state.runCalls).toHaveLength(0);
  } finally { f.cleanup(); }
});
